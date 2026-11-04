"""Deterministic public setup command; no key material enters the artifact."""
import argparse
import base64
import gzip
import hashlib
from pathlib import Path
import textwrap


def build(repo):
    repo = Path(repo)
    source = (repo / 'tools/execution_setup_installer.py').read_text(encoding='utf-8')
    scripts = ',\n'.join(repr(name) + ': base64.b64decode(' + repr(base64.b64encode((repo / 'managed-execution' / name).read_bytes()).decode()) + ')' for name in ('durable_executor.py', 'execution_transport.py'))
    source += '\ntry:\n    main({' + scripts + "})\nexcept SetupFault as error:\n    raise SystemExit('DurableAgent setup refused: ' + str(error))\n"
    packed = gzip.compress(source.encode(), mtime=0)
    expected = hashlib.sha256(packed).hexdigest()
    encoded = '\n'.join(textwrap.wrap(base64.b64encode(packed).decode(), 100))
    return """(
set -eu
umask 077
if [ "${PREFIX:-}" != /data/data/com.termux/files/usr ] || [ "${HOME:-}" != /data/data/com.termux/files/home ] || [ "$(id -u)" = 0 ]; then
  printf '%s\\n' 'Run this command in the official Termux app.' >&2; exit 1
fi
# Existing different versions are preserved, never silently downgraded.
missing=''
for pinned in python=3.14.8 openssl-tool=1:3.6.5; do
  package=${pinned%%=*}; expected_version=${pinned#*=}
  current=$(dpkg-query -W -f='${Status} ${Version}' "$package" 2>/dev/null || true)
  case "$current" in
    "install ok installed $expected_version") ;;
    "install ok installed "*) printf '%s\\n' "Preserving installed $package: expected $expected_version. Setup stopped." >&2; exit 1 ;;
    *) missing="$missing $pinned" ;;
  esac
done
if [ -n "$missing" ]; then
  apt-get update
  # Intentional splitting: package/version tokens above are fixed, not user data.
  apt-get -y --no-remove -o Dpkg::Options::=--force-confold install $missing
fi
setup_tmp=$(mktemp -d "$TMPDIR/durableagent-setup.XXXXXXXX")
trap 'rm -f -- "$setup_tmp/payload.gz" "$setup_tmp/install.py"; rmdir -- "$setup_tmp"' EXIT
base64 -d > "$setup_tmp/payload.gz" <<'DURABLE_EXECUTION_PAYLOAD'
""" + encoded + """
DURABLE_EXECUTION_PAYLOAD
printf '%s  %s\\n' '""" + expected + """' "$setup_tmp/payload.gz" | sha256sum -c -
gzip -dc "$setup_tmp/payload.gz" > "$setup_tmp/install.py"
"$PREFIX/bin/python" "$setup_tmp/install.py"
)
"""


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build(args.repo), encoding='utf-8', newline='\n')
