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
    def test_write_creates_missing_parents_only_after_supervised_start_under_verified_ancestor(self):
        with supervised_directory() as (root, executor):
            target = root / "new-parent" / "nested" / "original.txt"
            position = executor.dispatch("file.resolveWrite", {"path": str(target)})
            self.assertTrue(position["ok"], position)
            self.assertEqual(position["value"]["writeRoot"], str(root / "new-parent"))
            identifier = str(uuid.uuid4())
            planned = executor.dispatch("file.prepareWrite", {"operationId": identifier, "path": str(target), "mode": "write", "data": base64.b64encode(b"nested original\n").decode()})
            self.assertTrue(planned["ok"], planned)
            self.assertFalse((root / "new-parent").exists())
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "nested-write", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": executor.identity()["namespace"]}, "command": {"kind": "argv", "argv": planned["value"]["argv"]}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            accepted = executor.prepare(request)
            executor.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                receipt = executor.query(request["executionId"])
                if receipt.get("scopeConfirmed"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(receipt["exitCode"], 0)
            self.assertEqual(target.read_bytes(), b"nested original\n")
            self.assertTrue(executor.dispatch("file.verifyWrite", {"operationId": identifier})["value"]["matchesExpected"])
            self.assertEqual(executor.dispatch("file.writeResult", {"operationId": identifier})["value"]["state"], "completed")

    def test_supervised_rename_keeps_open_reader_on_original_and_never_repeats_after_later_edits(self):
        with supervised_directory() as (root, executor):
            source, destination = root / "source.txt", root / "destination.txt"
            source.write_bytes(b"original bytes\n")
            destination.write_bytes(b"previous destination\n")
            inode = source.stat().st_ino
            opened = executor.dispatch("file.open", {"path": str(source), "noFollow": True})["value"]
            identifier = str(uuid.uuid4())
            planned = executor.dispatch("file.prepareMutation", {"operationId": identifier, "path": str(source), "kind": "rename", "options": {"destination": str(destination)}})
            self.assertTrue(planned["ok"], planned)
            self.assertEqual(destination.read_bytes(), b"previous destination\n")
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "rename", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": executor.identity()["namespace"]}, "command": {"kind": "argv", "argv": planned["value"]["argv"]}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            accepted = executor.prepare(request)
            executor.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                receipt = executor.query(request["executionId"])
                if receipt.get("scopeConfirmed"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(receipt["exitCode"], 0)
            self.assertFalse(source.exists())
            self.assertEqual(destination.read_bytes(), b"original bytes\n")
            self.assertEqual(destination.stat().st_ino, inode)
            page = executor.dispatch("file.read", {"handle": opened["handle"], "offset": 0, "length": 100})
            self.assertEqual(base64.b64decode(page["value"]["data"]), b"original bytes\n")
            result = executor.dispatch("file.writeResult", {"operationId": identifier})["value"]
            self.assertEqual(result["state"], "completed")
            self.assertEqual(result["destination"], str(destination))
            self.assertTrue(executor.dispatch("file.verifyWrite", {"operationId": identifier})["value"]["matchesExpected"])
            source.write_bytes(b"new source")
            destination.write_bytes(b"later edit")
            executor.start(request["executionId"], accepted["finalDigest"])
            self.assertEqual(source.read_bytes(), b"new source")
            self.assertEqual(destination.read_bytes(), b"later edit")

    def test_polling_snapshot_reports_real_nested_changes_missing_targets_and_new_epoch(self):
        with tempfile.TemporaryDirectory(prefix="durable-watch-") as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            target = root / "nested" / "source.txt"
            target.write_bytes(b"before")
            (root / ".hidden").write_bytes(b"hidden")
            (root / "ignored").write_bytes(b"ignored")
            targets = [{"path": str(root), "recursive": True, "exclude": {"hidden": True, "names": ["ignored"]}}, {"path": str(root / "missing"), "recursive": False, "exclude": {"hidden": False, "names": []}}]
            service = FileService("termux:watch")
            try:
                first = service.dispatch("file.snapshot", {"targets": targets})
                self.assertTrue(first["ok"], first)
                self.assertEqual(first, service.dispatch("file.snapshot", {"targets": targets}))
                (root / ".hidden").write_bytes(b"hidden changed")
                (root / "ignored").write_bytes(b"ignored changed")
                self.assertEqual(first, service.dispatch("file.snapshot", {"targets": targets}))
                target.write_bytes(b"after expanded")
                changed = service.dispatch("file.snapshot", {"targets": targets})["value"]
                self.assertNotEqual(first["value"]["snapshots"][0]["revision"], changed["snapshots"][0]["revision"])
                self.assertEqual(first["value"]["snapshots"][1], changed["snapshots"][1])
                (root / "missing").write_bytes(b"created")
                created = service.dispatch("file.snapshot", {"targets": targets})["value"]
                self.assertNotEqual(changed["snapshots"][1]["revision"], created["snapshots"][1]["revision"])
                fresh = FileService("termux:watch")
                try:
                    self.assertNotEqual(created["epoch"], fresh.dispatch("file.snapshot", {"targets": targets})["value"]["epoch"])
                finally:
                    fresh.close()
            finally:
                service.close()

    def test_truncate_extend_and_flush_preserve_original_inode_and_reject_missing_files(self):
        with supervised_directory() as (root, executor):
            target = root / "truncate.bin"
            target.write_bytes(b"abcdef")
            inode = target.stat().st_ino
            for kind, options, expected in [("truncate", {"size": 3}, b"abc"), ("truncate", {"size": 6}, b"abc\0\0\0"), ("flush", {}, b"abc\0\0\0")]:
                identifier = str(uuid.uuid4())
                planned = executor.dispatch("file.prepareMutation", {"operationId": identifier, "path": str(target), "kind": kind, "options": options})
                self.assertTrue(planned["ok"], planned)
                request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": kind, "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": executor.identity()["namespace"]}, "command": {"kind": "argv", "argv": planned["value"]["argv"]}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
                accepted = executor.prepare(request)
                executor.start(request["executionId"], accepted["finalDigest"])
                deadline = time.monotonic() + 8
                while True:
                    receipt = executor.query(request["executionId"])
                    if receipt.get("scopeConfirmed"):
                        break
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.02)
                self.assertEqual(receipt["exitCode"], 0)
                self.assertEqual(target.read_bytes(), expected)
                self.assertEqual(target.stat().st_ino, inode)
                result = executor.dispatch("file.writeResult", {"operationId": identifier})["value"]
                self.assertEqual(result["state"], "completed")
                self.assertEqual(result["after"]["sha256"], hashlib.sha256(expected).hexdigest())
            for kind, options in [("truncate", {"size": 0}), ("flush", {})]:
                absent = executor.dispatch("file.prepareMutation", {"operationId": str(uuid.uuid4()), "path": str(root / "missing"), "kind": kind, "options": options})
                self.assertEqual(absent["error"]["code"], "not_found")
            invalid = executor.dispatch("file.prepareMutation", {"operationId": str(uuid.uuid4()), "path": str(target), "kind": "truncate", "options": {"size": -1}})
            self.assertEqual(invalid["error"]["code"], "invalid")

    def test_large_binary_staging_survives_reopen_and_repeated_chunks_before_original_write(self):
        with supervised_directory() as (root, executor):
            data = bytes(range(256)) * 600
            digest = hashlib.sha256(data).hexdigest()
            namespace = executor.identity()["namespace"]
            stage_root = root / "owned-executor" / "file-capabilities"
            service = FileService(namespace, stage_root)
            first = {"digest": digest, "totalBytes": len(data), "offset": 0, "data": base64.b64encode(data[:32768]).decode()}
            reply = service.dispatch("file.stage", first)
            self.assertTrue(reply["ok"])
            self.assertEqual(reply["value"]["nextOffset"], 32768)
            service.close()
            service = FileService(namespace, stage_root)
            try:
                repeated = service.dispatch("file.stage", first)
                self.assertEqual(repeated["value"]["nextOffset"], 32768)
                different = service.dispatch("file.stage", {**first, "data": base64.b64encode(b"bad").decode()})
                self.assertEqual(different["error"]["code"], "invalid")
                for offset in range(32768, len(data), 32768):
                    reply = service.dispatch("file.stage", {"digest": digest, "totalBytes": len(data), "offset": offset, "data": base64.b64encode(data[offset:offset+32768]).decode()})
                    self.assertTrue(reply["ok"])
                self.assertTrue(reply["value"]["sealed"])
                self.assertEqual(reply["value"]["nextOffset"], len(data))
            finally:
                service.close()
            target = root / "large-original.bin"
            target.write_bytes(b"old")
            identifier = str(uuid.uuid4())
            prepared_file = executor.dispatch("file.prepareStagedWrite", {"operationId": identifier, "path": str(target), "mode": "write", "digest": digest, "totalBytes": len(data)})
            self.assertTrue(prepared_file["ok"])
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "large-write", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": namespace}, "command": {"kind": "argv", "argv": prepared_file["value"]["argv"]}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            accepted = executor.prepare(request)
            executor.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                receipt = executor.query(request["executionId"])
                if receipt.get("scopeConfirmed"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(receipt["exitCode"], 0)
            self.assertEqual(target.read_bytes(), data)
            self.assertEqual(executor.dispatch("file.writeResult", {"operationId": identifier})["value"]["diff"], {"available": False, "reason": "too_large"})

    def test_append_is_binary_exact_and_same_execution_does_not_append_twice(self):
        with supervised_directory() as (root, executor):
            target = root / "binary.dat"
            target.write_bytes(b"a\0")
            identifier = str(uuid.uuid4())
            planned = executor.dispatch("file.prepareWrite", {"operationId": identifier, "path": str(target), "mode": "append", "data": base64.b64encode(b"\xff\n").decode()})
            self.assertTrue(planned["ok"])
            plan = planned["value"]
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "file-test", "sdkConversationId": 1, "taskId": 1, "callId": "append", "bindingId": "binding", "locationVersion": 1, "controlGeneration": 1, "namespace": executor.identity()["namespace"]}, "command": {"kind": "argv", "argv": plan["argv"]}, "cwd": str(root), "env": {}, "inheritEnv": True, "timeoutMs": 5000}
            prepared = executor.prepare(request)
            executor.start(request["executionId"], prepared["finalDigest"])
            deadline = time.monotonic() + 8
            while True:
                result = executor.query(request["executionId"])
                if result.get("scopeConfirmed"):
                    break
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(result["exitCode"], 0)
            self.assertEqual(target.read_bytes(), b"a\0\xff\n")
            receipt = executor.dispatch("file.writeResult", {"operationId": identifier})["value"]
            self.assertEqual(receipt["state"], "completed")
            self.assertEqual(receipt["diff"], {"available": False, "reason": "binary"})
            executor.start(request["executionId"], prepared["finalDigest"])
            self.assertEqual(target.read_bytes(), b"a\0\xff\n")

    def test_open_directory_pages_remain_on_the_opened_directory_and_are_bounded(self):
        with tempfile.TemporaryDirectory(prefix="durable-directory-test-") as directory:
            root = Path(directory)
            target = root / "entries"
            target.mkdir()
            for index in range(150):
                (target / (str(index) + "-世界.txt")).write_bytes(b"data")
            (target / "nested").mkdir()
            (target / "alias").symlink_to("0-世界.txt")
            service = FileService("termux:directory")
            try:
                opened = service.dispatch("file.openDir", {"path": str(target)})
                self.assertTrue(opened["ok"])
                token = opened["value"]["handle"]
                target.rename(root / "moved")
                target.mkdir()
                (target / "replacement").write_bytes(b"different directory")
                entries = []
                for _ in range(20):
                    page = service.dispatch("file.readDir", {"handle": token, "maxEntries": 17})
                    self.assertTrue(page["ok"])
                    self.assertLessEqual(len(page["value"]["entries"]), 17)
                    entries.extend(page["value"]["entries"])
                    if page["value"]["done"]:
                        break
                else:
                    self.fail("Directory reader did not finish within its bounded entry count")
                self.assertEqual(len(entries), 152)
                self.assertNotIn("replacement", {entry["name"] for entry in entries})
                self.assertEqual(next(entry for entry in entries if entry["name"] == "alias")["kind"], "symlink")
                self.assertEqual(next(entry for entry in entries if entry["name"] == "nested")["kind"], "directory")
                self.assertEqual(service.dispatch("file.readDir", {"handle": token, "maxEntries": 0})["error"]["code"], "invalid")
                service.dispatch("file.close", {"handle": token})
                self.assertEqual(service.dispatch("file.readDir", {"handle": token, "maxEntries": 1})["error"]["code"], "unknown")
            finally:
                service.close()

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
