"""Authenticated Termux file capability, called only through the fixed local transport."""
import base64
import errno
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import threading
import time
import uuid

PAGE_BYTES = 32768
HANDLE_LIMIT = 32
HANDLE_IDLE_SECONDS = 300
FILE_BYTES = 16 * 1024 * 1024
DIFF_INPUT_BYTES = 32768
DIFF_BYTES = 16384


class FileFault(Exception):
    def __init__(self, code):
        self.code = code


def integer(value, maximum=9007199254740991):
    return type(value) is int and 0 <= value <= maximum


def absolute_path(value):
    if not isinstance(value, str) or not os.path.isabs(value) or "\0" in value or len(value.encode()) > 4096:
        raise FileFault("invalid")
    return value


def file_info(path, value):
    kind = "directory" if stat.S_ISDIR(value.st_mode) else "symlink" if stat.S_ISLNK(value.st_mode) else "file" if stat.S_ISREG(value.st_mode) else None
    if kind is None:
        raise FileFault("invalid")
    return {"name": os.path.basename(path), "path": path, "kind": kind, "size": value.st_size, "mtimeMs": value.st_mtime_ns // 1000000}


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def operation_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", value):
        raise FileFault("invalid")
    return value


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".file-record-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical_json(value).encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def bounded_file(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    chunks = []
    length = 0
    while length <= FILE_BYTES:
        chunk = os.read(fd, min(65536, FILE_BYTES + 1 - length))
        if not chunk:
            break
        chunks.append(chunk)
        length += len(chunk)
    if length > FILE_BYTES:
        raise FileFault("not_supported")
    return b"".join(chunks)


def fingerprint(info, data):
    return {"device": str(info.st_dev), "inode": str(info.st_ino), "size": len(data), "sha256": sha(data)}


def bounded_diff(before, after):
    if max(len(before), len(after)) > DIFF_INPUT_BYTES:
        return {"available": False, "reason": "too_large"}
    try:
        old, new = before.decode("utf-8"), after.decode("utf-8")
    except UnicodeError:
        return {"available": False, "reason": "binary"}
    if "\0" in old or "\0" in new:
        return {"available": False, "reason": "binary"}
    delta = "".join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True), fromfile="before", tofile="after"))
    if len(delta.encode()) > DIFF_BYTES:
        return {"available": False, "reason": "diff_too_large"}
    return {"available": True, "text": delta}


def record_path(root, identifier, suffix):
    operation_id(identifier)
    path = Path(root) / (identifier + suffix)
    if path.is_symlink():
        raise FileFault("invalid")
    return path


def read_record(path):
    if path.stat().st_size > 256 * 1024:
        raise FileFault("invalid")
    return json.loads(path.read_text())


def apply_write(root, identifier, boundary=None):
    """Fixed helper entrypoint. Only Executor launches it; there is no apply RPC."""
    plan_path, result_path = record_path(root, identifier, ".plan.json"), record_path(root, identifier, ".result.json")
    plan = read_record(plan_path)
    if result_path.exists():
        # A replay after an interrupted apply is never a license to repeat the write.
        return 0 if read_record(result_path)["state"] == "completed" else 1
    result = {"protocol": 1, "operationId": identifier, "namespace": plan["namespace"], "requestDigest": plan["requestDigest"], "state": "applying", "original": True, "path": plan["path"], "canonicalPath": plan["canonicalPath"], "before": plan["before"], "expectedAfter": plan["expectedAfter"], "diff": {"available": False, "reason": "unconfirmed"}}
    atomic_json(result_path, result)
    fd = None
    parent_fd = None
    touched = False
    try:
        parent_path = Path(plan["canonicalPath"]).parent
        parent_fd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        parent_info = os.fstat(parent_fd)
        if str(parent_info.st_dev) + ":" + str(parent_info.st_ino) != plan["position"]["ancestorObjectIds"][0]:
            raise FileFault("invalid")
        flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
        if plan["before"] is None:
            fd = os.open(Path(plan["canonicalPath"]).name, flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=parent_fd)
            touched = True
            old = b""
        else:
            fd = os.open(Path(plan["canonicalPath"]).name, flags, dir_fd=parent_fd)
            before_info = os.fstat(fd)
            if not stat.S_ISREG(before_info.st_mode):
                raise FileFault("invalid")
            old = bounded_file(fd)
            if fingerprint(before_info, old) != plan["before"]:
                raise FileFault("invalid")
        data = base64.b64decode(plan["data"], validate=True)
        os.lseek(fd, 0, os.SEEK_SET)
        touched = True
        offset = 0
        while offset < len(data):
            count = os.write(fd, data[offset:])
            if count <= 0:
                raise FileFault("unknown")
            offset += count
        os.ftruncate(fd, len(data))
        os.fsync(fd)
        # Local crash-injection seam only; never configurable through transport or CLI.
        if boundary is not None:
            boundary("after-effect")
        after_info = os.fstat(fd)
        after = bounded_file(fd)
        named = os.stat(plan["canonicalPath"], follow_symlinks=False)
        if fingerprint(after_info, after)["sha256"] != plan["expectedAfter"]["sha256"] or (named.st_dev, named.st_ino) != (after_info.st_dev, after_info.st_ino):
            raise FileFault("unknown")
        os.fsync(parent_fd)
        result.update(state="completed", after=fingerprint(after_info, after), diff=bounded_diff(old, after))
        atomic_json(result_path, result)
        return 0
    except (OSError, FileFault, ValueError):
        result.update(state="unknown" if touched else "not_started", reason="WRITE_NOT_CONFIRMED" if touched else "PRECONDITION_CHANGED")
        atomic_json(result_path, result)
        return 1
    finally:
        if fd is not None:
            os.close(fd)
        if parent_fd is not None:
            os.close(parent_fd)


class FileService:
    def __init__(self, namespace, state_root=None):
        self.namespace = namespace
        self.state_root = Path(state_root) if state_root is not None else None
        self.epoch = str(uuid.uuid4())
        self.handles = {}
        self.lock = threading.RLock()

    def dispatch(self, method, payload):
        schemas = {"file.open": {"path", "noFollow"}, "file.read": {"handle", "offset", "length"}, "file.info": {"handle"}, "file.close": {"handle"}, "file.stat": {"path"}, "file.canonical": {"path"}, "file.prepareWrite": {"operationId", "path", "mode", "data"}, "file.writeResult": {"operationId"}, "file.verifyWrite": {"operationId"}, "file.describe": set(), "file.resolveWrite": {"path"}}
        try:
            if method not in schemas or type(payload) is not dict or set(payload) != schemas[method]:
                raise FileFault("invalid")
            with self.lock:
                self.expire()
                if method == "file.open":
                    value = self.open(payload)
                elif method == "file.stat":
                    path = absolute_path(payload["path"])
                    value = file_info(path, os.lstat(path))
                elif method == "file.canonical":
                    value = os.path.realpath(absolute_path(payload["path"]), strict=True)
                elif method == "file.prepareWrite":
                    value = self.prepare_write(payload)
                elif method == "file.verifyWrite":
                    value = self.verify_write(payload["operationId"])
                elif method == "file.describe":
                    value = {"protocol": 1, "namespace": self.namespace, "applyArgvPrefix": [sys.executable, str(Path(__file__).resolve()), "apply", str(self.write_root().resolve())]}
                elif method == "file.resolveWrite":
                    value = self.resolve_write(payload["path"])
                elif method == "file.writeResult":
                    root = self.write_root()
                    plan = read_record(record_path(root, payload["operationId"], ".plan.json"))
                    result = record_path(root, payload["operationId"], ".result.json")
                    value = read_record(result) if result.exists() else {"protocol": 1, "operationId": payload["operationId"], "namespace": self.namespace, "requestDigest": plan["requestDigest"], "state": "prepared"}
                elif method == "file.close":
                    handle = self.handles.pop(payload["handle"], None)
                    if handle:
                        os.close(handle["fd"])
                    value = None
                elif method == "file.info":
                    handle = self.handles.get(payload["handle"])
                    if handle is None:
                        raise FileFault("unknown")
                    handle["lastUsed"] = time.monotonic()
                    value = file_info(handle["path"], os.fstat(handle["fd"]))
                else:
                    value = self.read(payload)
                return {"ok": True, "value": value}
        except FileFault as error:
            return {"ok": False, "error": {"code": error.code}}
        except OSError as error:
            codes = {errno.ENOENT: "not_found", errno.EACCES: "permission_denied", errno.EPERM: "permission_denied", errno.ENOTDIR: "not_directory", errno.EISDIR: "is_directory", errno.ELOOP: "invalid", errno.EINVAL: "invalid"}
            return {"ok": False, "error": {"code": codes.get(error.errno, "unknown")}}
        except (ValueError, TypeError):
            return {"ok": False, "error": {"code": "invalid"}}

    def open(self, payload):
        path = absolute_path(payload["path"])
        if type(payload["noFollow"]) is not bool:
            raise FileFault("invalid")
        if len(self.handles) >= HANDLE_LIMIT:
            raise FileFault("unknown")
        flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
        if payload["noFollow"]:
            if not hasattr(os, "O_NOFOLLOW"):
                raise FileFault("not_supported")
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags)
        try:
            info = file_info(path, os.fstat(fd))
            if info["kind"] == "directory":
                raise FileFault("is_directory")
            token = str(uuid.uuid4())
            self.handles[token] = {"fd": fd, "path": path, "lastUsed": time.monotonic()}
            return {"handle": token, "epoch": self.epoch, "namespace": self.namespace, "info": info}
        except BaseException:
            os.close(fd)
            raise

    def write_root(self):
        if self.state_root is None:
            raise FileFault("not_supported")
        if self.state_root.is_symlink():
            raise FileFault("invalid")
        self.state_root.mkdir(mode=0o700, exist_ok=True)
        return self.state_root

    def verify_write(self, identifier):
        plan = read_record(record_path(self.write_root(), identifier, ".plan.json"))
        fd = os.open(plan["canonicalPath"], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode):
                raise FileFault("invalid")
            data = bounded_file(fd)
            after = os.fstat(fd)
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise FileFault("unknown")
            observed = fingerprint(after, data)
            parent = Path(plan["canonicalPath"]).parent.stat()
            same_parent = str(parent.st_dev) + ":" + str(parent.st_ino) == plan["position"]["ancestorObjectIds"][0]
            original = plan["before"]
            same_file = original is None or (original["device"], original["inode"]) == (observed["device"], observed["inode"])
            matches = same_parent and same_file and observed["size"] == plan["expectedAfter"]["size"] and observed["sha256"] == plan["expectedAfter"]["sha256"]
            # This is an observation of the original, never a process-death or cancellation claim.
            return {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": plan["requestDigest"], "matchesExpected": matches, "observed": observed, "observedAtMs": time.time_ns() // 1000000, "scopeConfirmed": False}
        finally:
            os.close(fd)

    def resolve_write(self, path):
        path = absolute_path(path)
        canonical_path = os.path.realpath(path, strict=True) if os.path.lexists(path) else os.path.join(os.path.realpath(os.path.dirname(path), strict=True), os.path.basename(path))
        object_id = None
        if os.path.exists(canonical_path):
            current = os.stat(canonical_path)
            file_info(canonical_path, current)
            object_id = str(current.st_dev) + ":" + str(current.st_ino)
        ancestors = []
        parent = Path(canonical_path).parent
        for ancestor in [parent, *parent.parents]:
            value = ancestor.stat()
            ancestors.append(str(value.st_dev) + ":" + str(value.st_ino))
            if len(ancestors) > 128:
                raise FileFault("not_supported")
        return {"namespace": self.namespace, "canonicalPath": canonical_path, "objectId": object_id, "ancestorObjectIds": ancestors}

    def prepare_write(self, payload):
        identifier = operation_id(payload["operationId"])
        path = absolute_path(payload["path"])
        if payload["mode"] != "write" or not isinstance(payload["data"], str) or len(payload["data"]) > 45000:
            raise FileFault("invalid")
        data = base64.b64decode(payload["data"], validate=True)
        if len(data) > PAGE_BYTES or base64.b64encode(data).decode() != payload["data"]:
            raise FileFault("invalid")
        root = self.write_root()
        plan_path = record_path(root, identifier, ".plan.json")
        requested = sha(canonical_json({**payload, "namespace": self.namespace}).encode())
        if plan_path.exists():
            plan = read_record(plan_path)
            if plan["requestDigest"] != requested:
                raise FileFault("invalid")
        else:
            canonical_path = os.path.realpath(path, strict=True) if os.path.lexists(path) else os.path.join(os.path.realpath(os.path.dirname(path), strict=True), os.path.basename(path))
            before = None
            if os.path.exists(canonical_path):
                fd = os.open(canonical_path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
                try:
                    metadata = os.fstat(fd)
                    if not stat.S_ISREG(metadata.st_mode):
                        raise FileFault("is_directory" if stat.S_ISDIR(metadata.st_mode) else "invalid")
                    before = fingerprint(metadata, bounded_file(fd))
                finally:
                    os.close(fd)
            ancestors = []
            parent = Path(canonical_path).parent
            for ancestor in [parent, *parent.parents]:
                value = ancestor.stat()
                ancestors.append(str(value.st_dev) + ":" + str(value.st_ino))
            position = {"namespace": self.namespace, "canonicalPath": canonical_path, "objectId": before["device"] + ":" + before["inode"] if before else None, "ancestorObjectIds": ancestors}
            plan = {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "path": path, "canonicalPath": canonical_path, "before": before, "expectedAfter": {"size": len(data), "sha256": sha(data)}, "data": payload["data"], "position": position}
            atomic_json(plan_path, plan)
        return {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "position": plan["position"], "original": True, "argv": [sys.executable, str(Path(__file__).resolve()), "apply", str(root.resolve()), identifier]}

    def read(self, payload):
        if not integer(payload["offset"]) or not integer(payload["length"], PAGE_BYTES):
            raise FileFault("invalid")
        handle = self.handles.get(payload["handle"])
        if handle is None:
            raise FileFault("unknown")
        handle["lastUsed"] = time.monotonic()
        os.lseek(handle["fd"], payload["offset"], os.SEEK_SET)
        data = os.read(handle["fd"], payload["length"])
        return {"handle": payload["handle"], "epoch": self.epoch, "namespace": self.namespace, "offset": payload["offset"], "data": base64.b64encode(data).decode()}

    def expire(self):
        for token, handle in list(self.handles.items()):
            if time.monotonic() - handle["lastUsed"] > HANDLE_IDLE_SECONDS:
                os.close(handle["fd"])
                del self.handles[token]

    def close(self):
        with self.lock:
            for handle in self.handles.values():
                os.close(handle["fd"])
            self.handles.clear()


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "apply":
        raise SystemExit(2)
    raise SystemExit(apply_write(sys.argv[2], sys.argv[3]))
