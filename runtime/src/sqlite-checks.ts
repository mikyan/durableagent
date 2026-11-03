import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {NodeSqliteDatabase,openNodeSqliteDatabase} from '@earendil-works/chord/sqlite/node';
import type {SqliteExecutor} from '@earendil-works/chord/sqlite';
import {SqliteStorage,applySqliteMigrations,SQLITE_MIGRATIONS} from '@earendil-works/pi-durable/storage/sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {ROOT_CONVERSATION_ID,createSession,defineDoc,type StorageWrite} from '@earendil-works/pi-durable';
import {openOwnedStorage} from './storage.js';
import type {StorageCheck} from './storage-checks.js';

/** Only the external SQLite call boundary is faulted; all SQL executes on the real engine. */
export async function faultDatabase(path:string) {
  const raw=new DatabaseSync(path);
  const control={before:(_sql:string)=>{},after:(_sql:string)=>{},beforeGet:(_sql:string,_params:unknown[])=>{}};
  const facade=new Proxy(raw,{get(target,property){
    if(property==='exec')return (sql:string)=>{control.before(sql);target.exec(sql);control.after(sql);};
    if(property==='prepare')return (sql:string)=>{
      const statement=target.prepare(sql);
      return new Proxy(statement,{get(target,property){
        if(property==='get')return (...params:any[])=>{control.beforeGet(sql,params);return target.get(...params);};
        const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
      }});
    };
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }});
  const db=new NodeSqliteDatabase(facade);
  await db.exec('PRAGMA journal_mode=WAL');await db.exec('PRAGMA synchronous=FULL');
  return {db,raw,control};
}
const rootWrite:StorageWrite={type:'conversation',value:{id:ROOT_CONVERSATION_ID}};
export function sqliteChecks(directory:string,diagnostic:(value:Record<string,unknown>)=>void=()=>{}):StorageCheck[] {
  let index=0;
  const path=()=>join(directory,`sqlite-${index++}.sqlite`);
  const cases:StorageCheck[]=[];
  const check=(name:string,run:()=>Promise<void>)=>cases.push({name,run:async()=>{await mkdir(directory,{recursive:true});await run();}});
  check('STRICT, JSON, partial indexes, UPSERT and all parameter types use the real engine',async()=>{
    const db=await openNodeSqliteDatabase(path());
    try {
      await db.exec('CREATE TABLE value_test(id INTEGER PRIMARY KEY,n INTEGER,t TEXT,j TEXT CHECK(json_valid(j)),b BLOB,f REAL,z ANY) STRICT; CREATE UNIQUE INDEX only_text ON value_test(t) WHERE t IS NOT NULL');
      await db.run('INSERT INTO value_test VALUES(?,?,?,?,?,?,?)',1,42,'北京🌍','{"ok":true}',new Uint8Array([0,255,1]),1.25,null);
      const value=await db.get<any>('SELECT * FROM value_test WHERE id=?',1);
      assert.equal(value.n,42);assert.equal(value.t,'北京🌍');assert.equal(value.f,1.25);assert.equal(value.z,null);assert.deepEqual([...value.b],[0,255,1]);
      await assert.rejects(db.run('UPDATE value_test SET n=? WHERE id=1','wrong'),/datatype|INTEGER/i);
      await assert.rejects(db.run('UPDATE value_test SET j=? WHERE id=1','invalid'),/CHECK/);
      await assert.rejects(db.run('INSERT INTO value_test(id,t) VALUES(2,?)','北京🌍'),/UNIQUE/);
      await db.run('INSERT INTO value_test(id,t) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET t=excluded.t','updated');
      await db.run('INSERT INTO value_test(id,t) VALUES(2,NULL),(3,NULL)');
      assert.equal((await db.get<any>('SELECT t FROM value_test WHERE id=1')).t,'updated');
      await db.run('UPDATE value_test SET n=? WHERE id=1',42n);assert.equal((await db.get<any>('SELECT n FROM value_test WHERE id=1')).n,42);
      // Boolean is outside Chord 1.5's SqliteValue union. Record native variance,
      // without making rejection of an uncontracted input a portability condition.
      try {diagnostic({booleanBinding:{accepted:true,value:(await db.get<any>('SELECT ? AS value',true as any)).value}});}
      catch(error) {diagnostic({booleanBinding:{accepted:false,error:String(error)}});}
    } finally {await db.close();}
  });
  check('runCounted excludes trigger writes; transaction queue isolates reads, writes and other transactions',async()=>{
    const db=await openNodeSqliteDatabase(path());
    try {
      await db.exec('CREATE TABLE rows(id INTEGER PRIMARY KEY,v INTEGER);CREATE TABLE audit(v INTEGER);CREATE TRIGGER audit_insert AFTER INSERT ON rows BEGIN INSERT INTO audit VALUES(new.v); INSERT INTO audit VALUES(new.v); END');
      assert.equal(await db.runCounted('INSERT INTO rows VALUES(1,1)'),1);
      assert.equal((await db.get<any>('SELECT count(*) AS n FROM audit')).n,2);
      const barrier=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
      const entered=barrier(),release=barrier();
      let stale:SqliteExecutor|undefined;const order:string[]=[];
      const transaction=db.transaction(async tx=>{stale=tx;assert.equal(await tx.runCounted('INSERT INTO rows VALUES(2,2)'),1);entered.resolve();await release.promise;order.push('callback');});
      await entered.promise;
      const read=db.get<any>('SELECT count(*) AS n FROM rows').then(row=>{order.push('read');return row.n;});
      const write=db.runCounted('UPDATE rows SET v=v+1').then(n=>{order.push('write');return n;});
      const other=db.transaction(async tx=>{order.push('other');return tx.get<any>('SELECT count(*) AS n FROM audit');});
      await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(order,[]);
      release.resolve();await transaction;assert.equal(await read,2);assert.equal(await write,2);assert.equal((await other)?.n,4);
      assert.deepEqual(order,['callback','read','write','other']);
      await assert.rejects(stale!.runCounted('DELETE FROM rows'),/no longer active/);
      assert.equal(await db.runCounted('UPDATE rows SET v=7 WHERE id=999'),0);
    } finally {await db.close();}
  });
  for(const phase of ['callback','commit-before','rollback','commit-after'] as const)check(`transaction ${phase} preserves the actual error and durable outcome`,async()=>{
    const file=path(),{db,raw,control}=await faultDatabase(file);
    await db.exec('CREATE TABLE durable(id INTEGER PRIMARY KEY)');
    const original=new Error(`injected-${phase}`),rollback=new Error('injected-rollback');const events:string[]=[];
    control.before=sql=>{if(sql==='COMMIT'&&phase==='commit-before')throw original;if(sql==='ROLLBACK'&&phase==='rollback')throw rollback;};
    control.after=sql=>{events.push(sql);if(sql==='COMMIT'&&phase==='commit-after')throw original;};
    let caught:unknown,expired:SqliteExecutor|undefined;
    try {await db.transaction(async tx=>{expired=tx;await tx.run('INSERT INTO durable VALUES(17)');if(phase==='callback'||phase==='rollback')throw original;});}catch(error){caught=error;}
    assert.ok(caught);
    await assert.rejects(expired!.get('SELECT * FROM durable'),/no longer active/);
    if(phase==='rollback'||phase==='commit-after'){assert.ok(caught instanceof AggregateError);assert.equal(caught.errors[0],original);if(phase==='rollback')assert.equal(caught.errors[1],rollback);}
    else assert.equal(caught,original);
    if(phase==='callback'||phase==='commit-before')assert.ok(events.includes('ROLLBACK'));
    control.before=()=>{};control.after=()=>{};
    if(phase==='rollback')raw.exec('ROLLBACK');
    await db.close();
    const reopen=await openNodeSqliteDatabase(file);
    try {assert.equal((await reopen.get<any>('SELECT count(*) AS n FROM durable')).n,phase==='commit-after'?1:0);}finally{await reopen.close();}
  });
  for(const phase of ['apply','check','commit-before','commit-after','receive'] as const)check(`SDK batches: ${phase} fault, receipts and reopen agree`,async()=>{
    const file=path(),{db,raw,control}=await faultDatabase(file);const storage=await SqliteStorage.open(db);
    await storage.commit([[rootWrite]],()=>{},context);
    const ids=[await storage.mintId(),await storage.mintId()];
    const writes=ids.map(id=>[{type:'entry',value:{id,conversationId:ROOT_CONVERSATION_ID,kind:'test'}}] as StorageWrite[]);
    const receipts:{index:number;seq:number}[]=[];const fault=new Error(`injected-${phase}`);
    if(phase==='apply')await db.exec(`CREATE TRIGGER fail_entry BEFORE INSERT ON entries WHEN new.id=${ids[1]} BEGIN SELECT RAISE(ABORT,'injected database apply'); END`);
    let prefixApplied=false;
    if(phase==='check')control.beforeGet=(sql,params)=>{
      if(sql.includes('FROM record_ids')&&params[0]===ids[1]) {
        prefixApplied=!!raw.prepare('SELECT id FROM entries WHERE id=?').get(ids[0]);
        assert.ok(prefixApplied);throw fault;
      }
    };
    control.before=sql=>{if(phase==='commit-before'&&sql==='COMMIT')throw fault;};
    control.after=sql=>{if(phase==='commit-after'&&sql==='COMMIT')throw fault;};
    await assert.rejects(storage.commit(writes,(index,seq)=>{receipts.push({index,seq});if(phase==='receive')throw fault;},context));
    assert.equal(receipts.length,phase==='receive'?1:0);
    if(phase==='check')assert.ok(prefixApplied);
    control.before=()=>{};control.after=()=>{};
    control.beforeGet=()=>{};
    await storage.close(context);
    const reopened=await openOwnedStorage(file);
    try {
      const present=phase==='commit-after'||phase==='receive';
      for(const id of ids)assert.equal(!!await reopened.storage.entry(id as any,context),present);
      if(receipts.length)assert.equal((await reopened.storage.entry(ids[0] as any,context))!.commitSeq,receipts[0].seq);
    } finally {await reopened.storage.close(context);}
  });
  check('schema 1 to 2 preserves records, failed migration rolls back, newer schema blocks without reset',async()=>{
    const file=path();let db=await openNodeSqliteDatabase(file);
    await applySqliteMigrations(db,SQLITE_MIGRATIONS.slice(0,1));
    await db.run('INSERT INTO conversations(id,record) VALUES(1,?)',JSON.stringify({id:1}));
    await db.run('INSERT INTO record_ids VALUES(1,?)','conversation');
    const oldTask={id:2,conversationId:1,kind:'migration.fixture',version:1,input:{stable:'old'},state:{status:'pending',checkpoint:{phase:'prepared'}},background:false,abortRequested:false};
    await db.run('INSERT INTO tasks VALUES(2,1,?,?,0,0,?)','migration.fixture','pending',JSON.stringify(oldTask));
    await db.run('INSERT INTO record_ids VALUES(2,?)','task');
    await db.close();
    const faulty=await faultDatabase(file);
    faulty.control.after=sql=>{if(sql==='DROP TABLE tasks')throw new Error('interrupted migration');};
    await assert.rejects(SqliteStorage.open(faulty.db),/interrupted migration/);
    db=await openNodeSqliteDatabase(file);
    assert.equal((await db.get<any>('SELECT version FROM durable_schema')).version,1);
    assert.ok(await db.get('SELECT * FROM conversations WHERE id=1'));
    assert.ok(await db.get("SELECT name FROM sqlite_master WHERE name='tasks'"));
    assert.equal((await db.get<any>('SELECT record FROM tasks WHERE id=2')).record,JSON.stringify(oldTask));
    const storage=await SqliteStorage.open(db);
    assert.deepEqual(await storage.conversation(ROOT_CONVERSATION_ID,context),{id:1});
    assert.deepEqual(await storage.task(2 as any,context),oldTask);
    assert.equal((await db.get<any>('SELECT version FROM durable_schema')).version,2);
    await storage.close(context);
    db=await openNodeSqliteDatabase(file);await db.run('UPDATE durable_schema SET version=3');await db.close();
    await assert.rejects(openOwnedStorage(file),/newer than supported/);
    db=await openNodeSqliteDatabase(file);
    assert.equal((await db.get<any>('SELECT version FROM durable_schema')).version,3);
    assert.ok(await db.get('SELECT * FROM conversations WHERE id=1'));await db.close();
  });
  check('application metadata and SDK entry commit atomically; incompatible document version preserves old content',async()=>{
    const file=path();let owned=await openOwnedStorage(file);let session=createSession(owned.storage);
    await owned.storage.commit([[rootWrite]],()=>{},context);
    const doc=defineDoc({kind:'app.contract',version:1,scope:'session',initial:()=>({title:'initial'}),checkpointWhen:()=>false});
    await assert.rejects(session.commit(async tx=>{(await tx.doc(doc)).title='refused';await tx.appendEntry(ROOT_CONVERSATION_ID,{kind:'test',data:{text:'refused'}});throw new Error('refuse atomic change');},context),/refuse/);
    assert.equal(await session.snapshot(doc,context),undefined);
    const entry=await session.commit(async tx=>{(await tx.doc(doc)).title='retained';return tx.appendEntry(ROOT_CONVERSATION_ID,{kind:'test',data:{text:'retained'}});},context);
    await session.close(context);
    owned=await openOwnedStorage(file);session=createSession(owned.storage);
    assert.equal((await session.snapshot(doc,context))!.title,'retained');assert.deepEqual((await owned.storage.entry(entry.id,context))!.entry.data,{text:'retained'});
    const incompatible=defineDoc({kind:'app.contract',version:2,scope:'session',initial:()=>({title:'new'}),checkpointWhen:()=>false});
    await assert.rejects(session.snapshot(incompatible,context),/version|migrat/i);
    await session.close(context);
    owned=await openOwnedStorage(file);session=createSession(owned.storage);assert.equal((await session.snapshot(doc,context))!.title,'retained');await session.close(context);
  });
  check('an uncertain commit fails the Session permanently and reopening inspects its stable ID without replay',async()=>{
    const file=path(),{db,control}=await faultDatabase(file);const storage=await SqliteStorage.open(db);
    await storage.commit([[rootWrite]],()=>{},context);const session=createSession(storage);
    let id:any,commits=0;control.after=sql=>{if(sql==='COMMIT'){commits++;throw new Error('commit acknowledgement lost');}};
    await assert.rejects(session.commit(async tx=>{id=(await tx.appendEntry(ROOT_CONVERSATION_ID,{kind:'stable-uncertain'})).id;},context));
    assert.equal((await session.closed).kind,'failed');
    await assert.rejects(session.commit(async()=>{},context));assert.equal(commits,1);
    const reopened=await openOwnedStorage(file);
    try {assert.equal((await reopened.storage.entry(id,context))!.entry.kind,'stable-uncertain');assert.equal((await reopened.storage.scanEntries({conversationId:ROOT_CONVERSATION_ID},10,undefined,context)).items.length,1);}finally{await reopened.storage.close(context);}
  });
  check('dependent commit flushes deferred progress and durable entries cannot be deferred',async()=>{
    const {storage}=await openOwnedStorage(path());await storage.commit([[rootWrite]],()=>{},context);
    const session=createSession(storage,{documentRetentionMs:Infinity,persistWithinMs:Infinity});
    const progress=defineDoc({kind:'app.deferred',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({text:'baseline'}),checkpointWhen:()=>false});
    const destination=defineDoc({kind:'app.dependent',version:1,scope:'session',initial:()=>({text:''}),checkpointWhen:()=>false});
    try {
      await session.commit(async tx=>{await tx.doc(progress,ROOT_CONVERSATION_ID);},context);
      await session.commit(async tx=>{(await tx.doc(progress,ROOT_CONVERSATION_ID)).text='new progress';},context,{persistence:{kind:'deferred',withinMs:Infinity}});
      const entry=await session.commit(async tx=>{
        const value=await tx.doc(progress,ROOT_CONVERSATION_ID);(await tx.doc(destination)).text=value.text;
        return tx.appendEntry(ROOT_CONVERSATION_ID,{kind:'intent',data:{text:value.text}});
      },context,{persistence:{kind:'deferred',withinMs:Infinity}});
      assert.ok(await storage.entry(entry.id,context));
      const record=await storage.findDocument({kind:'app.deferred',scope:{kind:'conversation',conversationId:ROOT_CONVERSATION_ID}},'current',context);
      assert.equal((await storage.document(record!.id,'current',context))!.value.text,'new progress');
    }finally{await session.close(context);}
  });
  return cases;
}
