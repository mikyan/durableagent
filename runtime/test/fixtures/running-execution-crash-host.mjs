import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Application} from '../../dist/application.js';
import {ManagedExecution} from '../../dist/managed-execution.js';
import {SqliteSendAuthority} from '../../validation/submission-authority.mjs';
import {RunningExecutionPeer} from './running-execution-peer.mjs';
import {runningModels} from './running-model-connections.mjs';
import {faultDatabase} from '../../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {apply} from '@earendil-works/chord/delta';
const [directory,stage='output-checkpoint']=process.argv.slice(2),native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new RunningExecutionPeer(directory);
const cut=point=>{if(point===stage){writeFileSync(join(directory,'cut.txt'),point);process.kill(process.pid,'SIGKILL');}};
let partialRead=false;
const channel={request:async(method,payload)=>{
 const value=await peer.request(method,payload);
 if(method==='start')cut('native-start');
 if(method==='readOutput'&&value.chunks.length){partialRead=true;cut('partial-read');}
 if(method==='query'&&partialRead)cut('query-before-output-save');
 return value;
}};
const recovery={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{},probe:async()=>{throw Error('Running execution must not need an uncertainty probe');}};
let storageFactory;
if(stage==='output-save-before-commit'||stage==='output-save-after-commit'){
 const {db,raw,control}=await faultDatabase(join(directory,'sdk.sqlite'));
 const observeCommit=sql=>{
  if(sql!=='COMMIT'||!partialRead)return;
  // Fault injection is at the actual SQLite COMMIT, after the SDK has issued
  // its original writes. The public assertions never read or alter SDK tables.
  const doc=raw.prepare('SELECT id FROM documents WHERE kind=?').get(JSON.stringify('app.managed-execution-intent'));if(!doc)return;
  let value;for(const row of raw.prepare('SELECT kind,content FROM document_revisions WHERE document_id=? ORDER BY seq').all(doc.id))value=row.kind==='base'?JSON.parse(row.content):apply(value,JSON.parse(row.content));
  if(value?.cursor===1&&value.receipt?.state==='running')cut(stage);
 };
 if(stage==='output-save-before-commit')control.before=observeCommit;else control.after=observeCommit;
 storageFactory=()=>SqliteStorage.open(db);
}
const connections=runningModels(()=>appendFileSync(join(directory,'requests.txt'),'request\n'));
const app=new Application({models:connections.models,connections,workspacePath:peer.identity.defaultWorkspace,path:join(directory,'sdk.sqlite'),inputs:native,sends:native,recovery,storageFactory,execution:new ManagedExecution({channel,authority:native,boundary:cut})});
const call=async(method,payload)=>{const reply=await app.request({protocol:1,connectionId:'child',requestId:crypto.randomUUID(),method,payload});if(!reply.ok)throw Error(reply.error.message);return reply.value;};
await app.start();await call('models.create',{creationId:'mimo',expectedVersion:0,name:'MiMo',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});await call('models.setDefault',{expectedVersion:1,selection:{provider:'mimo',modelId:'mimo-v2.6-flash'}});await call('create',{creationId:'chat'});await native.create('chat','Run one command across host loss','original');await call('send',{intentId:'original'});
setInterval(()=>{},1000);
