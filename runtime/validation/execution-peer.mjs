// External service fixture for SDK hard-kill tests. Actual Termux supervision is tested separately.
import {DatabaseSync} from 'node:sqlite';
import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createModels,createProvider} from '@earendil-works/pi-ai/models';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function executionConfiguration(){
 const models=createModels(),api=openAICompletionsApi();
 const fetch=async(_url,init)=>{const body=JSON.parse(init.body),tool=body.messages.at(-1).role==='user',delta=tool?{tool_calls:[{index:0,id:'durable-command',type:'function',function:{name:'bash',arguments:JSON.stringify({command:"printf 'durable-世界'"})}}]}:{content:'已核验'};return new Response(`data: ${JSON.stringify({id:'execution',choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'execution',choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});};
 models.setProvider(createProvider({id:'execution',baseUrl:'https://fixture.invalid/v1',auth:{apiKey:{name:'fixture',resolve:async()=>({auth:{apiKey:'public-fixture-token'}})}},models:[{id:'model',name:'fixture',api:'openai-completions',provider:'execution',baseUrl:'https://fixture.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}],api:{stream:(m,c,o)=>api.stream(m,c,{...o,maxRetries:0,fetch}),streamSimple:(m,c,o)=>api.streamSimple(m,c,{...o,maxRetries:0,fetch})}}));
 return {models,initialModel:{provider:'execution',modelId:'model',name:'fixture'},workspacePath:'/termux/default-workspace'};
}
export class PersistentExecutionPeer {
 identity={protocol:1,executorId:'persistent-peer',ledgerEpoch:'ledger-one',namespace:'termux:persistent-peer',defaultWorkspace:'/termux/default-workspace'};
 constructor(directory){this.directory=directory;this.db=new DatabaseSync(join(directory,'peer.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY,request TEXT,receipt TEXT)');}
 read(id){const row=this.db.prepare('SELECT request,receipt FROM executions WHERE id=?').get(id);return row&&{request:JSON.parse(row.request),receipt:JSON.parse(row.receipt)};}
 async request(method,payload){const id=payload.executionId;
  if(method==='ping')return {...this.identity,processEpoch:'fixture-process'};
  if(method==='inspectWorkspace')return {state:'available',identity:'directory:'+payload.path,namespace:this.identity.namespace};
  if(method==='query')return this.read(id)?.receipt??{...this.identity,executionId:id,state:'unknown',reason:'NO_RECEIPT'};
  if(method==='list')return {executions:this.db.prepare('SELECT receipt FROM executions ORDER BY id').all().map(row=>JSON.parse(row.receipt)),nextCursor:null};
  if(method==='prepare'){const prior=this.read(id);if(prior){if(hash(prior.request)!==hash(payload))throw Error('Identity conflict');return prior.receipt;}const receipt={...this.identity,executionId:id,context:payload.context,requestDigest:hash(payload),finalDigest:hash({prepared:payload}),state:'accepted_not_started',sequence:1,outputBytes:0,outputCursor:0,outputRef:'/termux/outputs/'+id+'.raw',captureIncomplete:false};this.db.prepare('INSERT INTO executions VALUES(?,?,?)').run(id,JSON.stringify(payload),JSON.stringify(receipt));return receipt;}
  if(method==='start'){const record=this.read(id);if(record.receipt.state==='accepted_not_started'){if(record.receipt.finalDigest!==payload.finalDigest)throw Error('Final digest differs');appendFileSync(join(this.directory,'effects.txt'),id+'\n');record.receipt={...record.receipt,state:'completed',scopeConfirmed:true,exitCode:0,sequence:3,outputCursor:2,outputBytes:Buffer.byteLength('durable-世界'),rawSha256:createHash('sha256').update('durable-世界').digest('hex')};this.db.prepare('UPDATE executions SET receipt=? WHERE id=?').run(JSON.stringify(record.receipt),id);}return record.receipt;}
  if(method==='readOutput'){const raw=Buffer.from('durable-世界'),chunks=this.read(id)?.receipt.state==='completed'?[raw.subarray(0,9),raw.subarray(9)]:[];return {...this.identity,executionId:id,cursor:payload.cursor,nextCursor:chunks.length,chunks:chunks.map((data,i)=>({sequence:i+1,stream:'stdout',data:data.toString('base64')})).filter(chunk=>chunk.sequence>payload.cursor)};}
  throw Error('Unexpected fixture operation '+method);
 }
 loseSupervision(id){const record=this.read(id);record.receipt={...record.receipt,state:'unknown',reason:'SUPERVISOR_LOST',scopeConfirmed:false,sequence:record.receipt.sequence+1};this.db.prepare('UPDATE executions SET receipt=? WHERE id=?').run(JSON.stringify(record.receipt),id);}
 close(){this.db.close();}
}
