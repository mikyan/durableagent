import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOwnedStorage,auditStorageSecret} from '../dist/storage.js';
import {openNodeSqliteDatabase} from '@earendil-works/chord/sqlite/node';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createStorageChecks} from '../dist/storage-checks.js';
import {RuntimeProbe} from '../dist/probe.js';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {crashPhases,recoverCrash} from '../dist/storage-crash.js';

const suiteDir=await mkdtemp(join(tmpdir(),'durable-contracts-'));
test.after(async()=>rm(suiteDir,{recursive:true,force:true}));
for(const check of createStorageChecks(suiteDir,value=>console.log('storageDiagnostics',JSON.stringify(value))))test(check.name,check.run);
test('credential audit catches a synthetic marker in live WAL before close checkpoints it',async()=>{
  const path=join(suiteDir,'secret-audit.sqlite'),secret='SYNTHETIC-NOT-A-REAL-CREDENTIAL-123';
  const db=await openNodeSqliteDatabase(path,{walAutoCheckpointPages:0});
  try {
    await db.exec('CREATE TABLE audit(value TEXT)');await db.run('INSERT INTO audit VALUES(?)',secret);
    assert.ok((await readFile(path+'-wal')).includes(Buffer.from(secret)));
    await assert.rejects(auditStorageSecret(path,secret),/audit failed/);
  }finally{await db.close();}
  await assert.rejects(auditStorageSecret(path,secret),/audit failed/);
  const owned=await openOwnedStorage(join(suiteDir,'guard.sqlite'),secret);
  try {await assert.rejects(owned.storage.commit([[{type:'conversation',value:{id:1,extra:secret}}]],()=>{},context),/persistence blocked/);}finally{await owned.storage.close(context);}
  assert.deepEqual(await auditStorageSecret(join(suiteDir,'guard.sqlite'),secret),['db']);
});
for(const phase of crashPhases)test(`process termination at ${phase} inspects the same stable records on reopen`,{timeout:15000},async()=>{
  const child=fork(new URL('./fixtures/crash-host.mjs',import.meta.url),[join(suiteDir,'crash'),phase],{stdio:['ignore','ignore','pipe','ipc']});
  try {
    const [ready]=await once(child,'message');assert.equal(ready.status,'crash-ready',ready.error);
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    const recovered=await recoverCrash(join(suiteDir,'crash'),phase);assert.equal(recovered.status,'recovered');
  }finally{if(child.exitCode===null)child.kill('SIGKILL');}
});

test('real SDK conversation reopens its same persisted transcript without another model request',async()=>{
  const storagePath=join(suiteDir,'conversation.sqlite');
  let probe=new RuntimeProbe({storagePath});
  await probe.start();await probe.send('persistent hello');
  const saved=probe.snapshot();await probe.close();
  probe=new RuntimeProbe({storagePath});await probe.start();
  try {assert.equal(probe.snapshot().text,'你好🌍');assert.equal(probe.snapshot().entryCount,saved.entryCount);assert.ok(saved.entryCount>=2);assert.equal(probe.snapshot().transportRequests,0);assert.equal(probe.snapshot().storage.synchronous,2);}finally{await probe.close();}
});

test('one canonical domain admits one owner until real storage close, then reopens durable records', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'durable-storage-'));
  try {
    const path=join(dir,'domain.sqlite');
    const attempts=await Promise.allSettled([openOwnedStorage(path),openOwnedStorage(path)]);
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
    const {storage,configuration}=attempts.find(x=>x.status==='fulfilled').value;
    assert.equal(configuration.journalMode,'wal');assert.equal(configuration.synchronous,2);
    await storage.commit([[{type:'conversation',value:{id:1}}]],()=>{},context);
    await assert.rejects(openOwnedStorage(join(dir,'.','domain.sqlite')),/owned/);
    await storage.close(context);
    const reopened=await openOwnedStorage(path);
    assert.deepEqual(await reopened.storage.conversation(1,context),{id:1});
    await reopened.storage.close(context);
  } finally {await rm(dir,{recursive:true,force:true});}
});
