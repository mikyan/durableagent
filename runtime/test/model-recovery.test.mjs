import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditStorageSecret} from '../dist/storage.js';

const secrets={a:'synthetic-recovery-key-A-001',b:'synthetic-recovery-key-B-002',rotated:'synthetic-recovery-key-A-rotated-003'};
const bounded=(promise,label,ms=12000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]).finally(()=>clearTimeout(timer));};
const until=async(fn,label)=>{const end=Date.now()+12000;while(!await fn()){assert.ok(Date.now()<end,label);await new Promise(resolve=>setTimeout(resolve,10));}};

class Worker {
  constructor(){
    this.nextId=0;this.pending=new Map();this.output='';
    this.child=fork(new URL('./fixtures/model-recovery-worker.mjs',import.meta.url),[],{stdio:['ignore','pipe','pipe','ipc']});
    this.pid=this.child.pid;
    this.child.stdout.on('data',data=>{this.output+=data;});this.child.stderr.on('data',data=>{this.output+=data;});
    this.child.on('message',message=>{const pending=this.pending.get(message.id);if(pending){this.pending.delete(message.id);message.ok?pending.resolve(message.value):pending.reject(Object.assign(Error(message.error.message),{code:message.error.code}));}});
    this.exited=new Promise(resolve=>this.child.once('exit',(code,signal)=>{this.exit={code,signal};for(const pending of this.pending.values())pending.reject(Error(`Worker exited: ${code}/${signal}: ${this.output}`));this.pending.clear();resolve(this.exit);}));
  }
  call(op,payload={}){const id=++this.nextId;return bounded(new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.child.send({id,op,payload});}),`Worker ${op} timeout: ${this.output}`);}
  request(method,payload={}){return this.call('request',{method,payload});}
  async close(){if(this.exit)return;await this.call('close');await bounded(this.exited,'Orderly worker exit');}
  async kill(){if(this.exit)return this.exit;this.child.kill('SIGKILL');return bounded(this.exited,'Forced worker exit');}
}

async function fixture(options={}){
  const directory=await mkdtemp(join(tmpdir(),'model-recovery-')),path=join(directory,'app.sqlite');
  const entries=[],waiters=[];let worker;let policy=()=>{};
  const server=createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),entry={seq:entries.length+1,url:req.url,phase:body.phase,handle:body.handle??null,provider:body.provider,model:body.model,authorization:req.headers.authorization,body,res};
    entries.push(entry);for(const notify of [...waiters])notify();policy(entry);
  }catch(error){res.writeHead(500);res.end(JSON.stringify({message:String(error)}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const reply=(entry,value={text:`reply-${entry.provider}`},status=200)=>{if(entry.res.destroyed)return;entry.res.writeHead(status,{'content-type':'application/json'});entry.res.end(JSON.stringify(value));};
  const next=predicate=>bounded(new Promise(resolve=>{const notify=()=>{const entry=entries.find(predicate);if(entry){const index=waiters.indexOf(notify);if(index>=0)waiters.splice(index,1);resolve(entry);}};waiters.push(notify);notify();}),'Transport entry barrier');
  const open=async(extra={})=>{worker=new Worker();await worker.call('open',{path,endpoint,mode:options.mode??'application',deferred:options.deferred??false,keys:{'connection-a':{key:secrets.a,generation:1},'connection-b':{key:secrets.b,generation:1}},...extra});return worker;};
  const setup=async()=>{
    for(const [index,id]of ['connection-a','connection-b'].entries())await worker.request('models.create',{creationId:id,expectedVersion:index,name:id,protocol:'openai-compatible',endpoint:`${endpoint}/${index?'b':'a'}`,modelId:'probe-model'});
    await worker.request('models.setDefault',{expectedVersion:2,selection:{provider:'connection-a',modelId:'probe-model'}});
    await worker.request('create',{creationId:'chat'});
  };
  const audit=async()=>{for(const value of Object.values(secrets)){const scanned=await auditStorageSecret(path,value);assert.ok(scanned.includes('db'));if(!worker?.exit)assert.ok(scanned.includes('wal'),'Audit must include live WAL before close');}};
  const clean=async()=>{await worker?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});};
  return {directory,path,endpoint,entries,reply,next,open,setup,audit,clean,get worker(){return worker;},set policy(value){policy=value;}};
}

test('ordinary generation retry prepares the current model and request-time credential',async()=>{
  const f=await fixture();
  try{
    await f.open();await f.setup();await f.worker.request('send',{id:'chat',text:'one durable input',actionId:'original'});
    const first=await f.next(entry=>entry.seq===1);assert.equal(first.provider,'connection-a');assert.equal(first.authorization,`Bearer ${secrets.a}`);
    f.reply(first,{message:'503 service unavailable'},503);
    await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='waiting','Expected durable retry wait');
    await f.worker.request('models.select',{id:'chat',selection:{provider:'connection-b',modelId:'probe-model'}});
    const second=await f.next(entry=>entry.seq===2);assert.equal(second.provider,'connection-b');assert.equal(second.authorization,`Bearer ${secrets.b}`);
    await f.audit();f.reply(second);
    await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='done','Retry completion');
    const history=await f.worker.request('history',{id:'chat'});assert.equal(history.items.filter(item=>item.role==='user').length,1);
    assert.equal(f.entries.length,2);await f.worker.close();await f.audit();
  }finally{await f.clean();}
});

for(const interruption of ['close','kill'])test(`${interruption}: held generation resumes its fixed or newly prepared route with one durable input`,async()=>{
  const f=await fixture();
  try{
    await f.open();await f.setup();await f.worker.request('send',{id:'chat',text:'input retained across interruption',actionId:'original'});
    const first=await f.next(entry=>entry.seq===1);assert.equal(first.provider,'connection-a');
    const original=(await f.worker.request('history',{id:'chat'})).items.filter(item=>item.role==='user');assert.equal(original.length,1);
    await f.worker.request('models.select',{id:'chat',selection:{provider:'connection-b',modelId:'probe-model'}});
    await f.audit();const oldPid=f.worker.pid;
    if(interruption==='close')await f.worker.close();else{const exit=await f.worker.kill();assert.ok(exit.signal||exit.code!==0,'Forced termination must not be normal shutdown');}
    await f.open({keys:{'connection-a':{key:secrets.rotated,generation:2},'connection-b':{key:secrets.b,generation:1}}});
    assert.notEqual(f.worker.pid,oldPid);
    const resumed=await f.next(entry=>entry.seq===2);
    assert.equal(resumed.provider,interruption==='close'?'connection-a':'connection-b');
    assert.equal(resumed.authorization,`Bearer ${interruption==='close'?secrets.rotated:secrets.b}`);
    assert.equal((await f.worker.request('open',{id:'chat'})).conversation.model.provider,'connection-b');
    assert.deepEqual((await f.worker.request('history',{id:'chat'})).items.filter(item=>item.role==='user'),original);
    await f.audit();f.reply(resumed);
    await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='done','Resumed generation completion');
    assert.equal(f.entries.length,2);await f.worker.close();await f.audit();
  }finally{await f.clean();}
});

for(const change of ['unchanged','rotated','disabled'])test(`deferred poll process death: ${change} keeps the original handle or fails without a replacement start`,async()=>{
  const f=await fixture({deferred:true});
  try{
    await f.open();await f.setup();await f.worker.request('send',{id:'chat',text:'one deferred input',actionId:'original'});
    const start=await f.next(entry=>entry.seq===1);assert.equal(start.phase,'generation');
    f.reply(start,{deferred:true,id:'stable-H',pollAfterMs:80});
    const poll=await f.next(entry=>entry.seq===2);assert.equal(poll.phase,'poll');assert.equal(poll.handle,'stable-H');
    const original=(await f.worker.request('history',{id:'chat'})).items.filter(item=>item.role==='user');
    await f.worker.request('models.select',{id:'chat',selection:{provider:'connection-b',modelId:'probe-model'}});
    if(change==='disabled')await f.worker.request('models.setEnabled',{expectedVersion:3,id:'connection-a',enabled:false});
    await f.audit();const oldPid=f.worker.pid;await f.worker.kill();
    await f.open({keys:{'connection-a':{key:change==='rotated'?secrets.rotated:secrets.a,generation:change==='rotated'?2:1},'connection-b':{key:secrets.b,generation:1}}});
    assert.notEqual(f.worker.pid,oldPid);
    if(change==='unchanged'){
      const resumed=await f.next(entry=>entry.seq===3);assert.equal(resumed.phase,'poll');assert.equal(resumed.provider,'connection-a');assert.equal(resumed.handle,'stable-H');
      assert.equal(resumed.authorization,`Bearer ${secrets.a}`);f.reply(resumed,{text:'original handle result'});
      await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='done','Deferred completion');
    }else{
      await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='failed','Explicit deferred recovery failure');
      const snapshot=await f.worker.request('open',{id:'chat'});
      assert.match(snapshot.reason,change==='rotated'?/旧响应凭据兼容性未确认/:/旧连接已停用/);
      // Deliberate observation window: longer than the enabled retry backoff; not a prepare guess.
      await new Promise(resolve=>setTimeout(resolve,1400));assert.equal(f.entries.length,2);
    }
    assert.equal(f.entries.filter(entry=>entry.phase==='generation').length,1);
    assert.deepEqual((await f.worker.request('history',{id:'chat'})).items.filter(item=>item.role==='user'),original);
    assert.equal((await f.worker.request('open',{id:'chat'})).conversation.model.provider,'connection-b');
    await f.audit();await f.worker.close();await f.audit();
  }finally{await f.clean();}
});

test('selected compaction retries and orderly resumes its selected model after current selection changes',async()=>{
  const f=await fixture({mode:'harness'});
  try{
    f.policy=entry=>{if(entry.phase==='generation')f.reply(entry,{text:'A substantive previous answer '.repeat(20)});};
    await f.open();
    for(let index=0;index<4;index++)await f.worker.call('h.submit',{text:`Original turn ${index}: `+'retained context words '.repeat(40),id:`seed-${index}`});
    const before=await f.worker.call('h.entries');assert.equal(before.items.filter(entry=>entry.kind==='pi.user').length,4);
    const compact=await f.worker.call('h.compact');
    const first=await f.next(entry=>entry.phase==='compaction');assert.equal(first.provider,'connection-a');
    await f.worker.call('h.select',{provider:'connection-b'});await f.audit();
    f.reply(first,{message:'503 service unavailable'},503);
    const retry=await f.next(entry=>entry.phase==='compaction'&&entry.seq>first.seq);assert.equal(retry.provider,'connection-a');
    await f.audit();const oldPid=f.worker.pid;await f.worker.close();await f.open();assert.notEqual(f.worker.pid,oldPid);
    const resumed=await f.next(entry=>entry.phase==='compaction'&&entry.seq>retry.seq);assert.equal(resumed.provider,'connection-a');
    assert.equal((await f.worker.call('h.agent')).model.provider,'connection-b');
    await f.audit();f.reply(resumed,{text:'T05 actual retained compaction summary'});
    const settled=await f.worker.call('h.wait',{taskId:compact.taskId});assert.equal(settled.state.status,'terminal');assert.equal(settled.state.outcome.status,'completed');
    const after=await f.worker.call('h.entries');
    assert.deepEqual(after.items.filter(entry=>entry.kind==='pi.user').map(entry=>entry.id),before.items.filter(entry=>entry.kind==='pi.user').map(entry=>entry.id));
    assert.ok(JSON.stringify(after).includes('T05 actual retained compaction summary'));
    assert.equal(f.entries.filter(entry=>entry.phase==='compaction').length,3);
    assert.ok(f.entries.filter(entry=>entry.phase==='compaction').every(entry=>entry.authorization===`Bearer ${secrets.a}`));
    await f.worker.close();await f.audit();
  }finally{await f.clean();}
});

test('overdue work remains behind the configuration loading gate on reopen',async()=>{
  const f=await fixture();
  try{
    await f.open();await f.setup();await f.worker.request('send',{id:'chat',text:'gated durable retry',actionId:'original'});
    const first=await f.next(entry=>entry.seq===1);f.reply(first,{message:'503 service unavailable'},503);
    await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='waiting','Retry persisted');
    await f.worker.close();await new Promise(resolve=>setTimeout(resolve,1400));
    const opening=f.open({gated:true});void opening.catch(()=>{});
    await until(async()=>(await f.worker.call('status'))?.phase==='configuring','Loading barrier entered');
    await new Promise(resolve=>setTimeout(resolve,250));assert.equal(f.entries.length,1);
    await f.worker.call('releaseConfiguration');await opening;
    const resumed=await f.next(entry=>entry.seq===2);assert.equal(resumed.provider,'connection-a');await f.audit();f.reply(resumed);
    await until(async()=>(await f.worker.request('open',{id:'chat'})).phase==='done','Released retry completed');
    assert.equal((await f.worker.request('history',{id:'chat'})).items.filter(item=>item.role==='user').length,1);
    await f.worker.close();await f.audit();
  }finally{await f.clean();}
});

test('secret persistence detector has a positive control before relying on clean DB and WAL scans',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'model-audit-positive-')),path=join(directory,'positive.sqlite');
  try{await writeFile(path,Buffer.from(`positive control ${secrets.a}`,'utf8'));await assert.rejects(auditStorageSecret(path,secrets.a),/Credential persistence audit failed/);}
  finally{await rm(directory,{recursive:true,force:true});}
});
