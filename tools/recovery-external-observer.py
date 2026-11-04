"""Root-only external observation; never starts an Android application component.

Reads only the dedicated native recovery DB after :agent has exited, with two
identical copies, absent journal/WAL, SQLite integrity check and read-only access.
No credential, SDK database, instrumentation, service or broadcast is opened.
"""
import argparse,hashlib,json,os,re,sqlite3,subprocess,time
from datetime import datetime,timezone
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('serial');parser.add_argument('prepared');parser.add_argument('output')
parser.add_argument('--wait',type=int,default=120)
parser.add_argument('--require-locked',action='store_true')
parser.add_argument('--stopped-interval',action='store_true',help='Require stopped=true, no agent and no completion throughout the interval; never activate the app.')
args=parser.parse_args();assert 1<=args.wait<=600
prepared=json.loads(Path(args.prepared).read_text(encoding='utf-8-sig'));product=prepared['product'];assert prepared['prepared'] and re.fullmatch(r'[-A-Za-z0-9_]{1,128}',product)
destination=Path(args.output);destination.mkdir(parents=True,exist_ok=False)
adb=Path(os.environ.get('ADB',str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')))
package='dev.durableagent.probe';database='no_backup/recovery-input-v1/recovery.sqlite'
def now():return datetime.now(timezone.utc).isoformat()
def call(*command,check=True):
 return subprocess.run([str(adb),'-s',args.serial,*command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=check,timeout=30)
def text(*command):return call(*command).stdout.decode('utf-8','replace')
def agent():
 result=call('shell','pidof',package+':agent',check=False)
 assert result.returncode in (0,1), 'ADB observation failed'
 return result.stdout.decode().strip()
def journals_absent():
 command='test ! -e '+database+'-journal && test ! -e '+database+'-wal && test ! -e '+database+'-shm'
 return call('shell','run-as',package,'sh','-c',"'"+command+"'",check=False).returncode==0
def capture_state():
 package_dump=text('shell','dumpsys','package',package)
 user_line=next((line.strip() for line in package_dump.splitlines() if re.search(r'User 0:',line)),None)
 assert user_line and re.search(r'\bstopped=(true|false)\b',user_line), 'Actual package stopped state not recognized'
 trust=text('shell','dumpsys','trust')
 locked=bool(re.search(r'\bdeviceLocked=true\b',trust))
 # Keep raw system evidence for root to verify current user and keyguard scope.
 return {'at':now(),'agentPid':agent(),'packageUserState':user_line,'stopped':'stopped=true' in user_line,'lockedDetected':locked},trust
def stable_snapshot(index):
 if agent() or not journals_absent():return None
 first=call('exec-out','run-as',package,'cat',database,check=False)
 if first.returncode!=0:return None
 if not journals_absent() or agent():return None
 time.sleep(.1)
 second=call('exec-out','run-as',package,'cat',database,check=False)
 if second.returncode!=0 or second.stdout!=first.stdout or not journals_absent() or agent():return None
 assert first.stdout.startswith(b'SQLite format 3\x00'),'Unexpected native recovery database format'
 path=destination/f'recovery-{index}.sqlite';path.write_bytes(first.stdout)
 connection=sqlite3.connect(path.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
 try:
  assert connection.execute('PRAGMA integrity_check').fetchall()==[('ok',)],'Copied native DB failed integrity check'
  row=connection.execute("SELECT data FROM metadata WHERE key='projection'").fetchone()
  projection=json.loads(row[0]) if row else {}
  completion=next((item for item in projection.get('completions',[]) if item.get('conversationId')==product),None)
  outbox=connection.execute('SELECT identity,published FROM completions WHERE conversation_id=?',(product,)).fetchall()
  conversation=next((item for item in projection.get('conversations',[]) if item.get('id')==product),None)
  if completion:
   assert conversation and conversation.get('phase')=='done','Completion projection must agree with settled product state'
   assert any(identity==completion['identity'] for identity,_ in outbox),'Matching durable native outbox row is required'
  return {'sha256':hashlib.sha256(first.stdout).hexdigest(),'bytes':len(first.stdout),'file':path.name,'journalAbsent':True,'identicalCopies':2,'integrity':'ok','readOnly':True,'completion':completion,'outbox':[{'identity':identity,'delivery':published} for identity,published in outbox],'conversation':conversation}
 finally:connection.close()
report={'product':product,'run':prepared['run'],'startedAt':now(),'observerStartedTarget':False,'instrumentationUsed':False,'sdkOpened':False,'credentialsResolved':False,'stoppedInterval':args.stopped_interval,'observations':[],'completed':False}
end=time.monotonic()+args.wait;index=0
try:
 while True:
  state,trust=capture_state();index+=1
  if args.require_locked:assert state['lockedDetected'],'Actual dumpsys trust did not establish locked state; root must inspect device evidence'
  if args.stopped_interval:assert state['stopped'] and not state['agentPid'],'Force-stop interval lost stopped state or acquired an agent process'
  snapshot=stable_snapshot(index) if not state['agentPid'] else None
  state['nativeSnapshot']=snapshot;report['observations'].append(state)
  if snapshot and snapshot['completion']:
   assert not args.stopped_interval,'Original offline work completed during force-stop interval'
   # Capture system records without executing any PendingIntent. A full notification
   # matching the original product is corroboration; the native DB proves completion.
   (destination/'notification.txt').write_text(text('shell','dumpsys','notification','--noredact'),encoding='utf-8')
   (destination/'pending-intents.txt').write_text(text('shell','dumpsys','activity','intents'),encoding='utf-8')
   (destination/'trust.txt').write_text(trust,encoding='utf-8')
   (destination/'users.txt').write_text(text('shell','dumpsys','user'),encoding='utf-8')
   report.update(completed=True,observedAt=now(),nativeSnapshot=snapshot,ownerAbsentBeforeAndAfterCopy=True)
   break
  if time.monotonic()>=end:
   if args.stopped_interval:
    report.update(stoppedIntervalPassed=True,observedAt=now());(destination/'trust.txt').write_text(trust,encoding='utf-8')
    break
   raise TimeoutError('No stable original durable completion observed before deadline; do not open app to turn this into an automatic recovery pass')
  time.sleep(min(2,max(0,end-time.monotonic())))
except Exception as error:
 report['error']=str(error)
 raise
finally:
 (destination/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'product':product,'completed':report['completed'],'stoppedIntervalPassed':report.get('stoppedIntervalPassed',False),'evidence':str(destination/'result.json')},ensure_ascii=False))
