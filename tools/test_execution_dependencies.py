"""The generated shell's package-manager boundary; no real packages are changed."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from build_execution_setup import dependency_setup


@unittest.skipUnless(shutil.which('bash'), 'requires a POSIX shell')
class DependenciesTest(unittest.TestCase):
    def run_setup(self, python=True, openssl=True, probe_ok=True, plan='', library=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bin', 'prefix/bin', 'scratch'):
                (root / name).mkdir(parents=True)
            scripts = {
                'bin/dpkg-query': '''for package; do :; done
case "$package" in python) installed=$PYTHON_INSTALLED ;; openssl-tool) installed=$OPENSSL_INSTALLED ;; *) installed=$LIBRARY_INSTALLED ;; esac
if [ "$installed" = yes ]; then printf 'install ok installed'; else exit 1; fi
''',
                'bin/apt-get': '''printf 'apt %s\\n' "$*" >> "$LOG"
if [ "$1" = -s ]; then printf '%s\\n' "$APT_PLAN"; fi
''',
            }
            if python:
                scripts['prefix/bin/python'] = '''printf 'probe %s\\n' "$2" >> "$LOG"
[ "$PROBE_OK" = yes ]
'''
            if openssl:
                scripts['prefix/bin/openssl'] = 'exit 0\n'
            for name, content in scripts.items():
                path = root / name
                path.write_text('#!/bin/sh\n' + content, encoding='utf-8', newline='\n')
                path.chmod(0o700)
            command = '''set -eu
cd "$1"
PREFIX="$(pwd)/prefix"
setup_tmp="$(pwd)/scratch"
LOG="$(pwd)/log"
PATH="$(pwd)/bin:$PATH"
export PREFIX LOG PATH
''' + dependency_setup()
            environment = {**os.environ, 'PYTHON_INSTALLED': 'yes' if python else 'no',
                           'OPENSSL_INSTALLED': 'yes' if openssl else 'no', 'PROBE_OK': 'yes' if probe_ok else 'no',
                           'APT_PLAN': plan, 'LIBRARY_INSTALLED': 'yes' if library else 'no'}
            result = subprocess.run([shutil.which('bash'), '-c', command, 'setup-test', root.as_posix()], env=environment, capture_output=True, text=True, timeout=15)
            log = (root / 'log').read_text() if (root / 'log').exists() else ''
            return result, log

    def test_capable_installed_packages_are_checked_without_apt_or_version_queries(self):
        result, log = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.splitlines(), ['probe --check-python', 'probe --check-runtime'])

    def test_incapable_installed_python_stops_before_fetching_or_replacing_packages(self):
        result, log = self.run_setup(openssl=False, probe_ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log.splitlines(), ['probe --check-python'])

    def test_only_missing_names_are_installed_after_an_additive_plan(self):
        result, log = self.run_setup(python=False, plan='Inst python (3.14.10 official)')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('apt -y --no-remove --no-upgrade -o Dpkg::Options::=--force-confold install python\n', log)
        self.assertNotIn('install python=', log)
        self.assertNotIn('install python openssl-tool', log)

    def test_dependency_upgrade_plan_is_refused_before_package_installation(self):
        result, log = self.run_setup(python=False, plan='Inst libopenssl [3.4.1] (3.6.5 official)', library=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Changing installed libopenssl', result.stderr)
        self.assertNotIn('apt -y', log)


if __name__ == '__main__':
    unittest.main()
