#!/data/data/com.termux/files/usr/bin/bash
set -eu
python - <<'PY'
from pathlib import Path
import hashlib,json
root=Path.home()/'.local/share/durableagent-execution/workspace/.durableagent-t10-ba1a5cb4-544e-4e3f-8a16-20558aa14ca1'
p=root/'change.txt'
assert not p.is_symlink() and p.resolve().is_relative_to(root.resolve())
b=p.read_bytes()
assert b=='真实修改-after\n'.encode('utf-8')
print(json.dumps({'scope':'independent normal Termux read of actual T15 diff source','run':'ba1a5cb4-544e-4e3f-8a16-20558aa14ca1','path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'text':b.decode(),'inode':p.stat().st_ino},ensure_ascii=False))
PY
