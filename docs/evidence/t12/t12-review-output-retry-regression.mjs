import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {ManagedExecution}=await import(pathToFileURL(resolve('dist/managed-execution.js')));
const {Recovery}=await import(pathToFileURL(resolve('dist/recovery.js')));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const docs=new Map();
const key=(doc,k)=>doc.definition.kind+':'+(doc.definition.family?k:'');
const tx={doc:async(doc,k)=>{const id=key(doc,k);if(!docs.has(id))docs.set(id,doc.definition.initial(null));return docs.get(id);}};
const harness={snapshot:async(doc,k)=>docs.get(key(doc,k))??null,commit:async fn=>fn(tx)};
const stop=new AbortController();
let saved, starts=0, reads=0, probes=0;
const peer={request:async(method,payload)=>{
 const identity={protocol:1,executorId:'test',ledgerEpoch:'test',namespace:'termux:test'};
 if(method==='ping')return identity;
 if(method==='inspectWorkspace')return {state:'available',identity:'directory',namespace:identity.namespace};
 if(method==='query')return saved?structuredClone(saved):{...identity,executionId:payload.executionId,state:'unknown',reason:'NO_RECEIPT'};
 if(method==='prepare'){saved={...identity,executionId:payload.executionId,requestDigest:hash(payload),finalDigest:hash({payload}),context:payload.context,state:'accepted_not_started',sequence:1,outputCursor:1,outputBytes:1,captureIncomplete:false};return structuredClone(saved);}
 if(method==='start'){starts++;saved={...saved,state:'completed',scopeConfirmed:true,sequence:2,exitCode:0};return structuredClone(saved);}
 if(method==='readOutput'){reads++;await new Promise(setImmediate);throw Error('Controlled unavailable output after confirmed completion');}
 if(method==='cancel')return structuredClone(saved);
 throw Error('Unexpected '+method);
}};
const execution=new ManagedExecution({channel:peer,authority:{readControl:async()=>({generation:1,stoppedThrough:0})}});
execution.attach(harness);
// Only persistence/coordination seams are in memory; original run and Recovery methods execute unchanged.
execution.writes={list:async()=>[],refresh:async()=>{},reserve:async()=>({state:'active'})};
const recovery=new Recovery({conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{},probe:async()=>{probes++;return {allowed:false,used:5,exhausted:true};}},()=>{});
execution.setRecovery(recovery);
const api={taskId:1,callId:'one',conversationId:1,commit:harness.commit,getTask:async()=>({})};
const binding={id:'binding',sdkConversationId:1,controlProductId:'product',location:{environment:'termux',path:'/workspace',version:1},actualIdentity:'directory'};
let observed;const timer=setTimeout(()=>{observed={reads,starts,probes,status:recovery.status('product')};stop.abort();},100);
const start=performance.now();
const result=await execution.run(binding,api,'printf x',undefined,{abortSignal:stop.signal});
clearTimeout(timer);recovery.close();
const checks={oneInitialRead:observed.reads===1,oneEffectStart:starts===1,budgetConsulted:observed.probes>=1,visibleExhaustedWait:observed.status?.reason==='external-unconfirmed'&&observed.status.used===5};
console.log(JSON.stringify({fixture:'unchanged ManagedExecution.run + Recovery; in-memory harness/private writer fixture, no real SDK scheduler or native SQLite; asynchronous peer output boundary',modelRequests:0,credentialAccess:0,androidAccess:0,observed,checks,elapsedMs:performance.now()-start,result:{ok:result.ok,error:result.error?.message}},null,2));
assert.ok(Object.values(checks).every(Boolean),'Completed effect output failures must consult exhausted budget and remain visibly waiting without another read/start');
