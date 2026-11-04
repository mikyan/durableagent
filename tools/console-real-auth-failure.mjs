// Root-only real MiMo authentication failure, isolated models domain, synthetic invalid key only.
// Caller holds the device lease and closes its previous idle validation owner. No force-stop/reset.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const [serial,outputRoot]=process.argv.slice(2);
assert.ok(serial&&outputRoot,'Explicit device and new output prefix required');
const adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const pkg='dev.durableagent.probe',run=randomUUID();
const syntheticInvalidKey='synthetic-invalid-mimo-device-validation-000';
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=60000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await read();if(last)return last;}catch(error){last=String(error);}await pause(100);}throw Error(`${label}: ${JSON.stringify(last)}`);}
let socket,port;const evidence={run,mode:'models',started:new Date().toISOString(),scope:'Real bundled React/native vault/SDK request to actual MiMo endpoint using only a deliberately invalid synthetic key. One explicit send; visible Chinese guidance and navigation preserve original intent/history.'};
try{
 // Finish only the caller's idle Activity task for this isolated configuration.
 adb('shell','am','start','-W','-f','0x10008000','-n',`${pkg}/.AgentActivity`,'--es','validationMode','models','--es','validationRun',run);
 const pid=await until(()=>adb('shell','pidof',pkg),'UI PID');assert.match(pid,/^\d+$/);evidence.uiPid=pid;
 await until(()=>adb('shell','cat','/proc/net/unix').includes(`webview_devtools_remote_${pid}`),'WebView socket');
 port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
 const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>row.type==='page'&&row.url==='https://appassets.androidplatform.net/assets/ui/index.html'),'Bundled page');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',({data})=>{const value=JSON.parse(data),call=pending.get(value.id);if(!call)return;pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 async function click(selector){
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return;const r=e.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)e.scrollIntoView({block:'center',inline:'nearest'});})()`);
  let previous,stable=0;
  const rect=await until(async()=>{const value=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&r.top>=0&&r.bottom<=innerHeight&&(hit===e||e.contains(hit))?{x,y}:null})()`);stable=value&&previous&&Math.abs(value.x-previous.x)<.25&&Math.abs(value.y-previous.y)<.25?stable+1:0;previous=value;if(stable>=3)return value;await pause(150);return null;},'Visible enabled control '+selector);
  const scale=await evaluate('devicePixelRatio'),current=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>row.id===target.id),origin=JSON.parse(current.description);assert.ok(Number.isFinite(origin.screenX)&&Number.isFinite(origin.screenY),'Observed native WebView origin');adb('shell','input','tap',String(Math.round(origin.screenX+rect.x*scale)),String(Math.round(origin.screenY+rect.y*scale)));await pause(300);
 }
 async function fill(selector,value){await click(selector);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),'','Expected fresh input');await command('Input.insertText',{text:value});adb('shell','input','keyevent','4');await pause(300);}
 async function request(method,payload={}){return evaluate(`(async()=>{const key='auth-observe-'+crypto.randomUUID();return await new Promise((resolve,reject)=>{const old=window.__durableReceive,timer=setTimeout(()=>{window.__durableReceive=old;reject(Error('Public observation timeout'))},15000);window.__durableReceive=value=>{old?.(value);if(value.requestId===key){clearTimeout(timer);window.__durableReceive=old;value.ok?resolve(value.value):reject(Error(JSON.stringify(value.error)))}};window.DurableNative.postMessage(JSON.stringify({protocol:1,connectionId:key,requestId:key,method:${JSON.stringify(method)},payload:${JSON.stringify(payload)}}))})})()`);}
 async function shot(label){assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(syntheticInvalidKey)})`),false);await writeFile(`${outputRoot}-${label}.png`,execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}),{flag:'wx'});}
 await until(()=>evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Models owner ready');
 const initial=await request('models.get');assert.equal(initial.version,0);assert.equal(initial.connections.length,0);assert.equal(initial.defaultModel,null);assert.equal((await request('list')).conversations.length,0);
 if(await evaluate("(()=>{const e=document.querySelector('[aria-label=\"打开会话列表\"]');return !!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0})()"))await click('[aria-label="打开会话列表"]');
 await click('[data-testid=open-model-settings]');
 await fill('[data-testid=connection-name]','真实服务鉴权失败验证');await click('[data-testid=add-connection]');
 await until(()=>evaluate("document.querySelectorAll('[data-testid=connection-card]').length===1"),'Dedicated connection');
 const connectionId=await evaluate("document.querySelector('[data-testid=connection-card]').dataset.connectionId");evidence.connectionId=connectionId;
 const configured=await request('models.get');assert.equal(configured.connections.length,1);assert.equal(configured.connections[0].id,connectionId);assert.equal(configured.connections[0].protocol,'mimo-cn');assert.equal(configured.connections[0].endpoint,'https://token-plan-cn.xiaomimimo.com/v1');
 evidence.endpoint=configured.connections[0].endpoint;evidence.model='mimo-v2.6-flash';
 await fill('[data-testid=credential-input]',syntheticInvalidKey);await click('[data-testid=credential-save]');
 await until(()=>evaluate("document.querySelector('[data-testid=credential-status]')?.dataset.state==='configured'&&document.querySelector('[data-testid=credential-input]')?.value===''"),'Encrypted synthetic credential stored and input cleared');
 await evaluate(`(()=>{const e=document.querySelector('[data-testid=default-model]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify([connectionId,'mimo-v2.6-flash']))});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await click('[data-testid=default-model-apply]');await until(async()=>{const value=await request('models.get');return value.defaultModel?.provider===connectionId&&value.defaultModel?.modelId==='mimo-v2.6-flash';},'Dedicated default selected');
 await click('[aria-label="返回会话"]');await click('[data-testid=create-conversation]');
 await until(()=>evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false"),'New conversation editor');
 const id=await evaluate("localStorage.getItem('durableagent.ui.selectedConversation')");assert.match(id,/^[-a-zA-Z0-9_]{1,128}$/);evidence.conversationId=id;
 const message='验证真实服务在无效凭据下给出明确错误。';await fill('[data-testid=message-input]',message);
 await until(()=>evaluate("document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'"),'Input saved');
 assert.equal((await request('input.listSends',{id})).intents.length,0);await click('[data-testid=send-message]');evidence.explicitSendClicks=1;
 await until(()=>evaluate("document.querySelector('[data-testid=conversation-status]')?.dataset.phase==='failed'"),'Actual service terminal failure',90000);
 const failure=await evaluate("({phase:document.querySelector('[data-testid=conversation-status]')?.dataset.phase,title:document.querySelector('.failure-notice strong')?.textContent,guidance:document.querySelector('.failure-notice p')?.textContent,rawReason:document.querySelector('.failure-notice pre')?.textContent,action:document.querySelector('.failure-notice button')?.textContent})");evidence.failure=failure;
 assert.equal(failure.phase,'failed');assert.match(failure.rawReason,/\b401\b/);assert.match(failure.title,/鉴权失败.*401/);assert.match(failure.guidance,/模型服务拒绝了当前凭据/);assert.equal(failure.action,'检查模型与凭据');
 await evaluate("document.querySelector('.failure-notice').scrollIntoView({block:'center'})");await pause(500);await shot('guidance');
 await click('.failure-notice summary');await pause(300);await shot('raw-401');
 const before={intents:await request('input.listSends',{id}),history:await request('history',{id,limit:30}),context:await request('context.get',{id})};evidence.beforeNavigation=before;
 assert.equal(before.intents.intents.length,1);assert.equal(before.history.items.filter(row=>row.role==='user'&&row.text===message).length,1);
 await click('.failure-notice button');await until(()=>evaluate(`document.querySelector('[data-testid=connection-card]')?.dataset.connectionId===${JSON.stringify(connectionId)}`),'Original connection settings reached');
 const after={intents:await request('input.listSends',{id}),history:await request('history',{id,limit:30})};evidence.afterNavigation=after;assert.deepEqual(after.intents,before.intents);assert.deepEqual(after.history,before.history);await shot('settings');
 assert.equal(JSON.stringify(evidence).includes(syntheticInvalidKey),false);evidence.passed=true;
}catch(error){evidence.error=String(error).replaceAll(syntheticInvalidKey,'[synthetic key redacted]').replaceAll(serial,'[device]');throw Error(evidence.error);}
finally{socket?.close();if(port)adb('forward','--remove',`tcp:${port}`);evidence.completed=new Date().toISOString();await writeFile(`${outputRoot}.json`,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({passed:true,run,conversationId:evidence.conversationId,failure:evidence.failure,output:`${outputRoot}.json`}));
