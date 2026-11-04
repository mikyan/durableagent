"""Production CLI + real authenticated sockets + durable process effects, in an isolated root."""
import base64
import json
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import uuid


def frame(connection, value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    connection.sendall(struct.pack("!I", len(data)) + data)


def receive(connection):
    def exact(length):
        result = bytearray()
        while len(result) < length:
            chunk = connection.recv(length - len(result))
            if not chunk:
                raise EOFError()
            result.extend(chunk)
        return bytes(result)
    length = struct.unpack("!I", exact(4))[0]
    if not 1 <= length <= 65536:
        raise AssertionError("Unbounded production response")
    return json.loads(exact(length))


class ProductionWireTest(unittest.TestCase):
    def test_real_cli_reconnects_same_effect_and_persists_pre_accept_cancellation(self):
        with tempfile.TemporaryDirectory(prefix="durable-production-wire-") as name:
            root = Path(name)
            key, cert = root / "client.key", root / "client.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-sha256", "-days", "2", "-subj", "/CN=Production wire test", "-keyout", str(key), "-out", str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            authority = root / "authority"
            script = str(Path(__file__).with_name("durable_executor.py"))
            nonce = str(uuid.uuid4())
            bootstrap = subprocess.run([sys.executable, script, "--root", str(authority), "bootstrap", "--client-cert-base64", base64.b64encode(cert.read_bytes()).decode(), "--nonce", nonce], capture_output=True, text=True, timeout=20)
            self.assertEqual(bootstrap.returncode, 0, "Production bootstrap did not return success")
            paired = json.loads(bootstrap.stdout)
            self.assertEqual(paired["nonce"], nonce)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.load_verify_locations(cafile=str(authority / "transport/server-cert.pem"))
            context.load_cert_chain(str(cert), str(key))
            process = subprocess.Popen([sys.executable, script, "--root", str(authority), "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            def request(method, payload, abandon=False):
                with context.wrap_socket(socket.create_connection(("127.0.0.1", paired["port"]), timeout=3), server_hostname="localhost") as connection:
                    challenge = str(uuid.uuid4())
                    hello_id = str(uuid.uuid4())
                    frame(connection, {"protocol": 1, "requestId": hello_id, "method": "hello", "payload": {"clientNonce": challenge}})
                    hello = receive(connection)
                    self.assertEqual(hello["requestId"], hello_id)
                    self.assertEqual(hello["value"]["clientNonce"], challenge)
                    self.assertEqual(hello["value"]["executorId"], paired["executorId"])
                    self.assertEqual(hello["value"]["ledgerEpoch"], paired["ledgerEpoch"])
                    session = {name: hello["value"][name] for name in ("executorId", "ledgerEpoch", "processEpoch", "connectionNonce")}
                    operation_id = str(uuid.uuid4())
                    frame(connection, {"protocol": 1, "requestId": operation_id, "method": method, "payload": payload, "session": session})
                    if abandon:
                        return
                    response = receive(connection)
                    self.assertEqual(response["requestId"], operation_id)
                    self.assertEqual(response["session"], session)
                    return response
            try:
                deadline = time.monotonic() + 8
                while True:
                    self.assertIsNone(process.poll(), "Owned production server exited")
                    try:
                        info = request("ping", {})["value"]
                        break
                    except (OSError, EOFError):
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.025)
                workspace = Path(info["defaultWorkspace"])
                self.assertEqual(request("inspectWorkspace", {"path": str(workspace)})["value"]["state"], "available")
                command = {"executionId": "wire-one", "context": {"productId": "wire-product", "sdkConversationId": 2, "taskId": 3, "callId": "wire-call", "bindingId": "wire-binding", "locationVersion": 1, "controlGeneration": 1, "namespace": info["namespace"]},
                           "command": {"kind": "argv", "argv": [sys.executable, "-c", "from pathlib import Path;print('真实 wire 输出',flush=True);Path('effect').open('a').write('once\\n')"]},
                           "cwd": str(workspace), "env": {}, "inheritEnv": False, "timeoutMs": None}
                accepted = request("prepare", command)["value"]
                request("start", {"executionId": "wire-one", "finalDigest": accepted["finalDigest"]}, abandon=True)
                # Establish that the abandoned first request reached the executor.
                # A second start cannot be the request that creates the first effect.
                deadline = time.monotonic() + 8
                while True:
                    observed = request("query", {"executionId": "wire-one"})["value"]
                    if observed['state'] in ('running', 'completed'):
                        break
                    self.assertLess(time.monotonic(), deadline, observed)
                    time.sleep(.02)
                # A duplicate start uses the same immutable identity, never a replacement command.
                request("start", {"executionId": "wire-one", "finalDigest": accepted["finalDigest"]})
                while True:
                    receipt = request("query", {"executionId": "wire-one"})["value"]
                    if receipt["state"] in ("completed", "stopped", "unknown", "not_started"):
                        break
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.02)
                self.assertEqual(receipt["state"], "completed", receipt)
                self.assertEqual((workspace / "effect").read_text(), "once\n")
                raw = request("readRawOutput", {"executionId": "wire-one", "offset": 0, "length": 32768})["value"]
                self.assertEqual(base64.b64decode(raw["data"]).decode(), "真实 wire 输出\n")
                self.assertEqual(request("list", {"limit": 10})["value"]["executions"][0]["executionId"], "wire-one")
                stopped = request("cancel", {"executionId": "wire-late", "reason": "user"})["value"]
                self.assertEqual(stopped["state"], "not_started")
                rejected = request("prepare", {**command, "executionId": "wire-late"})
                self.assertFalse(rejected["ok"])
                self.assertEqual(rejected["error"]["code"], "CANCELLED_BEFORE_ACCEPTANCE")
                self.assertEqual((workspace / "effect").read_text(), "once\n")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
