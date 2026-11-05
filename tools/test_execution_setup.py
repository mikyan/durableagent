"""Public installer boundary; run on Termux for kernel-lock cases."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from execution_setup_installer import install, SetupFault


class SetupTest(unittest.TestCase):
    def test_adds_file_capability_to_owned_v1_install_without_replacing_data_or_pairing(self):
        old = {'durable_executor.py': b'executor v1\n', 'execution_transport.py': b'transport v1\n'}
        updated = {**old, 'file_service.py': b'file capabilities\n'}
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            install(home, old)
            root = home / '.local/share/durableagent-execution'
            (root / 'execution.sqlite').write_bytes(b'existing ledger is not installer owned')
            (root / 'pairing.json').write_bytes(b'existing public pairing')
            install(home, updated)
            self.assertEqual((root / 'file_service.py').read_bytes(), updated['file_service.py'])
            self.assertEqual((root / 'execution.sqlite').read_bytes(), b'existing ledger is not installer owned')
            self.assertEqual((root / 'pairing.json').read_bytes(), b'existing public pairing')
            with self.assertRaisesRegex(SetupFault, 'MANIFEST_UNRECOGNIZED'):
                install(home, old)

    def test_refuses_unmanaged_modified_and_symlink_files_without_touching_them(self):
        scripts = {'durable_executor.py': b'executor\n', 'execution_transport.py': b'transport\n'}
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            root = home / '.local/share/durableagent-execution'
            root.mkdir(parents=True)
            target = root / 'durable_executor.py'
            target.write_bytes(b'users own script')
            with self.assertRaisesRegex(SetupFault, 'UNMANAGED_OR_MODIFIED_SCRIPT'):
                install(home, scripts)
            self.assertEqual(target.read_bytes(), b'users own script')
            target.unlink()
            install(home, scripts)
            target.write_bytes(b'users changed script')
            with self.assertRaisesRegex(SetupFault, 'UNMANAGED_OR_MODIFIED_SCRIPT'):
                install(home, scripts)
            self.assertEqual(target.read_bytes(), b'users changed script')
            target.unlink()
            outside = home / 'untouched'
            outside.write_bytes(b'outside')
            target.symlink_to(outside)
            with self.assertRaisesRegex(SetupFault, 'SYMLINK_REFUSED'):
                install(home, scripts)
            self.assertEqual(outside.read_bytes(), b'outside')

    def test_refuses_actual_live_server_and_guardian_locks(self):
        scripts = {'durable_executor.py': b'executor\n', 'execution_transport.py': b'transport\n'}
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            install(home, scripts)
            root = home / '.local/share/durableagent-execution'
            (root / 'owners').mkdir()
            for name in ('server.lock', 'owners/execution.lock'):
                child = subprocess.Popen([sys.executable, '-c', "import fcntl,sys,time; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(30)", str(root / name)], stdout=subprocess.PIPE, text=True)
                try:
                    self.assertEqual(child.stdout.readline().strip(), 'locked')
                    with self.assertRaisesRegex(SetupFault, 'EXECUTOR_ACTIVE'):
                        install(home, scripts)
                    self.assertEqual((root / 'durable_executor.py').read_bytes(), scripts['durable_executor.py'])
                finally:
                    child.terminate(); child.wait(timeout=5); child.stdout.close()
            install(home, scripts)

    def test_resumes_only_known_partial_install_and_normalizes_effective_last_property(self):
        scripts = {'durable_executor.py': b'new executor\n', 'execution_transport.py': b'new transport\n'}
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            root = home / '.local/share/durableagent-execution'
            root.mkdir(parents=True)
            hashes = {name:hashlib.sha256(content).hexdigest() for name,content in scripts.items()}
            record = {'kind':'durableagent-execution-install','protocol':1,'state':'installing','files':hashes,'previous':dict.fromkeys(scripts)}
            (root / 'installation.json').write_text(json.dumps(record))
            (root / 'durable_executor.py').write_bytes(scripts['durable_executor.py'])
            (home / '.termux').mkdir()
            props = home / '.termux/termux.properties'
            original = b'allow-external-apps=true\nallow-external-apps:false\ncontinued=value\\'
            props.write_bytes(original)
            install(home, scripts)
            self.assertEqual((root / 'execution_transport.py').read_bytes(), scripts['execution_transport.py'])
            self.assertTrue(props.read_bytes().startswith(original))
            self.assertTrue(props.read_bytes().endswith(b'\n\nallow-external-apps=true\n'))
            self.assertEqual(json.loads((root / 'installation.json').read_text())['state'], 'installed')

    def test_install_is_repeatable_and_preserves_existing_data_and_properties(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            root = home / '.local/share/durableagent-execution'
            root.mkdir(parents=True)
            (root / 'ledger.sqlite').write_bytes(b'existing ledger sentinel')
            (home / '.termux').mkdir()
            props = home / '.termux/termux.properties'
            props.write_text('extra-keys=keep\nallow-external-apps=true\nallow-external-apps=false\n')
            scripts = {'durable_executor.py': b'print("executor fixture")\n', 'execution_transport.py': b'# transport fixture\n'}
            install(home, scripts)
            first = props.read_bytes()
            install(home, scripts)
            self.assertEqual(props.read_bytes(), first)
            self.assertTrue(first.endswith(b'\nallow-external-apps=true\n'))
            self.assertIn(b'extra-keys=keep\n', first)
            self.assertEqual((root / 'ledger.sqlite').read_bytes(), b'existing ledger sentinel')
            for name, content in scripts.items():
                self.assertEqual((root / name).read_bytes(), content)


if __name__ == '__main__':
    unittest.main()
