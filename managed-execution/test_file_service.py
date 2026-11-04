import base64
import hashlib
import os
import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path
import tempfile
import time
import unittest
import uuid

from file_service import FileService


@contextmanager
def supervised_directory():
    from durable_executor import Executor
    directory = tempfile.mkdtemp(prefix="durable-file-write-")
    root = Path(directory)
    executor = Executor(root / "owned-executor")
    safe = False
    try:
        yield root, executor
    finally:
        try:
            records = executor.list_executions()["executions"]
            for recorded in records:
                identifier = recorded["executionId"]
                receipt = executor.query(identifier)
                if not receipt.get("scopeConfirmed"):
                    executor.cancel(identifier, "user")
                    deadline = time.monotonic() + 10
                    while not receipt.get("scopeConfirmed") and time.monotonic() < deadline:
                        time.sleep(0.03)
                        receipt = executor.query(identifier)
                if not receipt.get("scopeConfirmed"):
                    raise AssertionError("Own execution scope not confirmed; retaining test directory " + directory)
            safe = True
        finally:
            executor.close()
            if safe:
                shutil.rmtree(directory)


class FileCapabilityTest(unittest.TestCase):
    def test_write_coordination_resolves_actual_symlink_aliases_and_missing_leaf_before_any_effect(self):
        with supervised_directory() as (root, executor):
            original = root / "source.txt"
            original.write_bytes(b"source\n")
            alias = root / "symlink.txt"
            alias.symlink_to(original.name)
            description = executor.dispatch("file.describe", {})
            self.assertTrue(description["ok"])
            self.assertEqual(description["value"]["namespace"], executor.identity()["namespace"])
            self.assertEqual(description["value"]["applyArgvPrefix"][2], "apply")
            positions = [executor.dispatch("file.resolveWrite", {"path": str(path)})["value"] for path in (original, alias, root / "new.txt")]
            self.assertEqual(positions[0]["canonicalPath"], positions[1]["canonicalPath"])
            self.assertEqual(positions[0]["objectId"], positions[1]["objectId"])
            self.assertIsNone(positions[2]["objectId"])
            self.assertEqual(positions[0]["ancestorObjectIds"], positions[2]["ancestorObjectIds"])
            self.assertFalse((root / "new.txt").exists())

    def test_killed_writer_after_effect_is_verified_without_repeating_or_overwriting_later_content(self):
        with supervised_directory() as (root, executor):
            target = root / "original.txt"
            target.write_bytes(b"old\n")
            identifier = str(uuid.uuid4())
            plan = executor.dispatch("file.prepareWrite", {"operationId": identifier, "path": str(target), "mode": "write", "data": base64.b64encode(b"new\n").decode()})["value"]
            namespace = executor.identity()["namespace"]
            cut = "import os,signal,sys; sys.path.insert(0,sys.argv[1]); from file_service import apply_write; apply_write(sys.argv[2],sys.argv[3],lambda stage: os.kill(os.getpid(),signal.SIGKILL))"
            argv = [plan["argv"][0], "-c", cut, str(Path(__file__).resolve().parent), plan["argv"][-2], identifier]
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "file-cut", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": namespace}, "command": {"kind": "argv", "argv": argv}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            accepted = executor.prepare(request)
            executor.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                receipt = executor.query(request["executionId"])
                if receipt.get("scopeConfirmed"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(target.read_bytes(), b"new\n")
            self.assertNotEqual(executor.dispatch("file.writeResult", {"operationId": identifier})["value"]["state"], "completed")
            verified = executor.dispatch("file.verifyWrite", {"operationId": identifier})
            self.assertTrue(verified["ok"])
            self.assertTrue(verified["value"]["matchesExpected"])
            self.assertEqual(verified["value"]["observed"]["sha256"], hashlib.sha256(b"new\n").hexdigest())
            target.write_bytes(b"user edited later\n")
            executor.start(request["executionId"], accepted["finalDigest"])
            self.assertEqual(target.read_bytes(), b"user edited later\n")
            different = executor.dispatch("file.verifyWrite", {"operationId": identifier})
            self.assertFalse(different["value"]["matchesExpected"])

    def test_supervised_write_changes_the_original_once_and_returns_a_bounded_real_diff(self):
        with supervised_directory() as (root, executor):
            directory = str(root)
            target = root / "original.txt"
            target.write_bytes(b"before\n")
            original_inode = target.stat().st_ino
            operation_id = str(uuid.uuid4())
            plan = executor.dispatch("file.prepareWrite", {"operationId": operation_id, "path": str(target), "mode": "write", "data": base64.b64encode("after-世界\n".encode()).decode()})
            self.assertTrue(plan["ok"])
            namespace = executor.identity()["namespace"]
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "file-write", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": namespace}, "command": {"kind": "argv", "argv": plan["value"]["argv"]}, "cwd": directory, "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            accepted = executor.prepare(request)
            executor.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                receipt = executor.query(request["executionId"])
                if receipt["state"] in ("completed", "stopped", "unknown", "not_started"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(receipt["state"], "completed")
            self.assertEqual(receipt["exitCode"], 0)
            self.assertEqual(target.read_bytes(), "after-世界\n".encode())
            self.assertEqual(target.stat().st_ino, original_inode)
            result = executor.dispatch("file.writeResult", {"operationId": operation_id})
            self.assertEqual(result["value"]["state"], "completed")
            self.assertEqual(result["value"]["original"], True)
            self.assertIn("-before\n+after-世界\n", result["value"]["diff"]["text"])
            self.assertLess(len(result["value"]["diff"]["text"].encode()), 16384)
            repeated = executor.start(request["executionId"], accepted["finalDigest"])
            self.assertEqual(repeated["state"], "completed")
            self.assertEqual(target.read_bytes(), "after-世界\n".encode())

    def test_executor_dispatch_uses_its_own_namespace_for_file_capabilities(self):
        from durable_executor import Executor
        with tempfile.TemporaryDirectory(prefix="durable-file-dispatch-") as directory:
            root = Path(directory)
            executor = Executor(root / "owned-executor")
            target = root / "original.bin"
            target.write_bytes(b"same owner\x00\xff")
            try:
                opened = executor.dispatch("file.open", {"path": str(target), "noFollow": False})
                self.assertTrue(opened["ok"])
                self.assertEqual(opened["value"]["namespace"], executor.identity()["namespace"])
                page = executor.dispatch("file.read", {"handle": opened["value"]["handle"], "offset": 0, "length": 100})
                self.assertEqual(base64.b64decode(page["value"]["data"]), b"same owner\x00\xff")
            finally:
                executor.close()

    def test_path_metadata_distinguishes_symlinks_and_canonical_identity_without_inventing_missing_paths(self):
        with tempfile.TemporaryDirectory(prefix="durable-file-test-") as directory:
            target = Path(directory) / "original.txt"
            target.write_bytes(b"actual\n")
            alias = target.with_name("alias.txt")
            alias.symlink_to(target.name)
            service = FileService("termux:test-instance")
            try:
                linked = service.dispatch("file.stat", {"path": str(alias)})
                self.assertTrue(linked["ok"])
                self.assertEqual(linked["value"]["kind"], "symlink")
                canonical = service.dispatch("file.canonical", {"path": str(alias)})
                self.assertEqual(canonical["value"], str(target))
                missing = service.dispatch("file.stat", {"path": str(target.with_name("missing"))})
                self.assertEqual(missing["error"]["code"], "not_found")
                no_follow = service.dispatch("file.open", {"path": str(alias), "noFollow": True})
                self.assertEqual(no_follow["error"]["code"], "invalid")
                non_directory = service.dispatch("file.stat", {"path": str(target / "child")})
                self.assertEqual(non_directory["error"]["code"], "not_directory")
            finally:
                service.close()

    def test_binary_file_read_uses_bounded_pages_and_precise_errors(self):
        with tempfile.TemporaryDirectory(prefix="durable-file-test-") as directory:
            target = Path(directory) / "original.txt"
            target.write_bytes(b"hello\x00world\n")
            service = FileService("termux:test-instance")
            try:
                opened = service.dispatch("file.open", {"path": str(target), "noFollow": False})
                self.assertTrue(opened["ok"])
                handle = opened["value"]["handle"]
                page = service.dispatch("file.read", {"handle": handle, "offset": 3, "length": 5})
                self.assertTrue(page["ok"])
                self.assertEqual(base64.b64decode(page["value"]["data"]), b"lo\x00wo")
                self.assertEqual(page["value"]["namespace"], "termux:test-instance")
                self.assertEqual(page["value"]["offset"], 3)
                excessive = service.dispatch("file.read", {"handle": handle, "offset": 0, "length": 32769})
                self.assertEqual(excessive["error"]["code"], "invalid")
                missing = service.dispatch("file.open", {"path": str(target.parent / "missing"), "noFollow": False})
                self.assertEqual(missing["error"]["code"], "not_found")
                closed = service.dispatch("file.close", {"handle": handle})
                self.assertTrue(closed["ok"])
                expired = service.dispatch("file.read", {"handle": handle, "offset": 0, "length": 1})
                self.assertEqual(expired["error"]["code"], "unknown")
            finally:
                service.close()

    def test_opened_reader_keeps_original_inode_when_path_is_replaced(self):
        with tempfile.TemporaryDirectory(prefix="durable-file-test-") as directory:
            target = Path(directory) / "original.txt"
            target.write_bytes(b"original\n")
            service = FileService("termux:test-instance")
            try:
                opened = service.dispatch("file.open", {"path": str(target), "noFollow": True})
                self.assertTrue(opened["ok"])
                token = opened["value"]["handle"]
                before = service.dispatch("file.info", {"handle": token})
                self.assertTrue(before["ok"])
                target.rename(target.with_name("moved.txt"))
                target.write_bytes(b"replacement is different\n")
                page = service.dispatch("file.read", {"handle": token, "offset": 0, "length": 100})
                self.assertEqual(base64.b64decode(page["value"]["data"]), b"original\n")
                after = service.dispatch("file.info", {"handle": token})
                self.assertEqual(after["value"]["size"], 9)
                reopened = service.dispatch("file.open", {"path": str(target), "noFollow": True})
                self.assertEqual(reopened["value"]["info"]["size"], 25)
            finally:
                service.close()
