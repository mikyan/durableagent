"""Execution endpoint contract: real SQLite and child processes, no internal table assertions."""
import tempfile
import unittest
import base64
import ctypes
import os
import signal
import hashlib
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from durable_executor import Executor, ExecutionFault


class ExecutionContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="durable-execution-test-")
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.endpoint = Executor(self.root / "authority")
        self.requests = set()

    def tearDown(self):
        deadline = time.monotonic() + 25
        while True:
            try:
                active = [key for key in self.requests if self.endpoint.query(key)["state"] in ("starting", "running", "stop_requested")]
                if not active:
                    break
            except sqlite3.OperationalError:
                pass
            if time.monotonic() >= deadline:
                # Keep evidence rather than remove a directory still owned by a live worker.
                self.temp._finalizer.detach()
                self.endpoint.close()
                self.fail("fixture executions did not settle; preserved " + str(self.root))
            time.sleep(0.03)
        self.endpoint.close()
        self.temp.cleanup()

    def request(self, execution_id="execution-one", script="printf 'one'"):
        self.requests.add(execution_id)
        return {
            "executionId": execution_id,
            "context": {"productId": "conversation-one", "sdkConversationId": 2,
                        "taskId": 7, "callId": "call-one", "bindingId": "binding-one",
                        "locationVersion": 1, "controlGeneration": 1,
                        "namespace": self.endpoint.identity()["namespace"]},
            "command": {"kind": "shell", "script": script},
            "cwd": str(self.workspace), "env": {}, "inheritEnv": True, "timeoutMs": None,
        }

    def test_saved_execution_is_found_after_reopen_and_changed_request_is_rejected(self):
        request = self.request()
        first = self.endpoint.prepare(request)
        self.assertEqual(first["state"], "accepted_not_started")
        identity = self.endpoint.identity()
        self.endpoint.close()
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(self.endpoint.identity()["ledgerEpoch"], identity["ledgerEpoch"])
        self.assertEqual(self.endpoint.prepare(request), first)
        self.assertEqual(self.endpoint.query("execution-one"), first)
        with self.assertRaisesRegex(ExecutionFault, "IDENTITY_CONFLICT"):
            self.endpoint.prepare({**request, "command": {"kind": "shell", "script": "printf 'different'"}})
        self.assertEqual(self.endpoint.query("execution-one"), first)

    def test_command_starts_once_and_reconnect_reads_same_output(self):
        request = self.request()
        request["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "from pathlib import Path; import sys; "
            "p=Path('effects.txt'); p.open('a').write('effect\\n'); "
            "sys.stdout.write('hello-世界\\n'); sys.stdout.flush(); "
            "sys.stderr.write('failure-stream\\n')"]}
        accepted = self.endpoint.prepare(request)
        self.endpoint.start("execution-one", accepted.get("finalDigest", "missing"))
        self.endpoint.start("execution-one", accepted.get("finalDigest", "missing"))
        deadline = time.monotonic() + 12
        while True:
            receipt = self.endpoint.query("execution-one")
            if receipt["state"] in ("completed", "stopped", "unknown"):
                break
            self.assertLess(time.monotonic(), deadline, receipt)
            time.sleep(0.03)
        self.assertEqual(receipt["state"], "completed", receipt)
        self.assertEqual(receipt["exitCode"], 0)
        output = self.endpoint.read_output("execution-one", 0)
        by_stream = {stream: b"".join(base64.b64decode(row["data"]) for row in output["chunks"]
                                    if row["stream"] == stream) for stream in ("stdout", "stderr")}
        self.assertEqual(by_stream, {"stdout": "hello-世界\n".encode(), "stderr": b"failure-stream\n"})
        self.endpoint.close()
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(self.endpoint.start("execution-one", accepted["finalDigest"]), receipt)
        self.assertEqual(self.endpoint.read_output("execution-one", 0), output)
        self.assertEqual((self.workspace / "effects.txt").read_text(), "effect\n")

    def test_invalid_target_or_parameters_never_create_an_accepted_execution(self):
        valid = self.request()
        invalid = [
            {**valid, "context": {**valid["context"], "namespace": "another-install"}},
            {**valid, "command": {"kind": "argv", "argv": []}},
            {**valid, "env": {"VALUE": "nul\x00value"}},
            {**valid, "timeoutMs": -1},
            {**valid, "context": {**valid["context"], "controlGeneration": 0}},
            {**valid, "inheritEnv": "yes"},
        ]
        for request in invalid:
            with self.subTest(request=request), self.assertRaises(ExecutionFault):
                self.endpoint.prepare(request)
            self.assertEqual(self.endpoint.query("execution-one")["state"], "unknown")

    def test_cancel_stops_this_execution_and_its_child_while_another_execution_finishes(self):
        target = self.request("cancel-target")
        target["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "import subprocess,sys; child=subprocess.Popen([sys.executable,'-c',"
            "\"import time; from pathlib import Path; time.sleep(2); Path('cancelled-effect').write_text('bad')\"]); "
            "print('ready',flush=True); child.wait()"]}
        unrelated = self.request("unrelated")
        unrelated["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "import time; from pathlib import Path; time.sleep(0.8); Path('unrelated-effect').write_text('good')"]}
        for request in (target, unrelated):
            receipt = self.endpoint.prepare(request)
            self.endpoint.start(request["executionId"], receipt["finalDigest"])
        try:
            deadline = time.monotonic() + 8
            while not self.endpoint.read_output("cancel-target", 0)["chunks"]:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            self.endpoint.cancel("cancel-target", "user")
            while self.endpoint.query("cancel-target")["state"] not in ("stopped", "unknown", "completed"):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            receipt = self.endpoint.query("cancel-target")
            self.assertEqual(receipt["state"], "stopped", receipt)
            self.assertTrue(receipt["scopeConfirmed"])
            while self.endpoint.query("unrelated")["state"] != "completed":
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertFalse((self.workspace / "cancelled-effect").exists())
            self.assertEqual((self.workspace / "unrelated-effect").read_text(), "good")
        finally:
            # The red implementation has no cancel yet; both fixture commands finish naturally within 2 s.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and any(self.endpoint.query(key)["state"] in ("starting", "running", "stop_requested") for key in ("cancel-target", "unrelated")):
                time.sleep(0.02)

    def test_timeout_is_confirmed_from_the_command_scope_not_from_a_lost_connection(self):
        request = self.request("timeout-target")
        request.update(timeoutMs=100, command={"kind": "argv", "argv": [sys.executable, "-c",
            "import time; from pathlib import Path; print('started',flush=True); "
            "time.sleep(1.5); Path('late-timeout-effect').write_text('bad')"]})
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request["executionId"], accepted["finalDigest"])
        deadline = time.monotonic() + 6
        while True:
            receipt = self.endpoint.query(request["executionId"])
            if receipt["state"] in ("completed", "stopped", "unknown"):
                break
            self.assertLess(time.monotonic(), deadline, receipt)
            time.sleep(0.02)
        self.assertEqual(receipt["state"], "stopped", receipt)
        self.assertEqual(receipt["cancelReason"], "timeout")
        self.assertTrue(receipt["scopeConfirmed"])
        self.assertFalse((self.workspace / "late-timeout-effect").exists())

    def test_guardian_death_keeps_unknown_effect_and_never_restarts_the_command(self):
        request = self.request("lost-guardian")
        request["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "from pathlib import Path; import time; Path('once-effect').open('a').write('once\\n'); "
            "print('effect-written',flush=True); time.sleep(1)"]}
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request["executionId"], accepted["finalDigest"])
        try:
            deadline = time.monotonic() + 6
            while not self.endpoint.read_output(request["executionId"], 0)["chunks"]:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            pid = self.endpoint.query(request["executionId"])["guardianPid"]
            # This fixture kills only the guardian that is a direct child of this test process.
            stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            self.assertEqual(int(stat[1]), os.getpid())
            libc = ctypes.CDLL(None, use_errno=True)
            libc.pidfd_open.argtypes = [ctypes.c_int, ctypes.c_uint]
            fd = libc.pidfd_open(pid, 0)
            self.assertGreaterEqual(fd, 0)
            try:
                libc.pidfd_send_signal.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
                self.assertEqual(libc.pidfd_send_signal(fd, signal.SIGKILL, None, 0), 0)
            finally:
                os.close(fd)
            self.endpoint.close()
            self.endpoint = Executor(self.root / "authority")
            while self.endpoint.query(request["executionId"])["state"] != "unknown":
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            self.assertEqual(self.endpoint.start(request["executionId"], accepted["finalDigest"])["state"], "unknown")
            self.assertEqual(self.endpoint.prepare(request)["state"], "unknown")
            with self.assertRaisesRegex(ExecutionFault, "UNRESOLVED_EXECUTION"):
                self.endpoint.prepare(self.request("different-id", "printf 'bypass'"))
        finally:
            # The surviving fixture command has a bounded natural lifetime, even in the failing implementation.
            time.sleep(1.2)
        self.assertEqual((self.workspace / "once-effect").read_text(), "once\n")

    def test_large_output_reconnects_with_bounded_pages_and_complete_raw_reference(self):
        request = self.request("large-output")
        expected = ("line-世界\n" * 100000).encode()
        request["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "import sys; sys.stdout.buffer.write(('line-世界\\n'*100000).encode()); sys.stdout.buffer.flush()"]}
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request["executionId"], accepted["finalDigest"])
        deadline = time.monotonic() + 12
        cursor, received = 0, bytearray()
        while True:
            page = self.endpoint.read_output(request["executionId"], cursor)
            self.assertLessEqual(len(json.dumps(page).encode()), 65536)
            for chunk in page["chunks"]:
                self.assertEqual(chunk["sequence"], cursor + 1)
                self.assertEqual(chunk["stream"], "stdout")
                received.extend(base64.b64decode(chunk["data"]))
                cursor = chunk["sequence"]
            self.assertEqual(page["nextCursor"], cursor)
            receipt = self.endpoint.query(request["executionId"])
            if receipt["state"] == "completed" and receipt["outputCursor"] == cursor:
                break
            self.assertLess(time.monotonic(), deadline, receipt)
            time.sleep(0.01)
        self.assertEqual(bytes(received), expected)
        self.endpoint.close()
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(self.endpoint.read_output(request["executionId"], cursor)["chunks"], [])
        raw = bytearray()
        while len(raw) < len(expected):
            page = self.endpoint.read_raw_output(request["executionId"], len(raw), 32768)
            self.assertLessEqual(len(json.dumps(page).encode()), 65536)
            self.assertEqual(page["offset"], len(raw))
            raw.extend(base64.b64decode(page["data"]))
        self.assertEqual(bytes(raw), expected)
        self.assertEqual(receipt["outputBytes"], len(expected))
        self.assertEqual(receipt["rawSha256"], hashlib.sha256(expected).hexdigest())
        self.assertFalse(receipt["captureIncomplete"])
        self.assertTrue(receipt["outputRef"].endswith("large-output.raw"))

    def test_output_quota_stops_scope_and_reports_incomplete_capture(self):
        request = self.request("quota-output")
        request["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "import sys; from pathlib import Path; "
            "[sys.stdout.buffer.write(b'x'*65536) for _ in range(300)]; "
            "sys.stdout.buffer.flush(); Path('after-unbounded-output').write_text('bad')"]}
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request["executionId"], accepted["finalDigest"])
        deadline = time.monotonic() + 25
        while True:
            receipt = self.endpoint.query(request["executionId"])
            if receipt["state"] in ("completed", "stopped", "unknown"):
                break
            self.assertLess(time.monotonic(), deadline, receipt)
            time.sleep(0.03)
        self.assertEqual(receipt["state"], "stopped", receipt)
        self.assertEqual(receipt["cancelReason"], "output_limit")
        self.assertTrue(receipt["scopeConfirmed"])
        self.assertTrue(receipt["captureIncomplete"])
        self.assertLessEqual(receipt["outputBytes"], 16 * 1024 * 1024)
        self.assertFalse((self.workspace / "after-unbounded-output").exists())

    def test_killed_acceptance_keeps_the_same_identity_recoverable(self):
        request = self.request("accept-crash")
        self.endpoint.close()
        code = """import json,os,signal,sys
from durable_executor import Executor
def boundary(stage):
    if stage == 'accept_before_commit': os.kill(os.getpid(), signal.SIGKILL)
endpoint=Executor(sys.argv[1],boundary=boundary)
endpoint.prepare(json.loads(sys.argv[2]))
"""
        child = subprocess.run([sys.executable, "-c", code, str(self.root / "authority"), json.dumps(request)], timeout=8)
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(child.returncode, -signal.SIGKILL)
        self.assertEqual(self.endpoint.query(request["executionId"])["reason"], "NO_RECEIPT")
        accepted = self.endpoint.prepare(request)
        self.assertEqual(accepted["executionId"], request["executionId"])
        self.assertEqual(accepted["state"], "accepted_not_started")
        self.assertEqual(self.endpoint.prepare(request), accepted)

    def test_cancel_remains_responsive_during_continuous_output(self):
        request = self.request("busy-cancel")
        request["command"] = {"kind": "argv", "argv": [sys.executable, "-c",
            "import sys; from pathlib import Path; "
            "[sys.stdout.buffer.write(b'x'*65536) for _ in range(192)]; "
            "sys.stdout.buffer.flush(); Path('after-busy-output').write_text('bad')"]}
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request["executionId"], accepted["finalDigest"])
        deadline = time.monotonic() + 15
        while self.endpoint.query(request["executionId"])["outputBytes"] < 65536:
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.005)
        started = time.monotonic()
        self.endpoint.cancel(request["executionId"], "user")
        self.assertLess(time.monotonic() - started, 2)
        while self.endpoint.query(request["executionId"])["state"] not in ("completed", "stopped", "unknown"):
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.01)
        receipt = self.endpoint.query(request["executionId"])
        self.assertEqual(receipt["state"], "stopped")
        self.assertEqual(receipt["cancelReason"], "user")
        self.assertTrue(receipt["scopeConfirmed"])
        self.assertFalse((self.workspace / "after-busy-output").exists())


if __name__ == "__main__":
    unittest.main()
