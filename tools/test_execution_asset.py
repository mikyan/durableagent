import base64
import gzip
import hashlib
import re
import tempfile
import unittest
from pathlib import Path

from build_execution_setup import build


class AssetTest(unittest.TestCase):
    def test_copyable_command_contains_verified_complete_sources_without_patch_version_gates(self):
        repo = Path(__file__).resolve().parents[1]
        command = build(repo)
        self.assertEqual(command, build(repo))
        self.assertLess(len(command), 600000)
        encoded = command.split("<<'DURABLE_EXECUTION_PAYLOAD'\n", 1)[1].split('\nDURABLE_EXECUTION_PAYLOAD', 1)[0]
        compressed = base64.b64decode(encoded)
        self.assertIn(hashlib.sha256(compressed).hexdigest(), command)
        installer = gzip.decompress(compressed).decode()
        for name in ('durable_executor.py', 'execution_transport.py', 'file_service.py'):
            self.assertIn(base64.b64encode((repo / 'managed-execution' / name).read_bytes()).decode(), installer)
        self.assertNotRegex(command, r'python=\d|openssl-tool=\d')
        self.assertIn('--check-python', command)
        self.assertIn('--check-runtime', command)
        self.assertIn('--no-upgrade', command)
        self.assertIn('--no-remove', command)
        self.assertIn('--force-confold', command)
        self.assertNotIn('rm -rf', command)


if __name__ == '__main__':
    unittest.main()
