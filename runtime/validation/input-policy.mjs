// Identical public-seam checks run in desktop Node and the actual Android embedded runtime.
const cases=[];
const test=(name,run)=>cases.push({name,run});
let tempRoot;
let running=false;
export function registerInputPolicyChecks(register){for(const {name,run} of cases)register(name,run);}
export async function runInputPolicyChecks(onCase,options={}){
  if(running)throw Error('Input policy checks already running');running=true;tempRoot=options.tempRoot;
  try{for(const {name,run} of cases){try{await run();await onCase?.({name,passed:true});}catch(error){throw Object.assign(Error(`Input policy check failed: ${name}`),{diagnostic:{name:error?.name,code:error?.code,operator:error?.operator,frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at\s/.test(line)).slice(0,8)}});}}}
  finally{running=false;tempRoot=undefined;}
}
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from './application-fixture.mjs';
import {ModelConnections} from '../dist/model-connections.js';
import {frozenInputDigest,materializeFrozenInput} from '../dist/input.js';
import {INPUT_BUDGETS} from '../dist/input-protocol.js';
import {fixtureTransport} from '../dist/transport.js';
import {createProvider} from '@earendil-works/pi-ai/models';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZl8AAAAASUVORK5CYII=','base64');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function frozen(id='one',text='') {
  const representations=[{objectId:'object-image',sha256:hash(png),byteLength:png.length,kind:'image',mimeType:'image/png',range:'full',width:1,height:1,capabilityVersion:'prepared-capability'}];
  return {token:'immutable-token',id,revision:3,text,representations,digest:frozenInputDigest(text,representations)};
}
const access=value=>({readFrozen:async()=>structuredClone(value),readObject:async()=>new Uint8Array(png)});
const credentials={metadata:async id=>({connectionId:id,state:'configured',configured:true,generation:1}),resolve:async()=>({key:'synthetic-image-test-key',generation:1})};
const request=async(app,method,payload={})=>{const result=await app.request({protocol:1,connectionId:'input-tests',requestId:crypto.randomUUID(),method,payload});if(!result.ok)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.value;};
const until=async predicate=>{const end=Date.now()+8000;while(!await predicate()){assert.ok(Date.now()<end,'public state deadline');await new Promise(r=>setTimeout(r,10));}};

test('capabilities derive from the fixed SDK catalog, use byte-specific budgets, and never resolve credentials',()=>{
  let reads=0;const connections=new ModelConnections({credentials:{metadata:async()=>{reads++;throw Error('No auth query');},resolve:async()=>{reads++;throw Error('No decrypt');}}});
  const image=connections.definition({creationId:'image',name:'image',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
  const text=connections.definition({creationId:'text',name:'text',protocol:'openai-compatible',endpoint:'https://example.invalid/v1',modelId:'unknown'});
  connections.publish({version:1,defaultModel:null,connections:[image,text]});
  const capability=connections.capability('image','mimo-v2.6-flash');
  assert.deepEqual(capability.input,['text','image']);assert.equal(capability.source,'sdk-catalog');
  assert.equal(capability.limits.maxBase64Bytes,4718592);assert.equal(capability.applicationPolicy.imageBytes,1572864);
  assert.deepEqual(connections.capability('text','unknown').input,['text']);assert.equal(reads,0);
  assert.equal(connections.models.getModel('image','mimo-v2.6-flash').input.includes('image'),true);
  connections.publish({version:2,defaultModel:null,connections:[{...image,enabled:false},text]});
  assert.equal(connections.capability('image','mimo-v2.6-flash'),undefined);assert.equal(reads,0);
});

test('fixed input verifies ownership, every object and digest before SDK content; changed capabilities never alter a token',async()=>{
  const value=frozen('one','文字🌍');const model={provider:'fixture',id:'image',input:['text','image']};
  const content=await materializeFrozenInput(access(value),value.token,'one',model);
  assert.deepEqual(content,[{type:'text',text:'文字🌍'},{type:'image',mimeType:'image/png',data:png.toString('base64')}]);
  await assert.rejects(materializeFrozenInput(access(value),value.token,'other',model),{code:'INPUT_TARGET_MISMATCH'});
  await assert.rejects(materializeFrozenInput({...access(value),readObject:async()=>new Uint8Array(png.length)},value.token,'one',model),{code:'INPUT_OBJECT_CHANGED'});
  await assert.rejects(materializeFrozenInput(access({...value,digest:'bad'}),value.token,'one',model),{code:'INPUT_DIGEST_MISMATCH'});
  await assert.rejects(materializeFrozenInput(access(value),value.token,'one',{...model,input:['text']}),{code:'IMAGE_UNSUPPORTED'});
  await assert.rejects(materializeFrozenInput(access(value),value.token,'one',{...model,inputLimits:{images:{resize:{maxBytes:1}}}}),{code:'INPUT_BUDGET_EXCEEDED'});
  assert.deepEqual(value,frozen('one','文字🌍'),'validation never mutates fixed input');
  const text='\uFEFF完整 UTF-8 正文 🌍\n第二行',bytes=Buffer.from(text,'utf8');
  const representations=[{objectId:'text-object',sha256:hash(bytes),byteLength:bytes.length,kind:'text',mimeType:'text/plain',range:'full',capabilityVersion:'prepared-capability'}];
  const fixedText={token:'text-token',id:'one',revision:4,text:'',representations,digest:frozenInputDigest('',representations)};
  const textContent=await materializeFrozenInput({readFrozen:async()=>fixedText,readObject:async()=>bytes},'text-token','one',model);
  assert.deepEqual(textContent,[{type:'text',text}],'full text preserves the original BOM and every Unicode scalar');
});

test('explicit fixed-image send reaches real SDK encoding, persists image-only history, and reopening never sends',async()=>{
  const directory=await mkdtemp(join(tempRoot??tmpdir(),'durable-input-'));const bodies=[];let decryptions=0;const remembered=[];
  const transport=fixtureTransport({requested:()=>{},aborted:()=>{}});
  const connections=new ModelConnections({credentials:{...credentials,resolve:async()=>{decryptions++;return credentials.resolve();}},fetch:async(input,init)=>{bodies.push(JSON.parse(await new Request(input,init).text()));return transport(input,init);}});
  const value=frozen('picture');const inputs={...access(value),rememberConversation:(conversation,capability)=>remembered.push({conversation,capability})};
  const options={path:join(directory,'application.sqlite'),workspacePath:join(directory,'workspace'),models:connections.models,connections,inputs};
  let app=new Application(options);
  try {
    await app.start();await request(app,'models.create',{creationId:'image',expectedVersion:0,name:'图片',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
    await request(app,'models.setDefault',{expectedVersion:1,selection:{provider:'image',modelId:'mimo-v2.6-flash'}});
    await request(app,'create',{creationId:'picture'});assert.equal(bodies.length,0);assert.equal(decryptions,0);
    assert.ok(remembered.some(x=>x.conversation.id==='picture'&&x.capability.input.includes('image')));
    await request(app,'send',{id:'picture',inputToken:value.token,actionId:'explicit-picture'});
    await until(async()=>{const snapshot=await request(app,'open',{id:'picture'});assert.notEqual(snapshot.phase,'failed',snapshot.reason);return snapshot.phase==='done';});
    assert.equal(bodies.length,1);const image=bodies[0].messages.find(x=>x.role==='user').content.find(x=>x.type==='image_url');
    assert.equal(image.image_url.url,`data:image/png;base64,${png.toString('base64')}`);
    const history=(await request(app,'history',{id:'picture'})).items;
    assert.equal(history[0].role,'user');assert.equal(history[0].attachments[0].sha256,hash(png));
    assert.equal(JSON.stringify(history).includes(png.toString('base64')),false,'UI history never carries image bytes');
    await app.close();app=new Application(options);await app.start();
    assert.deepEqual((await request(app,'history',{id:'picture'})).items,history);assert.equal(bodies.length,1);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('actual serialized SDK requests enforce escaped JSON, history image counts and selected-model limits before decrypt or transport',async()=>{
  let decryptions=0,requests=0;
  const connections=new ModelConnections({credentials:{...credentials,resolve:async()=>{decryptions++;return credentials.resolve();}},fetch:async()=>{requests++;throw Error('must not send');}});
  const definition=connections.definition({creationId:'budget',name:'budget',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
  connections.publish({version:1,defaultModel:null,connections:[definition]});
  const selected=connections.models.getModel('budget','mimo-v2.6-flash');
  const image={type:'image',mimeType:'image/png',data:png.toString('base64')};
  const message=content=>({role:'user',content,timestamp:0});
  const cases=[
    {model:selected,messages:[message('\u0001'.repeat(Math.ceil(INPUT_BUDGETS.requestBytes/6)))],reason:/预算|大小/},
    {model:{...selected,inputLimits:{maxRequestBytes:80}},messages:[message('ordinary')],reason:/预算|大小/},
    {model:{...selected,input:['text']},messages:[message([image])],reason:/图片/},
    {model:{...selected,inputLimits:{images:{maxPerRequest:1}}},messages:[message([image]),message([image])],reason:/数量/},
    {model:{...selected,inputLimits:{images:{maxPerMessage:1}}},messages:[message([image,image])],reason:/数量/},
    {model:{...selected,inputLimits:{images:{resize:{maxBytes:1}}}},messages:[message([image])],reason:/预算|大小/},
  ];
  for(const item of cases){const result=await connections.models.completeSimple(item.model,{messages:item.messages});assert.equal(result.stopReason,'error');assert.match(result.errorMessage,item.reason);}
  assert.equal(decryptions,0);assert.equal(requests,0);
});

test('oversized accumulated context is refused before entering the real SDK provider encoder',async()=>{
  let encodings=0,decryptions=0,requests=0;
  const connections=new ModelConnections({credentials:{...credentials,resolve:async()=>{decryptions++;return credentials.resolve();}},fetch:async()=>{requests++;throw Error('must not send');},providerFactory:definition=>{
    const provider=createProvider({id:definition.id,models:[],auth:{apiKey:{name:'synthetic',resolve:async()=>({auth:{apiKey:'unused'}})}},api:openAICompletionsApi()});
    return {...provider,streamSimple:(model,context,options)=>{encodings++;return provider.streamSimple(model,context,options);}};
  }});
  const definition=connections.definition({creationId:'preflight',name:'preflight',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
  connections.publish({version:1,defaultModel:null,connections:[definition]});
  const text='x'.repeat(4*1024*1024),messages=Array.from({length:3},()=>({role:'user',content:text,timestamp:0}));
  const result=await connections.models.completeSimple(connections.models.getModel('preflight','mimo-v2.6-flash'),{messages});
  assert.equal(result.stopReason,'error');assert.equal(encodings,0);assert.equal(decryptions,0);assert.equal(requests,0);assert.match(result.errorMessage,/编码前.*预算/);
});
