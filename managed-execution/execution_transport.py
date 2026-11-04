"""Pinned loopback mTLS boundary. Private keys remain in the Termux UID."""
import base64
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import ssl
import struct
import subprocess
import threading
import uuid

PORT = 47193
MAX_FRAME = 65536


class TransportFault(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _identity(value):
    if type(value) is not dict or type(value.get("protocol")) is not int or value["protocol"] != 1:
        raise TransportFault("INSTANCE_MISMATCH")
    result = {key: value.get(key) for key in ("executorId", "ledgerEpoch")}
    if any(type(text) is not str or not 1 <= len(text) <= 128 for text in result.values()):
        raise TransportFault("INSTANCE_MISMATCH")
    return result


def _openssl(*args, data=None):
    try:
        return subprocess.run(["openssl", *args], input=data, capture_output=True, check=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        raise TransportFault("TLS_IDENTITY_UNAVAILABLE") from None


def _sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def _read(path, maximum=16384):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        data = source.read(maximum + 1)
    if len(data) > maximum:
        raise TransportFault("PAIRING_INVALID")
    return data


def _certificate(pem):
    if not 1 <= len(pem) <= 8192:
        raise TransportFault("INVALID_CLIENT_IDENTITY")
    return _openssl("x509", "-inform", "PEM", "-outform", "DER", data=pem)


def _server_public(directory):
    certificate = _read(directory / "server-cert.pem", 8192)
    der = _certificate(certificate)
    public = _openssl("x509", "-pubkey", "-noout", data=certificate)
    spki = _openssl("pkey", "-pubin", "-outform", "DER", data=public)
    return base64.b64encode(der).decode("ascii"), hashlib.sha256(spki).hexdigest()


def _pairing(root, identity):
    directory = root / "transport"
    if directory.is_symlink() or not directory.is_dir():
        raise TransportFault("PAIRING_REQUIRED")
    try:
        metadata = _decode(_read(directory / "pairing.json"))
        expected_keys = {"protocol", "port", "executorId", "ledgerEpoch", "serverCertificateDer", "serverSpkiSha256", "clientCertificateSha256"}
        if set(metadata) != expected_keys or type(metadata.get("protocol")) is not int or metadata["protocol"] != 1 or type(metadata.get("port")) is not int or metadata["port"] != PORT or any(metadata.get(key) != value for key, value in _identity(identity).items()):
            raise TransportFault("INSTANCE_MISMATCH")
        client = _certificate(_read(directory / "client-cert.pem", 8192))
        if hashlib.sha256(client).hexdigest() != metadata.get("clientCertificateSha256"):
            raise TransportFault("PAIRING_INVALID")
        certificate, pin = _server_public(directory)
        if certificate != metadata.get("serverCertificateDer") or pin != metadata.get("serverSpkiSha256"):
            raise TransportFault("PAIRING_INVALID")
        if (directory / "server-key.pem").is_symlink() or (directory / "server-key.pem").stat().st_mode & 0o077:
            raise TransportFault("TLS_KEY_PERMISSIONS")
        return metadata, client
    except (OSError, ValueError, KeyError):
        raise TransportFault("PAIRING_INVALID") from None


def bootstrap(root, client_cert_base64, nonce, identity):
    """Create once under lock, otherwise validate exact retained trust. Returns public facts only."""
    owner = _identity(identity)
    if type(nonce) is not str or not re.fullmatch(r"[a-zA-Z0-9-]{1,128}", nonce):
        raise TransportFault("INVALID_NONCE")
    if type(client_cert_base64) is not str or not 1 <= len(client_cert_base64) <= 12000:
        raise TransportFault("INVALID_CLIENT_IDENTITY")
    try:
        pem = base64.b64decode(client_cert_base64, validate=True)
    except ValueError:
        raise TransportFault("INVALID_CLIENT_IDENTITY") from None
    client_der = _certificate(pem)
    root = Path(root)
    if root.is_symlink():
        raise TransportFault("PAIRING_INVALID")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(root / "bootstrap.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        directory = root / "transport"
        if not directory.exists():
            staging = root / ("transport-pending-" + str(uuid.uuid4()))
            staging.mkdir(mode=0o700)
            key = staging / "server-key.pem"
            # Reserve with private mode before openssl opens the path; no global umask mutation.
            _write(key, b"")
            _openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-sha256", "-days", "3650", "-subj", "/CN=DurableAgent execution", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=serverAuth", "-keyout", str(key), "-out", str(staging / "server-cert.pem"))
            os.chmod(key, 0o600)
            for generated in (key, staging / "server-cert.pem"):
                with generated.open("rb") as source:
                    os.fsync(source.fileno())
            _write(staging / "client-cert.pem", pem)
            certificate, pin = _server_public(staging)
            metadata = {"protocol": 1, "port": PORT, **owner, "serverCertificateDer": certificate, "serverSpkiSha256": pin, "clientCertificateSha256": hashlib.sha256(client_der).hexdigest()}
            _write(staging / "pairing.json", json.dumps(metadata, separators=(",", ":"), sort_keys=True).encode())
            _sync_directory(staging)
            os.rename(staging, directory)
            _sync_directory(root)
        metadata, expected = _pairing(root, identity)
        if expected != client_der:
            raise TransportFault("PAIRING_CONFLICT")
        return {key: metadata[key] for key in ("protocol", "port", "executorId", "ledgerEpoch", "serverCertificateDer", "serverSpkiSha256")} | {"nonce": nonce}


def _decode(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise TransportFault("INVALID_FRAME")
            result[key] = value
        return result
    def invalid(_):
        raise TransportFault("INVALID_FRAME")
    try:
        value = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=pairs, parse_constant=invalid)
        if type(value) is not dict:
            raise TransportFault("INVALID_FRAME")
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise TransportFault("INVALID_FRAME") from None


def _exact(connection, length):
    parts = bytearray()
    while len(parts) < length:
        value = connection.recv(length - len(parts))
        if not value:
            raise EOFError()
        parts.extend(value)
    return bytes(parts)


def _request(connection, session=None):
    length = struct.unpack("!I", _exact(connection, 4))[0]
    if not 1 <= length <= MAX_FRAME:
        raise TransportFault("FRAME_LIMIT")
    request = _decode(_exact(connection, length))
    keys = {"protocol", "requestId", "method", "payload"} | ({"session"} if session else set())
    if set(request) != keys or type(request.get("protocol")) is not int or request["protocol"] != 1 or type(request.get("payload")) is not dict:
        raise TransportFault("PROTOCOL_MISMATCH")
    if type(request.get("requestId")) is not str or not re.fullmatch(r"[a-zA-Z0-9-]{1,128}", request["requestId"]):
        raise TransportFault("PROTOCOL_MISMATCH")
    if type(request.get("method")) is not str or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9.]{0,63}", request["method"]):
        raise TransportFault("PROTOCOL_MISMATCH")
    if session is not None and request.get("session") != session:
        raise TransportFault("SESSION_MISMATCH")
    return request


def _reply(connection, request, session, value=None, code=None):
    result = {"protocol": 1, "requestId": request["requestId"], "ok": code is None}
    if session is not None:
        result["session"] = session
    if code is None:
        if type(value) is not dict:
            raise TransportFault("INVALID_RESPONSE")
        result["value"] = value
    else:
        result["error"] = {"code": code, "message": "Execution request not confirmed"}
    data = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if not 1 <= len(data) <= MAX_FRAME:
        raise TransportFault("FRAME_LIMIT")
    connection.sendall(struct.pack("!I", len(data)) + data)


def serve(root, identity, dispatch):
    """Fixed singleton listener; dispatch must never auto-replay unfinished work on startup."""
    root = Path(root)
    owner = _identity(identity)
    workspace = {}
    for key in ("namespace", "defaultWorkspace"):
        if key in identity:
            if type(identity[key]) is not str or not 1 <= len(identity[key]) <= 4096:
                raise TransportFault("INVALID_WORKSPACE_IDENTITY")
            workspace[key] = identity[key]
    metadata, client_der = _pairing(root, identity)
    fd = os.open(root / "server.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "rb") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return  # Only the fixed singleton launcher is idempotent.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(str(root / "transport/server-cert.pem"), str(root / "transport/server-key.pem"))
        context.load_verify_locations(cafile=str(root / "transport/client-cert.pem"))
        context.verify_mode = ssl.CERT_REQUIRED
        context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
        process_epoch = str(uuid.uuid4())
        slots = threading.BoundedSemaphore(12)
        ordinary = threading.BoundedSemaphore(4)
        control = threading.BoundedSemaphore(2)

        def handle(raw):
            connection = raw
            timer = None
            try:
                raw.settimeout(3)
                connection = context.wrap_socket(raw, server_side=True, do_handshake_on_connect=False)
                def expire():
                    try:
                        connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    connection.close()
                timer = threading.Timer(10, expire)
                timer.daemon = True
                timer.start()
                with connection:
                    connection.do_handshake()
                    if connection.getpeercert(binary_form=True) != client_der:
                        raise TransportFault("CLIENT_IDENTITY_MISMATCH")
                    hello = _request(connection)
                    nonce = hello["payload"].get("clientNonce")
                    if hello["method"] != "hello" or set(hello["payload"]) != {"clientNonce"} or type(nonce) is not str or not 1 <= len(nonce) <= 128:
                        raise TransportFault("INVALID_HANDSHAKE")
                    session = {**owner, "processEpoch": process_epoch, "connectionNonce": str(uuid.uuid4())}
                    _reply(connection, hello, None, {"protocol": 1, **session, "clientNonce": nonce})
                    request = _request(connection, session)
                    admission = control if request["method"] in ("cancel", "query") else ordinary
                    if not admission.acquire(blocking=False):
                        _reply(connection, request, session, code="CHANNEL_BUSY")
                        return
                    try:
                        if request["method"] == "ping":
                            value = {"protocol": 1, **owner, "processEpoch": process_epoch, **workspace}
                        else:
                            value = dispatch(request["method"], request["payload"])
                        _reply(connection, request, session, value)
                    except Exception as error:
                        code = getattr(error, "code", "OPERATION_UNCONFIRMED")
                        if type(code) is not str or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code):
                            code = "OPERATION_UNCONFIRMED"
                        _reply(connection, request, session, code=code)
                    finally:
                        admission.release()
            except (OSError, EOFError, TransportFault, ValueError, RecursionError):
                pass  # No raw TLS/certificate/payload diagnostics are emitted by production.
            finally:
                if timer is not None:
                    timer.cancel()
                connection.close()
                slots.release()

        with socket.socket() as listener, ThreadPoolExecutor(max_workers=12, thread_name_prefix="ExecutionTLS") as workers:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind(("127.0.0.1", PORT))
            except OSError:
                raise TransportFault("PORT_IN_USE") from None
            listener.listen(12)
            while True:
                connection, _ = listener.accept()
                if slots.acquire(blocking=False):
                    workers.submit(handle, connection)
                else:
                    connection.close()
