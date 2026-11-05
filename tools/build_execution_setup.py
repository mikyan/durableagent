"""Deterministic public setup command; no key material enters the artifact."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import textwrap


def dependency_setup():
    return r'''
missing=''
python_installed=false
openssl_installed=false
for package in python openssl-tool; do
  current=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
  case "$current" in
    "install ok installed")
      if [ "$package" = python ]; then python_installed=true; else openssl_installed=true; fi ;;
    ""|"unknown ok not-installed"|"deinstall ok config-files")
      binary=python; if [ "$package" = openssl-tool ]; then binary=openssl; fi
      if [ -e "$PREFIX/bin/$binary" ]; then
        printf '%s\n' "Unmanaged $binary exists. Existing environment preserved; setup stopped." >&2; exit 1
      fi
      missing="$missing $package" ;;
    *) printf '%s\n' "Package $package is not fully configured. Existing environment preserved; setup stopped." >&2; exit 1 ;;
  esac
done
if "$python_installed"; then
  "$PREFIX/bin/python" "$setup_tmp/install.py" --check-python
  if "$openssl_installed"; then "$PREFIX/bin/python" "$setup_tmp/install.py" --check-runtime; fi
fi
if [ -n "$missing" ]; then
  apt-get update
  # Only these fixed missing package names; never replace an installed dependency.
  LC_ALL=C apt-get -s --no-remove --no-upgrade install $missing > "$setup_tmp/apt-plan"
  while read -r action package rest; do
    if [ "$action" = Remv ]; then
      printf '%s\n' 'Dependency removal required. Existing environment preserved; setup stopped.' >&2; exit 1
    fi
    if [ "$action" = Inst ]; then
      current=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
      if [ "$current" = 'install ok installed' ]; then
        printf '%s\n' "Changing installed $package would be required. Existing environment preserved; setup stopped." >&2; exit 1
      fi
    fi
  done < "$setup_tmp/apt-plan"
  apt-get -y --no-remove --no-upgrade -o Dpkg::Options::=--force-confold install $missing
fi
'''


def build(repo):
    repo = Path(repo)
    source = (repo / 'tools/execution_setup_installer.py').read_text(encoding='utf-8')
    scripts = ',\n'.join(repr(name) + ': base64.b64decode(' + repr(base64.b64encode((repo / 'managed-execution' / name).read_bytes()).decode()) + ')' for name in ('durable_executor.py', 'execution_transport.py', 'file_service.py'))
    source += '\nscripts = {' + scripts + "}\ntry:\n    if sys.argv[1:] == ['--check-python']:\n        check_runtime(scripts, include_openssl=False)\n    elif sys.argv[1:] == ['--check-runtime']:\n        check_runtime(scripts)\n    elif not sys.argv[1:]:\n        main(scripts)\n    else:\n        raise SetupFault('INVALID_ARGUMENT')\nexcept SetupFault as error:\n    raise SystemExit('DurableAgent setup refused: ' + str(error))\n"
    packed = gzip.compress(source.encode(), mtime=0)
    expected = hashlib.sha256(packed).hexdigest()
    encoded = '\n'.join(textwrap.wrap(base64.b64encode(packed).decode(), 100))
    return """(
set -eu
umask 077
if [ "${PREFIX:-}" != /data/data/com.termux/files/usr ] || [ "${HOME:-}" != /data/data/com.termux/files/home ] || [ "$(id -u)" = 0 ]; then
  printf '%s\\n' 'Run this command in the official Termux app.' >&2; exit 1
fi
PATH="$PREFIX/bin:$PATH"
export PATH
setup_tmp=$(mktemp -d "$TMPDIR/durableagent-setup.XXXXXXXX")
trap 'rm -f -- "$setup_tmp/payload.gz" "$setup_tmp/install.py" "$setup_tmp/apt-plan"; rmdir -- "$setup_tmp"' EXIT
base64 -d > "$setup_tmp/payload.gz" <<'DURABLE_EXECUTION_PAYLOAD'
""" + encoded + """
DURABLE_EXECUTION_PAYLOAD
printf '%s  %s\\n' '""" + expected + """' "$setup_tmp/payload.gz" | sha256sum -c -
gzip -dc "$setup_tmp/payload.gz" > "$setup_tmp/install.py"
""" + dependency_setup() + """
"$PREFIX/bin/python" "$setup_tmp/install.py"
)
"""


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--capabilities-output', type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build(args.repo), encoding='utf-8', newline='\n')
    if args.capabilities_output:
        proof = {'version': 1, 'runnerSha256': hashlib.sha256((args.repo / 'managed-execution/durable_executor.py').read_bytes()).hexdigest(), 'helperSha256': hashlib.sha256((args.repo / 'managed-execution/file_service.py').read_bytes()).hexdigest()}
        args.capabilities_output.parent.mkdir(parents=True, exist_ok=True)
        args.capabilities_output.write_text(json.dumps(proof, sort_keys=True) + '\n', encoding='utf-8', newline='\n')
