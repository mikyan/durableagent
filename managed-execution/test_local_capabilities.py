"""Actual Termux process proof; each test owns a copied implementation and private ledger."""
import base64
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import time
import unittest
import uuid


class LocalCapabilityContract(unittest.TestCase):
    def test_prepared_local_file_and_supervisor_use_captured_bytes_after_both_source_paths_change(self):
        directory = Path(tempfile.mkdtemp(prefix="durable-local-capability-"))
        endpoint = None
        safe = False
        try:
            implementation = directory / "implementation"
            implementation.mkdir()
            for name in ("durable_executor.py", "file_service.py", "execution_transport.py"):
                shutil.copyfile(Path(__file__).with_name(name), implementation / name)
            spec = importlib.util.spec_from_file_location("isolated_local_capability", implementation / "durable_executor.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            endpoint = module.Executor(directory / "ledger")
            original = directory / "original.bin"
            original.write_bytes(b"before\x00")
            expected = "after 世界\n".encode() + bytes(range(256))
            identifier = str(uuid.uuid4())
            plan = endpoint.dispatch("file.prepareWrite", {"operationId": identifier, "path": str(original), "mode": "write", "data": base64.b64encode(expected).decode()})
            self.assertTrue(plan["ok"], plan)
            request = {"executionId": str(uuid.uuid4()), "context": {"productId": "local-capability-test", "sdkConversationId": 1, "taskId": 1, "callId": "write", "bindingId": "local-binding", "locationVersion": 1, "controlGeneration": 1, "namespace": endpoint.identity()["namespace"]}, "command": {"kind": "argv", "argv": plan["value"]["argv"]}, "cwd": str(directory), "env": {}, "inheritEnv": False, "timeoutMs": 10000}
            accepted = endpoint.prepare(request)
            self.assertEqual(accepted["localCapability"]["kind"], "file-apply-v1")
            # Only these dedicated copies change. If either path is reopened to execute,
            # the immutable accepted operation cannot produce the requested original bytes.
            (implementation / "file_service.py").write_text("raise SystemExit(74)\n", encoding="utf-8")
            (implementation / "durable_executor.py").write_text("raise SystemExit(75)\n", encoding="utf-8")
            endpoint.start(request["executionId"], accepted["finalDigest"])
            deadline = time.monotonic() + 15
            while True:
                receipt = endpoint.query(request["executionId"])
                if receipt.get("scopeConfirmed"):
                    safe = True
                    break
                self.assertLess(time.monotonic(), deadline, receipt)
                time.sleep(0.03)
            self.assertEqual(receipt["state"], "completed", receipt)
            self.assertEqual(receipt["exitCode"], 0, receipt)
            self.assertEqual(original.read_bytes(), expected)
            self.assertEqual(endpoint.prepare(request), receipt)
            self.assertEqual(endpoint.start(request["executionId"], accepted["finalDigest"]), receipt)
            self.assertEqual(original.read_bytes(), expected)
            print("T13_LOCAL_SOURCE_EVIDENCE " + json.dumps({"executionId": request["executionId"], "localCapability": receipt["localCapability"], "finalDigest": receipt["finalDigest"], "scopeConfirmed": receipt["scopeConfirmed"], "exitCode": receipt["exitCode"], "originalBytes": len(expected), "changedSourceCopies": 2, "repeatedIdentityDidNotRepeat": True}), flush=True)
        finally:
            if endpoint is not None:
                endpoint.close()
            if safe:
                shutil.rmtree(directory)
            else:
                print("Retaining dedicated local capability evidence: " + str(directory), flush=True)


if __name__ == "__main__":
    unittest.main()
