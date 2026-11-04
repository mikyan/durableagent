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
STAGED_BYTES = 128 * 1024 * 1024


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


def content_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise FileFault("invalid")
    return value


def read_blob(root, reference):
    digest = content_digest(reference["digest"])
    size = reference["totalBytes"]
    if not integer(size, FILE_BYTES):
        raise FileFault("invalid")
    path = Path(root) / "blobs" / (digest + ".blob")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size != size:
            raise FileFault("invalid")
        data = bounded_file(fd)
        if len(data) != size or sha(data) != digest:
            raise FileFault("invalid")
        return data
    finally:
        os.close(fd)


def read_rename_entry(path, parent_fd=None, missing=False):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    except FileNotFoundError:
        if missing:
            return None
        raise
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise FileFault("is_directory" if stat.S_ISDIR(metadata.st_mode) else "not_supported")
        return fingerprint(metadata, bounded_file(fd))
    finally:
        os.close(fd)


def apply_rename(root, identifier, plan, boundary=None):
    result_path = record_path(root, identifier, ".result.json")
    if result_path.exists():
        return 0 if read_record(result_path)["state"] == "completed" else 1
    result = {"protocol": 1, "operationId": identifier, "namespace": plan["namespace"], "requestDigest": plan["requestDigest"], "state": "applying", "original": True, "path": plan["path"], "canonicalPath": plan["canonicalPath"], "destination": plan["destination"], "before": plan["before"], "expectedAfter": plan["expectedAfter"], "diff": {"available": False, "reason": "unconfirmed"}}
    atomic_json(result_path, result)
    parents, touched = [], False
    try:
        for path, position in ((plan["canonicalPath"], plan["position"]), (plan["destination"], plan["destinationPosition"])):
            fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            parents.append(fd)
            metadata = os.fstat(fd)
            if str(metadata.st_dev) + ":" + str(metadata.st_ino) != position["ancestorObjectIds"][0]:
                raise FileFault("invalid")
        source, destination = Path(plan["canonicalPath"]).name, Path(plan["destination"]).name
        if read_rename_entry(source, parents[0]) != plan["before"] or read_rename_entry(destination, parents[1], missing=True) != plan["destinationBefore"]:
            raise FileFault("invalid")
        touched = True
        os.rename(source, destination, src_dir_fd=parents[0], dst_dir_fd=parents[1])
        for parent in parents:
            os.fsync(parent)
        if boundary is not None:
            boundary("after-effect")
        after = read_rename_entry(destination, parents[1])
        if after != plan["before"] or plan["canonicalPath"] != plan["destination"] and os.path.lexists(plan["canonicalPath"]):
            raise FileFault("unknown")
        result.update(state="completed", after=after, diff={"available": True, "text": ""})
        atomic_json(result_path, result)
        return 0
    except (OSError, FileFault, ValueError):
        result.update(state="unknown" if touched else "not_started", reason="RENAME_NOT_CONFIRMED" if touched else "PRECONDITION_CHANGED")
        atomic_json(result_path, result)
        return 1
    finally:
        for parent in parents:
            os.close(parent)


def apply_write(root, identifier, boundary=None):
    """Fixed helper entrypoint. Only Executor launches it; there is no apply RPC."""
    plan_path, result_path = record_path(root, identifier, ".plan.json"), record_path(root, identifier, ".result.json")
    plan = read_record(plan_path)
    if plan.get("mode") == "rename":
        return apply_rename(root, identifier, plan, boundary)
    if result_path.exists():
        # A replay after an interrupted apply is never a license to repeat the write.
        return 0 if read_record(result_path)["state"] == "completed" else 1
    result = {"protocol": 1, "operationId": identifier, "namespace": plan["namespace"], "requestDigest": plan["requestDigest"], "state": "applying", "original": True, "path": plan["path"], "canonicalPath": plan["canonicalPath"], "before": plan["before"], "expectedAfter": plan["expectedAfter"], "diff": {"available": False, "reason": "unconfirmed"}}
    atomic_json(result_path, result)
    fd = None
    parent_fd = None
    touched = False
    try:
        parent_path = Path(plan["position"].get("parentAnchor", str(Path(plan["canonicalPath"]).parent)))
        parent_fd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        parent_info = os.fstat(parent_fd)
        if str(parent_info.st_dev) + ":" + str(parent_info.st_ino) != plan["position"]["ancestorObjectIds"][0]:
            raise FileFault("invalid")
        created = []
        for name in plan["position"].get("missingParents", []):
            if not isinstance(name, str) or not name or name in (".", "..") or "/" in name or "\0" in name:
                raise FileFault("invalid")
            touched = True
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
                created.append(str(parent_path / name))
                os.fsync(parent_fd)
            except FileExistsError:
                pass
            next_parent = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
            os.close(parent_fd)
            parent_fd = next_parent
            parent_path = parent_path / name
        parent_info = os.fstat(parent_fd)
        result.update(parentObjectId=str(parent_info.st_dev) + ":" + str(parent_info.st_ino), createdParents=created)
        atomic_json(result_path, result)
        mode = plan.get("mode", "write")
        flags = (os.O_RDONLY if mode == "flush" else os.O_RDWR) | os.O_NOFOLLOW | os.O_NONBLOCK
        if plan.get("mode", "write") == "append":
            flags |= os.O_APPEND
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
        data = read_blob(root, plan["contentRef"]) if "contentRef" in plan else base64.b64decode(plan["data"], validate=True)
        if mode == "write":
            os.lseek(fd, 0, os.SEEK_SET)
        touched = True
        offset = 0
        while offset < len(data):
            count = os.write(fd, data[offset:])
            if count <= 0:
                raise FileFault("unknown")
            offset += count
        if mode == "write":
            os.ftruncate(fd, len(data))
        elif mode == "truncate":
            os.ftruncate(fd, plan["size"])
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
        schemas = {"file.open": {"path", "noFollow"}, "file.read": {"handle", "offset", "length"}, "file.info": {"handle"}, "file.close": {"handle"}, "file.stat": {"path"}, "file.canonical": {"path"}, "file.prepareWrite": {"operationId", "path", "mode", "data"}, "file.prepareStagedWrite": {"operationId", "path", "mode", "digest", "totalBytes"}, "file.prepareMutation": {"operationId", "path", "kind", "options"}, "file.stage": {"digest", "totalBytes", "offset", "data"}, "file.writeResult": {"operationId"}, "file.verifyWrite": {"operationId"}, "file.describe": set(), "file.resolveWrite": {"path"}, "file.openDir": {"path"}, "file.readDir": {"handle", "maxEntries"}, "file.snapshot": {"targets"}}
        try:
            if method not in schemas or type(payload) is not dict or set(payload) != schemas[method]:
                raise FileFault("invalid")
            with self.lock:
                self.expire()
                if method == "file.open":
                    value = self.open(payload)
                elif method == "file.openDir":
                    value = self.open_directory(payload["path"])
                elif method == "file.readDir":
                    value = self.read_directory(payload)
                elif method == "file.stat":
                    path = absolute_path(payload["path"])
                    value = file_info(path, os.lstat(path))
                elif method == "file.canonical":
                    value = os.path.realpath(absolute_path(payload["path"]), strict=True)
                elif method == "file.prepareWrite":
                    value = self.prepare_write(payload)
                elif method == "file.prepareStagedWrite":
                    value = self.prepare_write(payload, staged=True)
                elif method == "file.prepareMutation":
                    value = self.prepare_mutation(payload)
                elif method == "file.snapshot":
                    value = self.snapshot(payload["targets"])
                elif method == "file.stage":
                    value = self.stage(payload)
                elif method == "file.verifyWrite":
                    value = self.verify_write(payload["operationId"])
                elif method == "file.describe":
                    value = {"protocol": 1, "namespace": self.namespace, "maxWriteBytes": FILE_BYTES, "chunkBytes": PAGE_BYTES, "applyArgvPrefix": [sys.executable, str(Path(__file__).resolve()), "apply", str(self.write_root().resolve())]}
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
                        self.close_handle(handle)
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

    def snapshot(self, targets):
        if type(targets) is not list or not 1 <= len(targets) <= 32:
            raise FileFault("invalid")
        snapshots = []
        scanned, total_bytes = 0, 0
        for target in targets:
            if type(target) is not dict or set(target) != {"path", "recursive", "exclude"} or type(target["recursive"]) is not bool:
                raise FileFault("invalid")
            path, exclude = absolute_path(target["path"]), target["exclude"]
            if type(exclude) is not dict or set(exclude) != {"hidden", "names"} or type(exclude["hidden"]) is not bool or type(exclude["names"]) is not list or len(exclude["names"]) > 128 or any(not isinstance(name, str) or not name or "/" in name or "\0" in name for name in exclude["names"]):
                raise FileFault("invalid")
            records = []

            def visit(current, depth):
                nonlocal scanned, total_bytes
                scanned += 1
                if scanned > 2048 or depth > 64:
                    raise FileFault("not_supported")
                try:
                    value = os.lstat(current)
                except FileNotFoundError:
                    records.append([current, "missing"])
                    return
                # A selected root symlink represents its selected target; descendant links are not followed.
                if depth == 0 and stat.S_ISLNK(value.st_mode):
                    records.append([current, "root-link", os.readlink(current)])
                    value = os.stat(current)
                directory = stat.S_ISDIR(value.st_mode)
                record = [current, str(value.st_dev), str(value.st_ino), value.st_mode]
                if not directory:
                    record.extend([value.st_size, value.st_mtime_ns, value.st_ctime_ns])
                encoded = canonical_json(record).encode()
                total_bytes += len(encoded)
                if total_bytes > 1024 * 1024:
                    raise FileFault("not_supported")
                records.append(record)
                if directory and (depth == 0 or target["recursive"]):
                    with os.scandir(current) as entries:
                        for entry in entries:
                            if exclude["hidden"] and entry.name.startswith(".") or entry.name in exclude["names"]:
                                scanned += 1
                                if scanned > 2048:
                                    raise FileFault("not_supported")
                                continue
                            visit(entry.path, depth + 1)

            visit(path, 0)
            records.sort(key=canonical_json)
            snapshots.append({"path": path, "revision": sha(canonical_json(records).encode())})
        return {"namespace": self.namespace, "epoch": self.epoch, "snapshots": snapshots}

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
        renamed = plan.get("mode") == "rename"
        observed_path = plan["destination"] if renamed else plan["canonicalPath"]
        position = plan["destinationPosition"] if renamed else plan["position"]
        fd = os.open(observed_path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode):
                raise FileFault("invalid")
            data = bounded_file(fd)
            after = os.fstat(fd)
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise FileFault("unknown")
            observed = fingerprint(after, data)
            parent = Path(observed_path).parent.stat()
            parent_identity = position["ancestorObjectIds"][0]
            if position.get("missingParents"):
                result_path = record_path(self.write_root(), identifier, ".result.json")
                parent_identity = read_record(result_path).get("parentObjectId") if result_path.exists() else None
            same_parent = str(parent.st_dev) + ":" + str(parent.st_ino) == parent_identity
            original = plan["before"]
            same_file = original is None or (original["device"], original["inode"]) == (observed["device"], observed["inode"])
            matches = same_parent and same_file and observed["size"] == plan["expectedAfter"]["size"] and observed["sha256"] == plan["expectedAfter"]["sha256"]
            if renamed and plan["canonicalPath"] != plan["destination"] and os.path.lexists(plan["canonicalPath"]):
                matches = False
            # This is an observation of the original, never a process-death or cancellation claim.
            return {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": plan["requestDigest"], "matchesExpected": matches, "observed": observed, "observedAtMs": time.time_ns() // 1000000, "scopeConfirmed": False}
        finally:
            os.close(fd)

    def resolve_write(self, path):
        path = os.path.normpath(absolute_path(path))
        missing_parents = []
        if os.path.lexists(path):
            canonical_path = os.path.realpath(path, strict=True)
            parent = Path(canonical_path).parent
        else:
            parent = Path(path).parent
            while not parent.exists():
                if parent.is_symlink():
                    os.path.realpath(parent, strict=True)
                missing_parents.insert(0, parent.name)
                parent = parent.parent
                if len(missing_parents) > 64:
                    raise FileFault("not_supported")
            parent = Path(os.path.realpath(parent, strict=True))
            if not parent.is_dir():
                raise FileFault("not_directory")
            canonical_path = str(parent.joinpath(*missing_parents, Path(path).name))
        object_id = None
        if os.path.exists(canonical_path):
            current = os.stat(canonical_path)
            file_info(canonical_path, current)
            object_id = str(current.st_dev) + ":" + str(current.st_ino)
        ancestors = []
        for ancestor in [parent, *parent.parents]:
            value = ancestor.stat()
            ancestors.append(str(value.st_dev) + ":" + str(value.st_ino))
            if len(ancestors) > 128:
                raise FileFault("not_supported")
        return {"namespace": self.namespace, "canonicalPath": canonical_path, "objectId": object_id, "ancestorObjectIds": ancestors, **({"parentAnchor": str(parent), "missingParents": missing_parents, "writeRoot": str(parent / missing_parents[0])} if missing_parents else {})}

    def stage(self, payload):
        digest = content_digest(payload["digest"])
        total, offset = payload["totalBytes"], payload["offset"]
        if not integer(total, FILE_BYTES) or not integer(offset, total) or not isinstance(payload["data"], str) or len(payload["data"]) > 45000:
            raise FileFault("invalid")
        data = base64.b64decode(payload["data"], validate=True)
        if len(data) > PAGE_BYTES or offset + len(data) > total or base64.b64encode(data).decode() != payload["data"]:
            raise FileFault("invalid")
        root = self.write_root()
        blobs = root / "blobs"
        if blobs.is_symlink():
            raise FileFault("invalid")
        blobs.mkdir(mode=0o700, exist_ok=True)
        sealed, partial = blobs / (digest + ".blob"), blobs / (digest + ".part")
        if sealed.exists():
            existing = read_blob(root, payload)
            if existing[offset:offset+len(data)] != data:
                raise FileFault("invalid")
            return {"namespace": self.namespace, "digest": digest, "totalBytes": total, "nextOffset": total, "sealed": True}
        used = sum(entry.stat(follow_symlinks=False).st_size for entry in blobs.iterdir())
        if used + len(data) > STAGED_BYTES:
            raise FileFault("not_supported")
        fd = os.open(partial, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode) or not offset <= metadata.st_size <= total:
                raise FileFault("invalid")
            overlap = min(len(data), metadata.st_size - offset)
            os.lseek(fd, offset, os.SEEK_SET)
            if os.read(fd, overlap) != data[:overlap]:
                raise FileFault("invalid")
            os.lseek(fd, metadata.st_size, os.SEEK_SET)
            written = overlap
            while written < len(data):
                count = os.write(fd, data[written:])
                if count <= 0:
                    raise FileFault("unknown")
                written += count
            os.fsync(fd)
            next_offset = os.fstat(fd).st_size
            complete = next_offset == total
            if complete and sha(bounded_file(fd)) != digest:
                raise FileFault("invalid")
        finally:
            os.close(fd)
        if complete:
            os.replace(partial, sealed)
            directory = os.open(blobs, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return {"namespace": self.namespace, "digest": digest, "totalBytes": total, "nextOffset": next_offset, "sealed": complete}

    def prepare_mutation(self, payload):
        kind, options = payload["kind"], payload["options"]
        if kind == "rename":
            return self.prepare_rename(payload)
        if type(options) is not dict or kind not in ("truncate", "flush"):
            raise FileFault("invalid")
        if kind == "truncate":
            if set(options) != {"size"} or not integer(options["size"], FILE_BYTES):
                raise FileFault("invalid")
        elif options:
            raise FileFault("invalid")
        return self.prepare_write({"operationId": payload["operationId"], "path": payload["path"], "mode": kind, "data": "", **options}, mutation=True)

    def prepare_rename(self, payload):
        identifier, path = operation_id(payload["operationId"]), absolute_path(payload["path"])
        options = payload["options"]
        if type(options) is not dict or set(options) != {"destination"}:
            raise FileFault("invalid")
        destination = absolute_path(options["destination"])
        requested = sha(canonical_json({"operationId": identifier, "path": path, "mode": "rename", "destination": destination, "namespace": self.namespace}).encode())
        root = self.write_root()
        plan_path = record_path(root, identifier, ".plan.json")
        if plan_path.exists():
            plan = read_record(plan_path)
            if plan["requestDigest"] != requested:
                raise FileFault("invalid")
        else:
            # This first contract supports regular files. Final symlinks are not followed for rename.
            if os.path.islink(path) or os.path.islink(destination):
                raise FileFault("not_supported")
            before = read_rename_entry(path)
            old_destination = read_rename_entry(destination, missing=True)
            position, destination_position = self.resolve_write(path), self.resolve_write(destination)
            plan = {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "path": path, "canonicalPath": position["canonicalPath"], "mode": "rename", "before": before, "destination": destination_position["canonicalPath"], "destinationBefore": old_destination, "destinationPosition": destination_position, "expectedAfter": {"size": before["size"], "sha256": before["sha256"]}, "position": position}
            atomic_json(plan_path, plan)
        return {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "position": plan["position"], "expectedAfter": plan["expectedAfter"], "destination": plan["destination"], "original": True, "argv": [sys.executable, str(Path(__file__).resolve()), "apply", str(root.resolve()), identifier]}

    def prepare_write(self, payload, staged=False, mutation=False):
        identifier = operation_id(payload["operationId"])
        path = absolute_path(payload["path"])
        if payload["mode"] not in (("truncate", "flush") if mutation else ("write", "append")):
            raise FileFault("invalid")
        root = self.write_root()
        if staged:
            data = read_blob(root, payload)
        else:
            if not isinstance(payload["data"], str) or len(payload["data"]) > 45000:
                raise FileFault("invalid")
            data = base64.b64decode(payload["data"], validate=True)
            if len(data) > PAGE_BYTES or base64.b64encode(data).decode() != payload["data"]:
                raise FileFault("invalid")
            self.stage({"digest": sha(data), "totalBytes": len(data), "offset": 0, "data": payload["data"]})
        reference = {"digest": sha(data), "totalBytes": len(data)}
        plan_path = record_path(root, identifier, ".plan.json")
        extra = {"size": payload["size"]} if payload["mode"] == "truncate" else {}
        requested = sha(canonical_json({"operationId": identifier, "path": path, "mode": payload["mode"], **extra, **reference, "namespace": self.namespace}).encode())
        if plan_path.exists():
            plan = read_record(plan_path)
            if plan["requestDigest"] != requested:
                raise FileFault("invalid")
        else:
            if mutation:
                os.path.realpath(path, strict=True)
            position = self.resolve_write(path)
            canonical_path = position["canonicalPath"]
            before = None
            old_data = b""
            if os.path.exists(canonical_path):
                fd = os.open(canonical_path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
                try:
                    metadata = os.fstat(fd)
                    if not stat.S_ISREG(metadata.st_mode):
                        raise FileFault("is_directory" if stat.S_ISDIR(metadata.st_mode) else "invalid")
                    old_data = bounded_file(fd)
                    before = fingerprint(metadata, old_data)
                finally:
                    os.close(fd)
            if position["objectId"] != (before["device"] + ":" + before["inode"] if before else None):
                raise FileFault("unknown")
            expected = old_data + data if payload["mode"] == "append" else data
            if payload["mode"] == "truncate":
                expected = old_data[:payload["size"]].ljust(payload["size"], b"\0")
            elif payload["mode"] == "flush":
                expected = old_data
            if len(expected) > FILE_BYTES:
                raise FileFault("not_supported")
            plan = {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "path": path, "canonicalPath": canonical_path, "mode": payload["mode"], **extra, "before": before, "expectedAfter": {"size": len(expected), "sha256": sha(expected)}, "contentRef": reference, "position": position}
            atomic_json(plan_path, plan)
        return {"protocol": 1, "operationId": identifier, "namespace": self.namespace, "requestDigest": requested, "position": plan["position"], "expectedAfter": plan["expectedAfter"], "original": True, "argv": [sys.executable, str(Path(__file__).resolve()), "apply", str(root.resolve()), identifier]}

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

    def open_directory(self, path):
        path = absolute_path(path)
        if len(self.handles) >= HANDLE_LIMIT:
            raise FileFault("unknown")
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            iterator = os.scandir(fd)
            token = str(uuid.uuid4())
            self.handles[token] = {"fd": fd, "path": path, "lastUsed": time.monotonic(), "iterator": iterator, "done": False, "pending": None}
            return {"handle": token, "epoch": self.epoch, "namespace": self.namespace}
        except BaseException:
            os.close(fd)
            raise

    def read_directory(self, payload):
        if not integer(payload["maxEntries"], 128) or payload["maxEntries"] == 0:
            raise FileFault("invalid")
        handle = self.handles.get(payload["handle"])
        if handle is None:
            raise FileFault("unknown")
        if "iterator" not in handle:
            raise FileFault("not_directory")
        handle["lastUsed"] = time.monotonic()
        entries = []
        size = 0
        while len(entries) < payload["maxEntries"] and not handle["done"]:
            info = handle["pending"]
            if info is None:
                try:
                    entry = next(handle["iterator"])
                except StopIteration:
                    handle["done"] = True
                    break
                try:
                    info = file_info(os.path.join(handle["path"], entry.name), entry.stat(follow_symlinks=False))
                except (FileNotFoundError, FileFault):
                    continue
            entry_size = len(canonical_json(info).encode()) + 1
            if size + entry_size > PAGE_BYTES:
                handle["pending"] = info
                break
            entries.append(info)
            size += entry_size
            handle["pending"] = None
        return {"handle": payload["handle"], "epoch": self.epoch, "namespace": self.namespace, "entries": entries, "done": handle["done"]}

    @staticmethod
    def close_handle(handle):
        try:
            if "iterator" in handle:
                handle["iterator"].close()
        finally:
            os.close(handle["fd"])

    def expire(self):
        for token, handle in list(self.handles.items()):
            if time.monotonic() - handle["lastUsed"] > HANDLE_IDLE_SECONDS:
                self.close_handle(handle)
                del self.handles[token]

    def close(self):
        with self.lock:
            for handle in self.handles.values():
                self.close_handle(handle)
            self.handles.clear()


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "apply":
        raise SystemExit(2)
    raise SystemExit(apply_write(sys.argv[2], sys.argv[3]))
