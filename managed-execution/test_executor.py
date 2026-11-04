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

    def test_network_policy_cancellation_is_durable_and_never_starts_the_prepared_identity(self):
        request = self.request("policy-wait")
        prepared = self.endpoint.prepare(request)
        stopped = self.endpoint.cancel("policy-wait", "network_policy")
        self.assertEqual(stopped["cancelReason"], "network_policy")
        self.assertTrue(stopped["scopeConfirmed"])
        self.assertTrue(stopped["neverStarted"])
        self.endpoint.close()
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(self.endpoint.start("policy-wait", prepared["finalDigest"]), stopped)
        self.assertEqual(self.endpoint.prepare(request), stopped)
        other = self.request("user-stop")
        self.endpoint.prepare(other)
        user_stopped = self.endpoint.cancel("user-stop", "user")
        self.assertEqual(self.endpoint.cancel("user-stop", "network_policy"), user_stopped)

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

    def test_tiny_output_chunks_obey_per_execution_and_retained_metadata_budgets(self):
        limits = {'outputChunks': 4, 'retainedChunks': 6, 'preparedBytes': 65536}
        self.endpoint.close()
        self.endpoint = Executor(self.root / 'authority', limits=limits)
        for suffix, expected in (('first', 4), ('second', 2)):
            execution_id = 'tiny-' + suffix
            ack = self.workspace / ('acks-' + suffix)
            ack.mkdir()
            request = self.request(execution_id)
            code = "import os,time;from pathlib import Path\nfor i in range(12):\n os.write(1,b'x')\n while not (Path(" + repr(str(ack)) + ")/str(i)).exists(): time.sleep(.005)\nPath('after-tiny-" + suffix + "').touch()"
            request['command'] = {'kind': 'argv', 'argv': [sys.executable, '-c', code]}
            accepted = self.endpoint.prepare(request)
            self.endpoint.start(execution_id, accepted['finalDigest'])
            cursor = 0
            deadline = time.monotonic() + 15
            while True:
                page = self.endpoint.read_output(execution_id, cursor)
                for chunk in page['chunks']:
                    self.assertEqual(base64.b64decode(chunk['data']), b'x', 'Producer waits for public output observation before each byte')
                    self.assertEqual(chunk['sequence'], cursor + 1)
                    (ack / str(cursor)).touch()
                    cursor += 1
                receipt = self.endpoint.query(execution_id)
                if receipt['state'] in ('completed', 'stopped', 'unknown'):
                    break
                self.assertLess(time.monotonic(), deadline, receipt)
                time.sleep(.005)
            self.assertEqual(receipt['state'], 'stopped', receipt)
            self.assertEqual(receipt['cancelReason'], 'output_limit')
            self.assertTrue(receipt['captureIncomplete'])
            self.assertTrue(receipt['scopeConfirmed'])
            self.assertEqual(receipt['outputCursor'], expected)
            self.assertEqual(receipt['outputBytes'], expected)
            self.assertEqual(base64.b64decode(self.endpoint.read_raw_output(execution_id, 0, 32768)['data']), b'x' * expected)
            self.assertFalse((self.workspace / ('after-tiny-' + suffix)).exists())
            self.endpoint.close()
            self.endpoint = Executor(self.root / 'authority', limits=limits)
        rejected = self.request('tiny-retention-full')
        with self.assertRaisesRegex(ExecutionFault, 'RETENTION_FULL'):
            self.endpoint.prepare(rejected)
        self.assertEqual(self.endpoint.query(rejected['executionId'])['reason'], 'NO_RECEIPT')

    def test_inherited_environment_cannot_exceed_the_final_parameter_budget(self):
        previous = os.environ.get('T09_LIMIT_TEST')
        request = self.request('large-prepared')
        try:
            os.environ['T09_LIMIT_TEST'] = 'x' * 100000
            with self.assertRaisesRegex(ExecutionFault, 'PREPARED_LIMIT'):
                self.endpoint.prepare(request)
            self.assertEqual(self.endpoint.query(request['executionId'])['reason'], 'NO_RECEIPT')
        finally:
            if previous is None:
                os.environ.pop('T09_LIMIT_TEST', None)
            else:
                os.environ['T09_LIMIT_TEST'] = previous
        accepted = self.endpoint.prepare(request)
        self.endpoint.start(request['executionId'], accepted['finalDigest'])
        self.assertEqual(self.settle(request['executionId'])['state'], 'completed')

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

    def settle(self, execution_id, timeout=8):
        deadline = time.monotonic() + timeout
        while True:
            receipt = self.endpoint.query(execution_id)
            if receipt["state"] in ("completed", "stopped", "unknown", "not_started"):
                return receipt
            self.assertLess(time.monotonic(), deadline, receipt)
            time.sleep(.02)

    def test_argv_shell_cwd_and_environment_are_literal_and_frozen(self):
        working = self.workspace / "工作 dir"
        working.mkdir()
        previous = os.environ.get("T09_CAPTURED")
        os.environ["T09_CAPTURED"] = "accepted-env"
        try:
            request = self.request("literal-argv")
            arguments = ["", "a b", "$T09_VALUE", "$(touch unrequested-effect)", ";touch unrequested-effect", "*", "引号'\\路径"]
            request.update(cwd=str(working), env={"T09_VALUE": "accepted-value"}, command={"kind": "argv", "argv": [sys.executable, "-c", "import json,os,sys;print(json.dumps({'argv':sys.argv[1:],'cwd':os.getcwd(),'value':os.environ.get('T09_VALUE'),'captured':os.environ.get('T09_CAPTURED')}))", *arguments]})
            accepted = self.endpoint.prepare(request)
            os.environ["T09_CAPTURED"] = "later-env"
            request["env"]["T09_VALUE"] = "later-value"
            request["command"]["argv"][-1] = "later-argument"
            self.endpoint.start("literal-argv", accepted["finalDigest"])
            receipt = self.settle("literal-argv")
            self.assertEqual(receipt["state"], "completed", receipt)
            result = json.loads(base64.b64decode(self.endpoint.read_raw_output("literal-argv", 0, 32768)["data"]))
            self.assertEqual(result, {"argv": arguments, "cwd": str(working), "value": "accepted-value", "captured": "accepted-env"})
            self.assertFalse((working / "unrequested-effect").exists())
            isolated = self.request("isolated-env")
            isolated.update(inheritEnv=False, env={"T09_VALUE": "only-value"}, command={"kind": "argv", "argv": [sys.executable, "-c", "import os,json;print(json.dumps([os.environ.get('T09_VALUE'),os.environ.get('T09_CAPTURED')]))"]})
            accepted = self.endpoint.prepare(isolated)
            self.endpoint.start("isolated-env", accepted["finalDigest"])
            self.assertEqual(self.settle("isolated-env")["state"], "completed")
            self.assertEqual(json.loads(base64.b64decode(self.endpoint.read_raw_output("isolated-env", 0, 32768)["data"])), ["only-value", None])
            shell = self.request("explicit-shell", "printf '%s:%s' \"$T09_VALUE\" \"$(printf shell)\"")
            shell.update(inheritEnv=False, env={"T09_VALUE": "环境 value"})
            accepted = self.endpoint.prepare(shell)
            self.endpoint.start("explicit-shell", accepted["finalDigest"])
            self.assertEqual(self.settle("explicit-shell")["state"], "completed")
            self.assertEqual(base64.b64decode(self.endpoint.read_raw_output("explicit-shell", 0, 32768)["data"]).decode(), "环境 value:shell")
        finally:
            if previous is None:
                os.environ.pop("T09_CAPTURED", None)
            else:
                os.environ["T09_CAPTURED"] = previous

    def test_missing_program_and_cwd_confirm_not_started_without_retry(self):
        for suffix in ("program", "cwd"):
            request = self.request("missing-" + suffix)
            request["command"] = {"kind": "argv", "argv": [str(self.workspace / "missing-program")] if suffix == "program" else [sys.executable, "-c", "from pathlib import Path;Path('forbidden-spawn-effect').touch()"]}
            if suffix == "cwd":
                request["cwd"] = str(self.workspace / "missing-directory")
            accepted = self.endpoint.prepare(request)
            self.endpoint.start(request["executionId"], accepted["finalDigest"])
            receipt = self.settle(request["executionId"])
            self.assertEqual(receipt["state"], "not_started", receipt)
            self.assertEqual(receipt["reason"], "SPAWN_ERROR")
            self.assertTrue(receipt["neverStarted"])
            self.assertTrue(receipt["scopeConfirmed"])
            self.assertEqual(self.endpoint.start(request["executionId"], accepted["finalDigest"]), receipt)
            self.assertFalse((self.workspace / "forbidden-spawn-effect").exists())

    def test_replaced_cwd_after_acceptance_never_executes_in_the_replacement(self):
        for variant in ('directory', 'symlink'):
            location = self.workspace / variant
            location.mkdir()
            request = self.request('cwd-replaced-' + variant)
            request.update(cwd=str(location), command={'kind':'argv','argv':[sys.executable,'-c',"from pathlib import Path;Path('forbidden-effect').write_text('wrong location')"]})
            accepted = self.endpoint.prepare(request)
            old = self.workspace / (variant + '-old')
            location.rename(old)
            replacement = self.workspace / (variant + '-replacement')
            if variant == 'symlink':
                replacement.mkdir()
                location.symlink_to(replacement, target_is_directory=True)
            else:
                location.mkdir()
                replacement = location
            self.endpoint.start(request['executionId'], accepted['finalDigest'])
            receipt = self.settle(request['executionId'])
            self.assertEqual(receipt['state'], 'not_started', receipt)
            self.assertEqual(receipt['reason'], 'LOCATION_CHANGED')
            self.assertTrue(receipt['neverStarted'])
            self.assertTrue(receipt['scopeConfirmed'])
            self.assertFalse((old / 'forbidden-effect').exists())
            self.assertFalse((replacement / 'forbidden-effect').exists())
            self.assertEqual(self.endpoint.start(request['executionId'], accepted['finalDigest']), receipt)

    def test_cwd_missing_at_acceptance_is_not_adopted_if_it_appears_later(self):
        location = self.workspace / 'later-directory'
        request = self.request('cwd-late')
        request.update(cwd=str(location), command={'kind':'argv','argv':[sys.executable,'-c',"from pathlib import Path;Path('forbidden-effect').touch()"]})
        accepted = self.endpoint.prepare(request)
        location.mkdir()
        self.endpoint.start(request['executionId'], accepted['finalDigest'])
        receipt = self.settle(request['executionId'])
        self.assertEqual(receipt['state'], 'not_started', receipt)
        self.assertEqual(receipt['reason'], 'SPAWN_ERROR')
        self.assertTrue(receipt['neverStarted'])
        self.assertFalse((location / 'forbidden-effect').exists())

    def crash_at(self, stage, execution_id):
        request = self.request(execution_id, "printf effect >> crash-window-effect")
        code = """import json,os,signal,sys
from durable_executor import Executor
def boundary(stage):
    if stage == sys.argv[3]: os.kill(os.getpid(),signal.SIGKILL)
endpoint=Executor(sys.argv[1],boundary=boundary)
request=json.loads(sys.argv[2]); receipt=endpoint.prepare(request)
endpoint.start(request['executionId'],receipt['finalDigest'])
endpoint.close()
"""
        child = subprocess.run([sys.executable, "-c", code, str(self.root / "authority"), json.dumps(request), stage], timeout=8)
        self.assertEqual(child.returncode, -signal.SIGKILL)
        return request

    def test_death_after_acceptance_can_start_the_same_execution_once(self):
        request = self.crash_at("accepted", "accepted-kill")
        receipt = self.endpoint.query(request["executionId"])
        self.assertEqual(receipt["state"], "accepted_not_started")
        self.assertFalse((self.workspace / "crash-window-effect").exists())
        self.endpoint.start(request["executionId"], receipt["finalDigest"])
        terminal = self.settle(request["executionId"])
        self.assertEqual(terminal["state"], "completed")
        self.assertEqual(self.endpoint.start(request["executionId"], receipt["finalDigest"]), terminal)
        self.assertEqual((self.workspace / "crash-window-effect").read_text(), "effect")

    def test_death_after_start_commit_before_fork_is_unknown_and_never_replayed(self):
        request = self.crash_at("start_committed", "start-commit-kill")
        receipt = self.endpoint.query(request["executionId"])
        self.assertEqual(receipt["state"], "unknown")
        self.assertEqual(self.endpoint.start(request["executionId"], receipt["finalDigest"])["state"], "unknown")
        self.assertEqual(self.endpoint.prepare(request)["state"], "unknown")
        self.assertFalse((self.workspace / "crash-window-effect").exists())

    def test_cancel_before_acceptance_survives_reopen_and_rejects_late_prepare(self):
        request = self.request("cancel-before-accept")
        cancelled = self.endpoint.cancel(request["executionId"], "user")
        self.assertEqual(cancelled["state"], "not_started")
        self.assertTrue(cancelled["neverStarted"])
        self.assertTrue(cancelled["scopeConfirmed"])
        self.endpoint.close()
        self.endpoint = Executor(self.root / "authority")
        self.assertEqual(self.endpoint.query(request["executionId"]), cancelled)
        with self.assertRaisesRegex(ExecutionFault, "CANCELLED_BEFORE_ACCEPTANCE"):
            self.endpoint.prepare(request)
        self.assertEqual(self.endpoint.cancel(request["executionId"], "user"), cancelled)

    def test_dispatch_lists_bounded_receipts_and_inspects_actual_workspace_identity(self):
        identity = self.endpoint.identity()
        self.assertTrue(Path(identity["defaultWorkspace"]).is_dir())
        inspected = self.endpoint.dispatch("inspectWorkspace", {"path": str(self.workspace)})
        self.assertEqual(inspected["state"], "available")
        self.assertEqual(inspected["realPath"], str(self.workspace.resolve()))
        self.assertEqual(inspected["namespace"], identity["namespace"])
        self.assertEqual(inspected, self.endpoint.dispatch("inspectWorkspace", {"path": str(self.workspace)}))
        self.workspace.rename(self.root / "old-workspace")
        self.workspace.mkdir()
        changed = self.endpoint.dispatch("inspectWorkspace", {"path": str(self.workspace)})
        self.assertNotEqual(changed["identity"], inspected["identity"])
        missing = self.endpoint.dispatch("inspectWorkspace", {"path": str(self.root / "missing")})
        self.assertEqual(missing["state"], "unavailable")
        self.assertNotIn("identity", missing)
        for index in range(12):
            request = self.request(f"page-{index:02d}")
            self.endpoint.dispatch("prepare", request)
        first = self.endpoint.dispatch("list", {"limit": 10})
        self.assertEqual(len(first["executions"]), 10)
        second = self.endpoint.dispatch("list", {"limit": 10, "cursor": first["nextCursor"]})
        self.assertEqual(len(second["executions"]), 2)
        self.assertIsNone(second["nextCursor"])
        self.assertEqual(len({row["executionId"] for row in first["executions"] + second["executions"]}), 12)
        with self.assertRaises(ExecutionFault):
            self.endpoint.dispatch("list", {"limit": 11})
        with self.assertRaises(ExecutionFault):
            self.endpoint.dispatch("cancel", {"executionId": "page-00", "command": "not-an-authorized-argument"})

    def test_concurrent_prepare_and_cancel_can_never_revive_the_same_execution(self):
        code = """import json,sys,time
from pathlib import Path
from durable_executor import Executor,ExecutionFault
root,request,mode,gate,ready,result=sys.argv[1:];endpoint=Executor(root);request=json.loads(request)
Path(ready).touch()
deadline=time.monotonic()+5
while not Path(gate).exists():
    if time.monotonic()>deadline:raise RuntimeError('test gate deadline')
    time.sleep(.005)
try:
    value=endpoint.prepare(request) if mode=='prepare' else endpoint.cancel(request['executionId'],'user')
except ExecutionFault as error:value={'error':error.code}
Path(result).write_text(json.dumps(value));endpoint.close()
"""
        for index in range(3):
            request = self.request(f"cancel-race-{index}", "printf effect >> forbidden-race-effect")
            gate = self.root / f"gate-{index}"
            children = []
            try:
                for mode in ("prepare", "cancel"):
                    children.append(subprocess.Popen([sys.executable, "-c", code, str(self.root / "authority"), json.dumps(request), mode, str(gate), str(self.root / f"ready-{index}-{mode}"), str(self.root / f"result-{index}-{mode}")]))
                deadline = time.monotonic() + 5
                while not all((self.root / f"ready-{index}-{mode}").exists() for mode in ("prepare", "cancel")):
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.01)
                gate.touch()
                for child in children:
                    self.assertEqual(child.wait(timeout=8), 0)
                receipt = self.endpoint.query(request["executionId"])
                self.assertIn(receipt["state"], ("not_started", "stopped"))
                self.assertTrue(receipt["neverStarted"])
                self.assertTrue(receipt["scopeConfirmed"])
                if "finalDigest" in receipt:
                    self.assertEqual(self.endpoint.start(request["executionId"], receipt["finalDigest"]), receipt)
                else:
                    with self.assertRaisesRegex(ExecutionFault, "CANCELLED_BEFORE_ACCEPTANCE"):
                        self.endpoint.prepare(request)
                self.assertFalse((self.workspace / "forbidden-race-effect").exists())
            finally:
                for child in children:
                    if child.poll() is None:
                        child.terminate()
                        child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
