"""Actual socket/OpenSSL boundary tests. Run in the validated Termux Python runtime."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import socket
import ssl
import struct
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import unittest

from execution_transport import TransportFault, bootstrap, serve


class TransportTests(unittest.TestCase):
    def test_public_pairing_is_stable_and_does_not_replace_client_or_ledger(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            client = self.client(root, "client")
            identity = {"protocol": 1, "executorId": "executor-one", "ledgerEpoch": "ledger-one"}
            first = bootstrap(root / "server", client, "first-challenge", identity)
            again = bootstrap(root / "server", client, "second-challenge", identity)
            self.assertEqual(first["serverSpkiSha256"], again["serverSpkiSha256"])
            self.assertEqual(first["serverCertificateDer"], again["serverCertificateDer"])
            self.assertEqual("second-challenge", again["nonce"])
            self.assertEqual(47193, first["port"])
            with self.assertRaises(TransportFault):
                bootstrap(root / "server", self.client(root, "other"), "third", identity)
            with self.assertRaises(TransportFault):
                bootstrap(root / "server", client, "third", {**identity, "ledgerEpoch": "replaced"})
            self.assertEqual(first["serverSpkiSha256"], bootstrap(root / "server", client, "last", identity)["serverSpkiSha256"])

    def test_bootstrap_rejects_boolean_protocol_and_partial_trust_without_repair(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            client = self.client(root, "client")
            with self.assertRaises(TransportFault):
                bootstrap(root / "boolean", client, "proof", {**IDENTITY, "protocol": True})
            bootstrap(root / "server", client, "proof", IDENTITY)
            original = (root / "server/transport/pairing.json").read_bytes()
            (root / "server/transport/server-cert.pem").unlink()
            with self.assertRaises(TransportFault):
                bootstrap(root / "server", client, "proof", IDENTITY)
            self.assertEqual(original, (root / "server/transport/pairing.json").read_bytes())
            self.assertFalse((root / "server/transport/server-cert.pem").exists())

    def test_authenticated_frames_reject_stale_session_and_reserve_cancellation(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            client = self.client(root, "client")
            bootstrap(root / "server", client, "proof", IDENTITY)
            process = subprocess.Popen([sys.executable, __file__, "--serve", str(root)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                self.wait_for(lambda: self.listening(process))
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.check_hostname = False
                context.load_verify_locations(cafile=str(root / "server/transport/server-cert.pem"))
                context.load_cert_chain(str(root / "client.pem"), str(root / "client.key"))
                def connected():
                    connection = context.wrap_socket(socket.create_connection(("127.0.0.1", 47193), timeout=3), server_hostname="localhost")
                    request = {"protocol": 1, "requestId": str(uuid.uuid4()), "method": "hello", "payload": {"clientNonce": str(uuid.uuid4())}}
                    send(connection, request)
                    response = receive(connection)
                    self.assertEqual(request["payload"]["clientNonce"], response["value"]["clientNonce"])
                    session = {key: response["value"][key] for key in ("executorId", "ledgerEpoch", "processEpoch", "connectionNonce")}
                    return connection, session
                def operation(method, payload):
                    connection, session = connected()
                    with connection:
                        request = {"protocol": 1, "requestId": str(uuid.uuid4()), "method": method, "payload": payload, "session": session}
                        send(connection, request)
                        response = receive(connection)
                        self.assertEqual(request["requestId"], response["requestId"])
                        self.assertEqual(session, response["session"])
                        return response
                self.assertEqual("通道 ✓ 🌍", operation("echo", {"text": "通道 ✓ 🌍"})["value"]["text"])
                self.assertEqual(IDENTITY["namespace"], operation("ping", {})["value"]["namespace"])
                self.assertEqual(IDENTITY["defaultWorkspace"], operation("ping", {})["value"]["defaultWorkspace"])
                connection, stale = connected()
                connection.close()
                connection, current = connected()
                with connection:
                    self.assertNotEqual(current["connectionNonce"], stale["connectionNonce"])
                    send(connection, {"protocol": 1, "requestId": "stale", "method": "echo", "payload": {}, "session": stale})
                    with self.assertRaises((EOFError, OSError)):
                        receive(connection)
                with ThreadPoolExecutor(max_workers=4) as workers:
                    held = [workers.submit(operation, "hold", {"id": index}) for index in range(4)]
                    try:
                        self.wait_for(lambda: len(list(root.glob("active-*"))) == 4)
                        self.assertEqual("CHANNEL_BUSY", operation("echo", {})["error"]["code"])
                        self.assertEqual(IDENTITY["executorId"], operation("ping", {})["value"]["executorId"], "Authenticated readiness must not consume an ordinary task slot")
                        self.assertEqual({"receipt": "probe"}, operation("query", {"receipt": "probe"})["value"])
                        started = time.monotonic()
                        self.assertTrue(operation("cancel", {})["value"]["controlReached"])
                        self.assertLess(time.monotonic() - started, 2)
                    finally:
                        (root / "release").touch()
                    self.assertTrue(all(value.result()["ok"] for value in held))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    @staticmethod
    def listening(process):
        if process.poll() is not None:
            raise AssertionError("Owned transport process exited before listening")
        try:
            with socket.create_connection(("127.0.0.1", 47193), timeout=.1):
                return True
        except OSError:
            return False

    @staticmethod
    def wait_for(predicate):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.025)
        raise AssertionError("Expected transport boundary not observed before timeout")

    @staticmethod
    def client(root, name):
        key, cert = root / f"{name}.key", root / f"{name}.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-sha256", "-days", "2", "-subj", "/CN=Execution transport test", "-keyout", str(key), "-out", str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return base64.b64encode(cert.read_bytes()).decode("ascii")


IDENTITY = {"protocol": 1, "executorId": "executor-one", "ledgerEpoch": "ledger-one", "namespace": "termux:executor-one", "defaultWorkspace": "/fixture/工作区"}


def send(connection, value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    connection.sendall(struct.pack("!I", len(data)) + data)


def receive(connection):
    def exact(count):
        data = b""
        while len(data) < count:
            part = connection.recv(count - len(data))
            if not part:
                raise EOFError()
            data += part
        return data
    size = struct.unpack("!I", exact(4))[0]
    if not 1 <= size <= 65536:
        raise AssertionError("Invalid response frame size")
    return json.loads(exact(size))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--serve":
        root = Path(sys.argv[2])
        def dispatch(method, payload):
            if method == "hold":
                (root / f"active-{payload['id']}").touch()
                deadline = time.monotonic() + 5
                while not (root / "release").exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                return {"released": True}
            if method == "cancel":
                return {"controlReached": True}
            return payload
        serve(root / "server", IDENTITY, dispatch)
    else:
        unittest.main()
