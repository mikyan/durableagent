"""Installer payload. Only our manifest-owned scripts may be replaced.

The public install(home, scripts) boundary is also exercised in isolated Termux
directories; the generated command always uses the fixed production HOME.
"""
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile

try:
    import fcntl
except ImportError:
    fcntl = None


class SetupFault(Exception):
    pass


BASE_NAMES = {'durable_executor.py', 'execution_transport.py'}
NAMES = BASE_NAMES | {'file_service.py'}
MANIFEST = 'installation.json'


# Run the packaged implementation in a disposable child, never against the user's
# ledger or pairing. Subreaper state and all generated TLS material die with it.
RUNTIME_PROBE = r'''
import base64, hashlib, io, os, sqlite3, ssl, sys
from pathlib import Path
phase = 'PYTHON_IMPORTS'
try:
    root = Path(sys.argv[1])
    sys.path.insert(0, str(root))
    import durable_executor as executor
    import execution_transport as transport
    import fcntl
    phase = 'PYTHON_FILE_APIS'
    assert hashlib.file_digest(io.BytesIO(b'probe'), 'sha256').hexdigest() == hashlib.sha256(b'probe').hexdigest()
    assert os.waitstatus_to_exitcode(0) == 0
    assert os.path.realpath(root, strict=True) == str(root.resolve())
    root.stat(follow_symlinks=False)
    parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open('probe-file', os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        other = os.open('probe-file', os.O_RDWR | os.O_NOFOLLOW, dir_fd=parent)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise RuntimeError('file lock not exclusive')
            os.write(fd, b'probe'); os.fsync(fd)
            os.rename('probe-file', 'probe-renamed', src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
        finally:
            os.close(other); os.close(fd)
    finally:
        os.close(parent)
    read_fd, write_fd = os.pipe()
    try:
        os.set_blocking(read_fd, False)
        os.write(write_fd, b'p'); assert os.read(read_fd, 1) == b'p'
    finally:
        os.close(read_fd); os.close(write_fd)
    phase = 'SQLITE_LEDGER'
    endpoint = executor.Executor(root / 'executor')
    try:
        db = endpoint.db
        assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        assert db.execute('PRAGMA synchronous').fetchone()[0] == 2
        assert db.execute("SELECT json_extract('{\"v\":7}', '$.v')").fetchone()[0] == 7
        db.execute('CREATE TABLE capability_probe(value INTEGER) STRICT')
        db.commit()
        db.execute('BEGIN IMMEDIATE')
        db.execute('INSERT INTO capability_probe VALUES (7)')
        db.rollback()
        assert db.execute('SELECT COUNT(*) FROM capability_probe').fetchone()[0] == 0
        try:
            db.execute("INSERT INTO capability_probe VALUES ('invalid')")
        except sqlite3.IntegrityError:
            db.rollback()
        else:
            raise RuntimeError('STRICT unavailable')
    finally:
        endpoint.close()
    endpoint = executor.Executor(root / 'executor', existing=True)
    endpoint.close()
    phase = 'PROCESS_SCOPE'
    scope = executor.ProcessScope()
    pidfd = scope.open_pidfd(os.getpid())
    try:
        scope.send(pidfd, 0)
    finally:
        os.close(pidfd); scope.close()
    phase = 'PYTHON_TLS'
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    if sys.argv[2] == 'full':
        phase = 'OPENSSL_CERTIFICATE'
        client = root / 'probe-client.pem'
        transport._openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=DurableAgent capability probe', '-keyout', str(root / 'probe-client-key.pem'), '-out', str(client))
        # bootstrap exercises the exact production req/addext, x509 and pkey argv.
        identity = {'protocol': 1, 'executorId': 'probe', 'ledgerEpoch': 'probe'}
        transport.bootstrap(root, base64.b64encode(client.read_bytes()).decode('ascii'), 'probe', identity)
        context.load_cert_chain(str(root / 'transport/server-cert.pem'), str(root / 'transport/server-key.pem'))
        context.load_verify_locations(cafile=str(client))
except Exception:
    print('RUNTIME_CAPABILITY_UNSUPPORTED:' + phase, file=sys.stderr)
    sys.exit(1)
'''


def check_runtime(scripts, include_openssl=True, timeout=45):
    """Capability check shared by existing-package preflight and final installation."""
    if set(scripts) != NAMES:
        raise SetupFault('INVALID_PAYLOAD')
    if not 0 < timeout <= 45:
        raise SetupFault('INVALID_PROBE_TIMEOUT')
    with tempfile.TemporaryDirectory(prefix='durableagent-capability-') as folder:
        root = Path(folder)
        for name, data in scripts.items():
            (root / name).write_bytes(data)
        try:
            process = subprocess.Popen([sys.executable, '-I', '-c', RUNTIME_PROBE, str(root), 'full' if include_openssl else 'python'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=os.name == 'posix')
            try:
                _, stderr = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Only the fresh probe session, including any owned OpenSSL child.
                # The leader has not been reaped, so its numeric ID cannot be reused.
                try:
                    if os.name == 'posix':
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                except ProcessLookupError:
                    pass
                process.communicate()
                raise
        except (OSError, subprocess.SubprocessError):
            raise SetupFault('RUNTIME_CAPABILITY_UNSUPPORTED:PROBE_UNAVAILABLE; existing environment preserved') from None
        if process.returncode:
            reason = stderr.decode('utf-8', 'replace').strip().splitlines()
            code = reason[-1] if reason and re.fullmatch(r'RUNTIME_CAPABILITY_UNSUPPORTED:[A-Z_]+', reason[-1]) else 'RUNTIME_CAPABILITY_UNSUPPORTED:PYTHON_IMPORTS'
            raise SetupFault(code + '; existing environment preserved; do not reinitialize or downgrade')


def configure(home, scripts):
    check_runtime(scripts)
    return install(home, scripts)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe(path, directory=False):
    if path.is_symlink():
        raise SetupFault('SYMLINK_REFUSED')
    if path.exists():
        info = path.stat()
        if directory and not stat.S_ISDIR(info.st_mode) or not directory and not stat.S_ISREG(info.st_mode):
            raise SetupFault('FILE_TYPE_REFUSED')
        if hasattr(os, 'getuid') and info.st_uid != os.getuid():
            raise SetupFault('FILE_OWNER_REFUSED')


def directory(path):
    safe(path, True)
    path.mkdir(mode=0o700, exist_ok=True)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, data):
    fd, temporary = tempfile.mkstemp(prefix='.setup-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def locks(root):
    if fcntl is None:
        raise SetupFault('TERMUX_REQUIRED')
    opened = []
    try:
        paths = [root / 'installation.lock', root / 'server.lock', root / 'writes.lock']
        owners = root / 'owners'
        safe(owners, True)
        if owners.exists():
            paths.extend(sorted(owners.glob('*.lock')))
        for path in paths:
            safe(path)
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            opened.append(fd)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupFault('EXECUTOR_ACTIVE') from None
        yield
    finally:
        for fd in reversed(opened):
            os.close(fd)


def install(home, scripts):
    names = set(scripts)
    if names not in (BASE_NAMES, NAMES) or any(not isinstance(data, bytes) or not data for data in scripts.values()):
        raise SetupFault('INVALID_PAYLOAD')
    home = Path(home)
    root = home
    for name in ('.local', 'share', 'durableagent-execution'):
        root = root / name
        directory(root)
    props_dir = home / '.termux'
    safe(props_dir, True)
    props = props_dir / 'termux.properties'
    safe(props)
    desired = {name: digest(data) for name, data in scripts.items()}
    with locks(root):
        manifest = root / MANIFEST
        safe(manifest)
        previous = {name: None for name in names}
        if manifest.exists():
            try:
                record = json.loads(manifest.read_text())
                if record['kind'] != 'durableagent-execution-install' or record['protocol'] != 1:
                    raise ValueError()
                if record['state'] == 'installed':
                    previous = record['files']
                elif record['state'] == 'installing' and record['files'] == desired:
                    previous = record['previous']
                else:
                    raise ValueError()
                if set(previous) not in (BASE_NAMES, NAMES) or not set(previous) <= names or any(value is not None and not re.fullmatch('[a-f0-9]{64}', value) for value in previous.values()):
                    raise ValueError()
                previous = {name: previous.get(name) for name in names}
            except (KeyError, ValueError, TypeError):
                raise SetupFault('MANIFEST_UNRECOGNIZED') from None
        else:
            record = None
        for name in names:
            path = root / name
            safe(path)
            actual = digest(path.read_bytes()) if path.exists() else None
            allowed = {previous[name]}
            if record and record['state'] == 'installing':
                allowed.add(desired[name])
            if actual not in allowed:
                raise SetupFault('UNMANAGED_OR_MODIFIED_SCRIPT')
        record = {'kind': 'durableagent-execution-install', 'protocol': 1, 'state': 'installing', 'files': desired, 'previous': previous}
        atomic(manifest, (json.dumps(record, sort_keys=True) + '\n').encode())
        for name, data in scripts.items():
            atomic(root / name, data)
        record.pop('previous')
        record['state'] = 'installed'
        atomic(manifest, (json.dumps(record, sort_keys=True) + '\n').encode())
        directory(props_dir)
        contents = props.read_bytes() if props.exists() else b''
        # A canonical final assignment wins over earlier Java-properties forms.
        # A blank line breaks an earlier continued property without deleting it.
        suffix = b'\n\nallow-external-apps=true\n'
        if not contents.endswith(suffix):
            backup = root / ('termux.properties.before-setup-' + digest(contents) + '.bak')
            safe(backup)
            if backup.exists() and backup.read_bytes() != contents:
                raise SetupFault('BACKUP_CONFLICT')
            if not backup.exists():
                atomic(backup, contents)
            atomic(props, contents + suffix)
    return {'installed': True, 'files': desired}


def main(scripts):
    prefix = '/data/data/com.termux/files/usr'
    home = '/data/data/com.termux/files/home'
    if os.environ.get('PREFIX') != prefix or os.environ.get('HOME') != home or os.getuid() == 0:
        raise SetupFault('TERMUX_REQUIRED')
    configure(Path(home), scripts)
    subprocess.run([prefix + '/bin/termux-reload-settings'], check=True)
    print('DurableAgent execution v1 configured. Return to the app and connect.')
