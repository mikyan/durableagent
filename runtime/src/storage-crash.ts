import assert from 'node:assert/strict';
import {access,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createSession,defineDoc,defineTask,ROOT_CONVERSATION_ID as root,type StorageWrite} from '@earendil-works/pi-durable';
import {SqliteStorage,applySqliteMigrations,SQLITE_MIGRATIONS,type SqliteDatabase,type SqliteExecutor} from '@earendil-works/pi-durable/storage/sqlite';
import {openNodeSqliteDatabase} from '@earendil-works/chord/sqlite/node';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from './storage.js';

export const crashPhases=['before','during','after','confirmed','deferred','migration'] as const;
export type CrashPhase=typeof crashPhases[number];
export type CrashState=Record<string,unknown>;
const progress=defineDoc({kind:'app.validation.progress',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({text:'durable baseline'}),checkpointWhen:()=>false});
const intent=defineTask<{operation:string},{phase:'prepared'},void>({name:'app.validation.intent',version:1,initial:()=>({phase:'prepared'}),phases:{prepared:async()=>{throw new Error('Validation intent must never execute');}},abort:async()=>{throw new Error('Validation intent must never execute');}});
const never=()=>new Promise<never>(()=>{});
function facade(db:SqliteDatabase,wrap:(tx:SqliteExecutor)=>SqliteExecutor,after?:()=>Promise<void>):SqliteDatabase {
  return new Proxy(db,{get(target,property){
    if(property==='transaction')return async(callback:any)=>{const result=await db.transaction(tx=>callback(wrap(tx)));await after?.();return result;};
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }});
}
export async function prepareCrash(directory:string,phase:CrashPhase,publish:(state:CrashState)=>void) {
  await mkdir(directory,{recursive:true});const path=join(directory,`${phase}.sqlite`);
  await assert.rejects(access(path),{code:'ENOENT'}); // Never silently overwrite a previous run.
  const db=await openNodeSqliteDatabase(path);await db.exec('PRAGMA synchronous=FULL');
  const ready=(extra:CrashState={})=>publish({status:'crash-ready',phase,stableBaselineId:2,stableProbeId:3,receipts:0,...extra});
  if(phase==='migration') {
    await applySqliteMigrations(db,SQLITE_MIGRATIONS.slice(0,1));
    await db.run('INSERT INTO conversations(id,record) VALUES(1,?)','{"id":1}');await db.run("INSERT INTO record_ids VALUES(1,'conversation')");
    await db.run('INSERT INTO tasks VALUES(2,1,?,?,0,0,?)','migration.fixture','pending',JSON.stringify({id:2,conversationId:1,kind:'migration.fixture',version:1,input:{stable:'old'},state:{status:'pending',checkpoint:{phase:'prepared'}},background:false,abortRequested:false}));
    await db.run("INSERT INTO record_ids VALUES(2,'task')");
    const hooked=facade(db,tx=>new Proxy(tx,{get(target,property){
      if(property==='exec')return async(sql:string)=>{await tx.exec(sql);if(sql==='DROP TABLE tasks'){ready({schemaVersion:1,uncommittedMigration:true});await never();}};
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }}));
    await SqliteStorage.open(hooked);throw new Error('Migration pause unexpectedly returned');
  }
  let armed=false;
  const hooked=facade(db,tx=>new Proxy(tx,{get(target,property){
    if(property==='run')return async(sql:string,...params:any[])=>{
      if(armed&&phase==='before'&&sql.startsWith('INSERT INTO entries')){ready({transactionStarted:true,writes:0});await never();}
      await tx.run(sql,...params);
      if(armed&&phase==='during'&&sql.startsWith('INSERT INTO entries')){ready({transactionStarted:true,writes:1});await never();}
    };
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }}),async()=>{if(armed&&phase==='after'){ready({nativeCommitComplete:true});await never();}});
  const storage=await SqliteStorage.open(hooked);
  const baseline:StorageWrite={type:'entry',value:{id:2 as any,conversationId:root,kind:'baseline',data:{text:'confirmed baseline'}}};
  await storage.commit([[{type:'conversation',value:{id:root}},baseline]],()=>{},context);
  if(phase==='deferred') {
    const session=createSession(storage,{documentRetentionMs:Infinity,persistWithinMs:Infinity});
    const ids=await session.commit(async tx=>{
      await tx.doc(progress,root);
      const entry=await tx.appendEntry(root,{kind:'user',data:{text:'admitted input'}});
      const submission=await tx.createSubmission({conversationId:root,type:'input',status:'placed',entry:entry.id,requestId:'stable-input'});
      const task=await tx.createTask(intent,{operation:'stable-intent'},{conversationId:root,ownership:{kind:'conversation'}});
      return {entry:entry.id,submission:submission.id,task};
    },context);
    let storedPublications=0;session.observeCommits({advance:()=>{storedPublications++;},end:()=>{}});
    let watched='';const watch=await session.observeDoc(progress,root,{advance:call=>{if(call.kind==='value')watched=call.value.text;},end:()=>{}},context);
    assert.ok(watch);
    await session.commit(async tx=>{(await tx.doc(progress,root)).text='unpersisted progress';},context,{persistence:{kind:'deferred',withinMs:Infinity}});
    const stored=await storage.findDocument({kind:progress.definition.kind,scope:{kind:'conversation',conversationId:root}},'current',context);
    assert.ok(stored);assert.equal((await storage.document(stored.id,'current',context))!.value.text,'durable baseline');
    assert.equal(watched,'unpersisted progress');assert.equal(storedPublications,0);
    ready({ids,memoryProgress:watched,durableProgress:'durable baseline',storedPublications});return;
  }
  armed=true;let receipts=0;
  await storage.commit([[{type:'entry',value:{id:3 as any,conversationId:root,kind:'candidate',data:{operation:'stable-probe'}}}]],()=>{receipts++;},context);
  assert.equal(phase,'confirmed');assert.equal(receipts,1);ready({receipts,nativeCommitComplete:true});
}
export async function recoverCrash(directory:string,phase:CrashPhase) {
  const path=join(directory,`${phase}.sqlite`);await access(path);
  let priorSchema:number|undefined;
  if(phase==='migration') {
    const db=await openNodeSqliteDatabase(path);priorSchema=(await db.get<any>('SELECT version FROM durable_schema')).version;
    assert.equal(priorSchema,1);assert.ok(await db.get("SELECT name FROM sqlite_master WHERE name='tasks'"));await db.close();
  }
  const {storage,configuration}=await openOwnedStorage(path);
  try {
    assert.deepEqual(await storage.conversation(root,context),{id:1});
    if(phase==='migration'){const task=await storage.task(2 as any,context);assert.deepEqual(task?.input,{stable:'old'});assert.deepEqual(task?.state,{status:'pending',checkpoint:{phase:'prepared'}});return {status:'recovered',phase,priorSchema,configuration,rootPreserved:true,taskPreserved:true};}
    assert.ok(await storage.entry(2 as any,context));
    if(phase==='deferred') {
      const session=createSession(storage);const value=await session.snapshot(progress,root,context);
      assert.equal(value?.text,'durable baseline');
      const submission=await storage.submissionByRequest(root,'stable-input',context);assert.equal(submission?.status,'placed');
      const tasks=await storage.scanTasks({conversationId:root},10,undefined,context);assert.equal(tasks.items.length,1);
      assert.deepEqual(tasks.items[0].state,{status:'pending',checkpoint:{phase:'prepared'}});
      const entry=await storage.entry((submission as any).entry,context);assert.deepEqual(entry!.entry.data,{text:'admitted input'});
      await session.close(context);
      return {status:'recovered',phase,configuration,progress:value?.text,submissionId:submission!.id,taskId:tasks.items[0].id,inputPreserved:true,intentPreserved:true};
    }
    const candidate=await storage.entry(3 as any,context);const expected=phase==='after'||phase==='confirmed';
    assert.equal(!!candidate,expected);
    return {status:'recovered',phase,configuration,stableBaselineId:2,stableProbeId:3,candidatePresent:!!candidate,commitSeq:candidate?.commitSeq,blindRetries:0};
  } finally {await storage.close(context);}
}
