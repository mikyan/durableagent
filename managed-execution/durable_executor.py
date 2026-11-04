"""DurableAgent's local command endpoint. It does not own Agent conversations."""
import hashlib
import argparse
import base64
import ctypes
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
try:
    import fcntl
except ImportError:
    fcntl = None

OUTPUT_LIMIT = 16 * 1024 * 1024
RETAINED_OUTPUT_LIMIT = 128 * 1024 * 1024
EXECUTION_LIMIT = 4096
DEFAULT_LIMITS = {"outputChunks": 4096, "retainedChunks": 32768, "preparedBytes": 65536}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class ExecutionFault(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def text(value, maximum=32768):
    return isinstance(value, str) and "\0" not in value and len(value.encode("utf-8")) <= maximum


def positive(value, maximum=9007199254740991):
    return type(value) is int and 0 < value <= maximum


class ProcessScope:
    """Only descendants of this live guardian; never signal an unverified numeric PID."""
    def __init__(self):
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        self.libc.prctl.restype = ctypes.c_int
        if self.libc.prctl(36, 1, 0, 0, 0) != 0:
            raise ExecutionFault("SUBREAPER_UNAVAILABLE")

    def descendants(self):
        # Android kernels may omit CONFIG_PROC_CHILDREN entirely. Walk readable
        # same-UID process identities, then verify each candidate again after pidfd_open.
        found = set()
        for entry in Path("/proc").iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                if entry.stat().st_uid != os.getuid():
                    continue
                pid = int(entry.name)
                if pid != os.getpid() and self.owns(pid):
                    found.add(pid)
                    if len(found) > 1024:
                        raise ExecutionFault("DESCENDANT_LIMIT")
            except FileNotFoundError:
                continue
        return found

    def owns(self, pid):
        seen = set()
        while pid > 1 and pid not in seen:
            if pid == os.getpid():
                return True
            seen.add(pid)
            try:
                stat = (Path("/proc") / str(pid) / "stat").read_text()
            except FileNotFoundError:
                return False
            pid = int(stat[stat.rfind(")") + 2:].split()[1])
        return False

    def open_pidfd(self, pid):
        if hasattr(os, "pidfd_open"):
            return os.pidfd_open(pid)
        self.libc.pidfd_open.argtypes = [ctypes.c_int, ctypes.c_uint]
        self.libc.pidfd_open.restype = ctypes.c_int
        result = self.libc.pidfd_open(pid, 0)
        if result < 0:
            raise OSError(ctypes.get_errno(), "pidfd_open")
        return result

    def send(self, fd, sig):
        if hasattr(signal, "pidfd_send_signal"):
            signal.pidfd_send_signal(fd, sig)
            return
        self.libc.pidfd_send_signal.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
        self.libc.pidfd_send_signal.restype = ctypes.c_int
        if self.libc.pidfd_send_signal(fd, sig, None, 0) < 0:
            raise OSError(ctypes.get_errno(), "pidfd_send_signal")

    def cancel(self, force=False):
        for pid in self.descendants():
            try:
                # Open first, then recheck membership. The fd continues to name that process after exit/reuse.
                fd = self.open_pidfd(pid)
                try:
                    if not self.owns(pid):
                        continue
                    self.send(fd, signal.SIGKILL if force else signal.SIGTERM)
                finally:
                    os.close(fd)
            except ProcessLookupError:
                pass

    def close(self):
        pass


class Executor:
    def __init__(self, root, boundary=None, limits=None):
        # Local fault-injection seam for crash tests; never selectable over the transport.
        self.boundary = boundary or (lambda stage: None)
        # Local construction may narrow budgets for a deployment/test, never raise
        # the compiled ceilings. Public bootstrap/serve always use the defaults.
        if limits is not None and (not isinstance(limits, dict) or set(limits) - set(DEFAULT_LIMITS)):
            raise ExecutionFault("INVALID_LIMITS")
        self.limits = {**DEFAULT_LIMITS, **(limits or {})}
        if any(type(value) is not int or not 0 < value <= DEFAULT_LIMITS[key] for key, value in self.limits.items()) or self.limits["outputChunks"] > self.limits["retainedChunks"]:
            raise ExecutionFault("INVALID_LIMITS")
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / "workspace").mkdir(exist_ok=True, mode=0o700)
        (self.root / "owners").mkdir(exist_ok=True, mode=0o700)
        (self.root / "outputs").mkdir(exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.workers = set()
        self.write_gate = os.open(self.root / "writes.lock", os.O_RDWR | os.O_CREAT, 0o600)
        if fcntl is not None:
            fcntl.flock(self.write_gate, fcntl.LOCK_EX)
        try:
            self.db = sqlite3.connect(str(self.root / "execution.sqlite"), timeout=5, check_same_thread=False)
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            version = self.db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                self.db.close()
                raise ExecutionFault("LEDGER_VERSION_UNSUPPORTED")
            with self.db:
                self.db.execute("CREATE TABLE IF NOT EXISTS identity (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT")
                self.db.execute("CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, request TEXT NOT NULL, receipt TEXT NOT NULL) STRICT")
                self.db.execute("CREATE TABLE IF NOT EXISTS prepared (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT")
                self.db.execute("CREATE TABLE IF NOT EXISTS output (id TEXT NOT NULL, sequence INTEGER NOT NULL, stream TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(id, sequence)) STRICT")
                self.db.execute("CREATE TABLE IF NOT EXISTS cancelled_ids (id TEXT PRIMARY KEY, receipt TEXT NOT NULL) STRICT")
                self.db.execute("INSERT OR IGNORE INTO identity VALUES ('executorId', ?)", (str(uuid.uuid4()),))
                self.db.execute("INSERT OR IGNORE INTO identity VALUES ('ledgerEpoch', ?)", (str(uuid.uuid4()),))
                self.db.execute("PRAGMA user_version=1")
            self.meta = dict(self.db.execute("SELECT key, value FROM identity"))
            self.meta.update(protocol=1, namespace="termux:" + self.meta["executorId"], defaultWorkspace=str((self.root / "workspace").absolute()))
        finally:
            if fcntl is not None:
                fcntl.flock(self.write_gate, fcntl.LOCK_UN)

    def identity(self):
        return dict(self.meta)

    def dispatch(self, method, payload):
        schemas = {
            "start": ({"executionId", "finalDigest"}, set()), "query": ({"executionId"}, set()),
            "cancel": ({"executionId"}, {"reason"}), "readOutput": ({"executionId", "cursor"}, {"limit"}),
            "readRawOutput": ({"executionId", "offset", "length"}, set()), "list": (set(), {"cursor", "limit"}),
            "inspectWorkspace": ({"path"}, set()),
        }
        if method == "prepare":
            return self.prepare(payload)
        if method not in schemas or type(payload) is not dict:
            raise ExecutionFault("INVALID_METHOD")
        required, optional = schemas[method]
        if not required <= set(payload) <= required | optional:
            raise ExecutionFault("INVALID_REQUEST")
        if method == "start":
            if type(payload["finalDigest"]) is not str or not re.fullmatch(r"[a-f0-9]{64}", payload["finalDigest"]):
                raise ExecutionFault("FINAL_REQUEST_CONFLICT")
            return self.start(payload["executionId"], payload["finalDigest"])
        if method == "query":
            return self.query(payload["executionId"])
        if method == "cancel":
            return self.cancel(payload["executionId"], payload.get("reason", "user"))
        if method == "readOutput":
            return self.read_output(payload["executionId"], payload["cursor"], payload.get("limit", 32768))
        if method == "readRawOutput":
            return self.read_raw_output(payload["executionId"], payload["offset"], payload["length"])
        if method == "list":
            return self.list_executions(payload.get("cursor", ""), payload.get("limit", 10))
        return self.inspect_workspace(payload["path"])

    def inspect_workspace(self, path):
        if not text(path, 4096) or not os.path.isabs(path):
            raise ExecutionFault("INVALID_WORKSPACE")
        base = {"protocol": 1, "namespace": self.meta["namespace"], "path": path}
        try:
            actual = Path(path).resolve(strict=True)
            info = actual.stat()
            if not stat.S_ISDIR(info.st_mode) or not os.access(actual, os.R_OK | os.W_OK | os.X_OK):
                return {**base, "state": "unavailable", "reason": "WORKSPACE_INACCESSIBLE"}
            fact = {"namespace": self.meta["namespace"], "realPath": str(actual), "device": str(info.st_dev), "inode": str(info.st_ino)}
            return {**base, **fact, "state": "available", "identity": digest(fact)}
        except (OSError, RuntimeError):
            return {**base, "state": "unavailable", "reason": "WORKSPACE_UNAVAILABLE"}

    def list_executions(self, cursor="", limit=10):
        if type(cursor) is not str or cursor and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", cursor) or not positive(limit, 10):
            raise ExecutionFault("INVALID_LIST_CURSOR")
        with self.lock:
            ids = [row[0] for row in self.db.execute("SELECT id FROM (SELECT id FROM executions UNION SELECT id FROM cancelled_ids) WHERE id>? ORDER BY id LIMIT ?", (cursor, limit + 1))]
            values = []
            for execution_id in ids[:limit]:
                receipt = self.query(execution_id)
                candidate = {**self.identity(), "executions": [*values, receipt], "nextCursor": execution_id}
                if len(canonical(candidate).encode("utf-8")) > 48000:
                    if not values:
                        raise ExecutionFault("FRAME_LIMIT")
                    break
                values.append(receipt)
            more = len(ids) > len(values)
            return {**self.identity(), "executions": values, "nextCursor": values[-1]["executionId"] if more else None}

    @contextmanager
    def transaction(self):
        with self.lock:
            if self.db.in_transaction:
                yield
                return
            # SQLite's busy backoff can repeatedly miss short gaps between output
            # commits. Queue our writers on one kernel lock before entering SQLite.
            if fcntl is not None:
                fcntl.flock(self.write_gate, fcntl.LOCK_EX)
            try:
                self.db.execute("BEGIN IMMEDIATE")
                try:
                    yield
                    self.db.commit()
                except BaseException:
                    self.db.rollback()
                    raise
            finally:
                if fcntl is not None:
                    fcntl.flock(self.write_gate, fcntl.LOCK_UN)

    def prepare(self, request):
        self.validate_request(request)
        encoded = canonical(request)
        execution_id = request["executionId"]
        with self.transaction():
            if self.db.execute("SELECT 1 FROM cancelled_ids WHERE id=?", (execution_id,)).fetchone():
                raise ExecutionFault("CANCELLED_BEFORE_ACCEPTANCE")
            existing = self.db.execute("SELECT request, receipt FROM executions WHERE id=?", (execution_id,)).fetchone()
            if existing:
                if existing[0] != encoded:
                    raise ExecutionFault("IDENTITY_CONFLICT")
                return self.query(execution_id)
            self.check_unresolved()
            if (self.db.execute("SELECT COUNT(*) FROM executions").fetchone()[0] >= EXECUTION_LIMIT
                    or self.retained_bytes() >= RETAINED_OUTPUT_LIMIT or self.retained_chunks() >= self.limits["retainedChunks"]):
                raise ExecutionFault("RETENTION_FULL")
            environment = dict(os.environ) if request["inheritEnv"] else {}
            environment.update(request["env"])
            command = request["command"]
            shell = str(Path(os.environ["PREFIX"]) / "bin/bash") if "PREFIX" in os.environ else shutil.which("bash")
            argv = [shell, "-c", command["script"]] if command["kind"] == "shell" else command["argv"]
            prepared = {"argv": argv, "cwd": request["cwd"], "cwdLocation": self.inspect_workspace(request["cwd"]),
                        "env": environment, "timeoutMs": request["timeoutMs"]}
            if len(canonical(prepared).encode("utf-8")) > self.limits["preparedBytes"]:
                raise ExecutionFault("PREPARED_LIMIT")
            output_path = self.root / "outputs" / (execution_id + ".raw")
            receipt = {**self.identity(), "executionId": execution_id, "requestDigest": digest(request), "finalDigest": digest(prepared),
                       "context": request["context"], "state": "accepted_not_started", "sequence": 1,
                       "createdAt": int(time.time() * 1000), "outputCursor": 0, "outputBytes": 0,
                       "outputRef": str(output_path), "captureIncomplete": False}
            self.boundary("accept_before_commit")
            self.db.execute("INSERT INTO executions VALUES (?, ?, ?)", (execution_id, encoded, canonical(receipt)))
            self.db.execute("INSERT INTO prepared VALUES (?, ?)", (execution_id, canonical(prepared)))
        self.boundary("accepted")
        return receipt

    def validate_request(self, request):
        fields = {"executionId", "context", "command", "cwd", "env", "inheritEnv", "timeoutMs"}
        if not isinstance(request, dict) or set(request) != fields or len(canonical(request).encode("utf-8")) > 32768:
            raise ExecutionFault("INVALID_REQUEST")
        if not isinstance(request["executionId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request["executionId"]):
            raise ExecutionFault("INVALID_EXECUTION_ID")
        context = request["context"]
        strings = {"productId", "callId", "bindingId", "namespace"}
        integers = {"sdkConversationId", "taskId", "locationVersion", "controlGeneration"}
        if not isinstance(context, dict) or set(context) != strings | integers:
            raise ExecutionFault("INVALID_CONTEXT")
        if any(not text(context[key], 512) or not context[key] for key in strings) or any(not positive(context[key]) for key in integers):
            raise ExecutionFault("INVALID_CONTEXT")
        if context["namespace"] != self.meta["namespace"]:
            raise ExecutionFault("NAMESPACE_MISMATCH")
        command = request["command"]
        if not isinstance(command, dict):
            raise ExecutionFault("INVALID_COMMAND")
        if command.get("kind") == "shell":
            if set(command) != {"kind", "script"} or not text(command["script"]):
                raise ExecutionFault("INVALID_COMMAND")
        elif command.get("kind") == "argv":
            argv = command.get("argv")
            if set(command) != {"kind", "argv"} or not isinstance(argv, list) or not 1 <= len(argv) <= 128 or any(not text(arg) for arg in argv) or not argv[0]:
                raise ExecutionFault("INVALID_COMMAND")
        else:
            raise ExecutionFault("INVALID_COMMAND")
        if not text(request["cwd"], 4096) or not os.path.isabs(request["cwd"]):
            raise ExecutionFault("INVALID_CWD")
        environment = request["env"]
        if not isinstance(environment, dict) or len(environment) > 128 or any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or not text(value) for key, value in environment.items()):
            raise ExecutionFault("INVALID_ENVIRONMENT")
        if type(request["inheritEnv"]) is not bool or request["timeoutMs"] is not None and not positive(request["timeoutMs"], 2147483647):
            raise ExecutionFault("INVALID_OPTIONS")

    def query(self, execution_id):
        if not isinstance(execution_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", execution_id):
            raise ExecutionFault("INVALID_EXECUTION_ID")
        with self.lock:
            row = self.db.execute("SELECT receipt FROM executions WHERE id=?", (execution_id,)).fetchone()
            if not row:
                cancelled = self.db.execute("SELECT receipt FROM cancelled_ids WHERE id=?", (execution_id,)).fetchone()
                if cancelled:
                    return json.loads(cancelled[0])
                return {**self.identity(), "executionId": execution_id, "state": "unknown", "reason": "NO_RECEIPT"}
            receipt = json.loads(row[0])
            if receipt["state"] in ("starting", "running", "stop_requested"):
                fd = self.owner_lock(execution_id)
                if fd is not None:
                    os.close(fd)
                    # Healthy reads stay WAL readers; they must not queue for a writer
                    # behind sustained output. Only lost supervision needs a durable CAS.
                    with self.transaction():
                        current = json.loads(self.db.execute("SELECT receipt FROM executions WHERE id=?", (execution_id,)).fetchone()[0])
                        if current["state"] in ("starting", "running", "stop_requested"):
                            current.update(state="unknown", reason="SUPERVISOR_LOST", scopeConfirmed=False,
                                           captureIncomplete=True, sequence=current["sequence"] + 1)
                            self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(current), execution_id))
                        receipt = current
            return receipt

    def owner_lock(self, execution_id):
        if fcntl is None:
            raise ExecutionFault("SUPERVISION_UNAVAILABLE")
        fd = os.open(self.root / "owners" / (execution_id + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            os.close(fd)
            return None
        except BaseException:
            os.close(fd)
            raise

    def check_unresolved(self):
        for (execution_id,) in self.db.execute("SELECT id FROM executions").fetchall():
            if self.query(execution_id)["state"] == "unknown":
                raise ExecutionFault("UNRESOLVED_EXECUTION")

    def retained_bytes(self):
        return self.db.execute("SELECT COALESCE(SUM(json_extract(receipt, '$.outputBytes')), 0) FROM executions").fetchone()[0]

    def retained_chunks(self):
        return self.db.execute("SELECT COALESCE(SUM(json_extract(receipt, '$.outputCursor')), 0) FROM executions").fetchone()[0]

    def update(self, execution_id, change):
        with self.transaction():
            receipt = self.query(execution_id)
            receipt.update(change)
            receipt["sequence"] += 1
            self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(receipt), execution_id))
        return receipt

    def start(self, execution_id, final_digest):
        receipt = self.query(execution_id)
        if receipt.get("finalDigest") != final_digest:
            raise ExecutionFault("FINAL_REQUEST_CONFLICT")
        if receipt["state"] != "accepted_not_started":
            return receipt
        owner = self.owner_lock(execution_id)
        if owner is None:
            return self.query(execution_id)
        try:
            with self.transaction():
                receipt = self.query(execution_id)
                if receipt["state"] != "accepted_not_started":
                    return receipt
                self.check_unresolved()
                receipt.update(state="starting", sequence=receipt["sequence"] + 1, startRequestedAt=int(time.time() * 1000))
                self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(receipt), execution_id))
            self.boundary("start_committed")
            # The inherited lock bridges durable start -> child exec. It is NOT inherited by user commands.
            # A crash in any gap releases it; recovery records unknown and never spawns again.
            worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "worker", str(self.root), execution_id, str(owner), canonical(self.limits)],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                      start_new_session=True, close_fds=True, pass_fds=(owner,))
        except OSError:
            return self.update(execution_id, {"state": "unknown", "reason": "WORKER_START_UNCONFIRMED", "scopeConfirmed": False})
        finally:
            os.close(owner)
        self.workers.add(worker)
        def reap():
            worker.wait()
            self.workers.discard(worker)
        threading.Thread(target=reap, daemon=True).start()
        return self.query(execution_id)

    def cancel(self, execution_id, reason):
        if reason not in ("user", "timeout", "output_limit"):
            raise ExecutionFault("INVALID_CANCEL_REASON")
        with self.transaction():
            receipt = self.query(execution_id)
            if receipt["state"] == "unknown" and receipt.get("reason") == "NO_RECEIPT":
                if self.db.execute("SELECT COUNT(*) FROM cancelled_ids").fetchone()[0] >= EXECUTION_LIMIT:
                    raise ExecutionFault("RETENTION_FULL")
                receipt = {**self.identity(), "executionId": execution_id, "state": "not_started", "reason": "CANCELLED_BEFORE_ACCEPTANCE",
                           "neverStarted": True, "scopeConfirmed": True, "cancelRequested": True, "cancelReason": reason,
                           "sequence": 1, "finishedAt": int(time.time() * 1000)}
                self.db.execute("INSERT INTO cancelled_ids VALUES (?,?)", (execution_id, canonical(receipt)))
                return receipt
            if receipt["state"] in ("completed", "stopped", "unknown", "not_started"):
                return receipt
            never_started = receipt["state"] == "accepted_not_started"
            receipt.update(cancelRequested=True, cancelReason=reason,
                           state="stopped" if never_started else "stop_requested", sequence=receipt["sequence"] + 1)
            if never_started:
                receipt.update(scopeConfirmed=True, neverStarted=True, finishedAt=int(time.time() * 1000))
            self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(receipt), execution_id))
        return receipt

    def read_output(self, execution_id, cursor, limit=32768):
        if type(cursor) is not int or cursor < 0 or not positive(limit, 32768):
            raise ExecutionFault("INVALID_OUTPUT_CURSOR")
        with self.lock:
            receipt = self.query(execution_id)
            if cursor > receipt.get("outputCursor", 0):
                raise ExecutionFault("OUTPUT_CURSOR_AHEAD")
            chunks, size = [], 0
            for sequence, stream, data in self.db.execute("SELECT sequence, stream, data FROM output WHERE id=? AND sequence>? ORDER BY sequence LIMIT 64", (execution_id, cursor)):
                if chunks and size + len(data) > limit:
                    break
                chunks.append({"sequence": sequence, "stream": stream, "data": base64.b64encode(data).decode("ascii")})
                size += len(data)
            return {**self.identity(), "executionId": execution_id, "cursor": cursor,
                    "nextCursor": chunks[-1]["sequence"] if chunks else cursor, "chunks": chunks}

    def read_raw_output(self, execution_id, offset, length):
        if type(offset) is not int or offset < 0 or not positive(length, 32768):
            raise ExecutionFault("INVALID_OUTPUT_CURSOR")
        with self.lock:
            receipt = self.query(execution_id)
            total = receipt.get("outputBytes", 0)
            if "outputRef" not in receipt or offset > total:
                raise ExecutionFault("OUTPUT_CURSOR_AHEAD")
            try:
                with open(receipt["outputRef"], "rb") as source:
                    source.seek(offset)
                    data = source.read(min(length, total - offset))
            except FileNotFoundError:
                if total != 0:
                    raise ExecutionFault("OUTPUT_CAPTURE_GAP") from None
                data = b""
            if len(data) != min(length, total - offset):
                raise ExecutionFault("OUTPUT_CAPTURE_GAP")
            return {**self.identity(), "executionId": execution_id, "offset": offset, "totalBytes": total,
                    "data": base64.b64encode(data).decode("ascii"), "captureIncomplete": receipt["captureIncomplete"]}

    def append_output(self, execution_id, stream, data):
        with self.transaction():
            receipt = self.query(execution_id)
            available = max(0, min(OUTPUT_LIMIT - receipt["outputBytes"], RETAINED_OUTPUT_LIMIT - self.retained_bytes()))
            if receipt["outputCursor"] >= self.limits["outputChunks"] or self.retained_chunks() >= self.limits["retainedChunks"]:
                available = 0
            if len(data) > available:
                if not receipt["captureIncomplete"]:
                    receipt.update(captureIncomplete=True, cancelRequested=True,
                                   cancelReason=receipt.get("cancelReason", "output_limit"), state="stop_requested",
                                   sequence=receipt["sequence"] + 1)
                    self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(receipt), execution_id))
                data = data[:available]
            if not data:
                return
            sequence = receipt["outputCursor"] + 1
            with open(receipt["outputRef"], "ab", buffering=0) as output:
                if output.tell() != receipt["outputBytes"]:
                    raise ExecutionFault("OUTPUT_CAPTURE_MISMATCH")
                if output.write(data) != len(data):
                    raise ExecutionFault("OUTPUT_CAPTURE_GAP")
                os.fsync(output.fileno())
            self.db.execute("INSERT INTO output VALUES (?, ?, ?, ?)", (execution_id, sequence, stream, data))
            receipt.update(outputCursor=sequence, outputBytes=receipt["outputBytes"] + len(data), sequence=receipt["sequence"] + 1)
            self.db.execute("UPDATE executions SET receipt=? WHERE id=?", (canonical(receipt), execution_id))

    def run_worker(self, execution_id):
        prepared = json.loads(self.db.execute("SELECT value FROM prepared WHERE id=?", (execution_id,)).fetchone()[0])
        scope = ProcessScope()
        cwd_fd = None
        try:
            if self.query(execution_id)["state"] not in ("starting", "stop_requested"):
                return
            if self.query(execution_id).get("cancelRequested"):
                self.update(execution_id, {"state": "stopped", "scopeConfirmed": True, "neverStarted": True})
                return
            location = prepared.get("cwdLocation")
            if not isinstance(location, dict) or location.get("state") != "available":
                # Older prepared records have no pinned directory. They are not
                # upgraded into permission to execute against today's path.
                self.update(execution_id, {"state": "not_started", "reason": "SPAWN_ERROR" if location else "LOCATION_UNVERIFIED",
                                           "neverStarted": True, "scopeConfirmed": True, "finishedAt": int(time.time() * 1000)})
                return
            try:
                cwd_fd = os.open(prepared["cwd"], os.O_RDONLY | os.O_DIRECTORY)
                info = os.fstat(cwd_fd)
                same = (str(info.st_dev) == location.get("device") and str(info.st_ino) == location.get("inode")
                        and os.path.realpath(prepared["cwd"]) == location.get("realPath"))
            except OSError:
                same = False
            if not same:
                self.update(execution_id, {"state": "not_started", "reason": "LOCATION_CHANGED", "neverStarted": True,
                                           "scopeConfirmed": True, "finishedAt": int(time.time() * 1000)})
                return
            # Allocate only after durable acceptance. An interrupted prepare owns no file.
            output_path = Path(self.query(execution_id)["outputRef"])
            fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_size != 0:
                    raise ExecutionFault("OUTPUT_CAPTURE_CONFLICT")
                os.fsync(fd)
            finally:
                os.close(fd)
            fd = os.open(output_path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            try:
                # The held descriptor pins the checked directory even if its
                # pathname is replaced between this check and child chdir.
                child = subprocess.Popen(prepared["argv"], cwd="/proc/self/fd/" + str(cwd_fd), env=prepared["env"],
                                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         start_new_session=True, close_fds=True, pass_fds=(cwd_fd,))
            except OSError as error:
                # Popen reports failed exec/chdir through its error pipe and reaps
                # that child before raising. No user executable was entered.
                self.update(execution_id, {"state": "not_started", "reason": "SPAWN_ERROR", "spawnErrno": error.errno,
                                           "neverStarted": True, "scopeConfirmed": True, "finishedAt": int(time.time() * 1000)})
                return
            self.update(execution_id, {"state": "running", "startedAt": int(time.time() * 1000), "guardianPid": os.getpid()})
            stopping_at = None
            deadline = time.monotonic() + prepared["timeoutMs"] / 1000 if prepared["timeoutMs"] is not None else None
            with selectors.DefaultSelector() as selector:
                for stream in ("stdout", "stderr"):
                    pipe = getattr(child, stream)
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, stream)
                while True:
                    receipt = self.query(execution_id)
                    if deadline is not None and time.monotonic() >= deadline and not receipt.get("cancelRequested"):
                        receipt = self.cancel(execution_id, "timeout")
                    if receipt.get("cancelRequested"):
                        stopping_at = stopping_at or time.monotonic()
                        scope.cancel(force=time.monotonic() - stopping_at > 0.3)
                    for key, _ in selector.select(0.05):
                        data = os.read(key.fileobj.fileno(), 16384)
                        if data:
                            self.append_output(execution_id, key.data, data)
                        else:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                    child.poll()
                    no_children = False
                    while True:
                        try:
                            pid, status = os.waitpid(-1, os.WNOHANG)
                            if pid == 0:
                                break
                            if pid == child.pid:
                                child.returncode = os.waitstatus_to_exitcode(status)
                        except ChildProcessError:
                            no_children = True
                            break
                    # Only the kernel's ECHILD proves this live subreaper has no
                    # remaining adopted children. A racing /proc scan cannot prove it.
                    if child.returncode is not None and no_children and not selector.get_map():
                        break
            receipt = self.query(execution_id)
            with open(receipt["outputRef"], "rb") as output:
                raw_hash = hashlib.file_digest(output, "sha256").hexdigest()
            self.update(execution_id, {"state": "stopped" if receipt.get("cancelRequested") else "completed",
                                      "exitCode": child.returncode, "scopeConfirmed": True, "rawSha256": raw_hash,
                                      "finishedAt": int(time.time() * 1000)})
        finally:
            if cwd_fd is not None:
                os.close(cwd_fd)
            scope.close()

    def close(self):
        self.db.close()
        if self.write_gate is not None:
            os.close(self.write_gate)
            self.write_gate = None


def main():
    if len(sys.argv) in (5, 6) and sys.argv[1] == "worker":
        endpoint = Executor(sys.argv[2], limits=json.loads(sys.argv[5]) if len(sys.argv) == 6 else None)
        try:
            endpoint.run_worker(sys.argv[3])
        finally:
            endpoint.close()
            os.close(int(sys.argv[4]))
        return
    from execution_transport import bootstrap, serve, TransportFault
    parser = argparse.ArgumentParser(description="DurableAgent fixed local execution service")
    parser.add_argument("--root", default=str(Path.home() / ".local/share/durableagent-execution"))
    commands = parser.add_subparsers(dest="mode", required=True)
    pairing = commands.add_parser("bootstrap")
    pairing.add_argument("--client-cert-base64", required=True)
    pairing.add_argument("--nonce", required=True)
    commands.add_parser("serve")
    args = parser.parse_args()
    endpoint = None
    try:
        endpoint = Executor(args.root)
        if args.mode == "bootstrap":
            value = bootstrap(endpoint.root, args.client_cert_base64, args.nonce, endpoint.identity())
            print(canonical(value), flush=True)
        else:
            serve(endpoint.root, endpoint.identity(), endpoint.dispatch)
    except (ExecutionFault, TransportFault) as error:
        value = {"protocol": 1, "error": {"code": error.code}}
        if args.mode == "bootstrap":
            value["nonce"] = args.nonce
        print(canonical(value), flush=True)
        raise SystemExit(78 if error.code in ("PAIRING_REQUIRED", "TLS_IDENTITY_UNAVAILABLE") else 65) from None
    except Exception:
        print(canonical({"protocol": 1, "error": {"code": "EXECUTOR_UNAVAILABLE"}}), flush=True)
        raise SystemExit(70) from None
    finally:
        if endpoint is not None:
            endpoint.close()


if __name__ == "__main__":
    main()
