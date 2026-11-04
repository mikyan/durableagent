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
import stat
import subprocess
import tempfile

try:
    import fcntl
except ImportError:
    fcntl = None


class SetupFault(Exception):
    pass


NAMES = {'durable_executor.py', 'execution_transport.py'}
MANIFEST = 'installation.json'


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
    if set(scripts) != NAMES or any(not isinstance(data, bytes) or not data for data in scripts.values()):
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
        previous = {name: None for name in NAMES}
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
                if set(previous) != NAMES or any(value is not None and not re.fullmatch('[a-f0-9]{64}', value) for value in previous.values()):
                    raise ValueError()
            except (KeyError, ValueError, TypeError):
                raise SetupFault('MANIFEST_UNRECOGNIZED') from None
        else:
            record = None
        for name in NAMES:
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
    install(Path(home), scripts)
    subprocess.run([prefix + '/bin/termux-reload-settings'], check=True)
    print('DurableAgent execution v1 configured. Return to the app and connect.')
