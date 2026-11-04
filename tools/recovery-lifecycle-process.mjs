// Root-only real product UI lifecycle preparation/verification. Never instrumentation.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const [stage,serial,output,preparedPath,proofPath]=process.argv.slice(2);
assert.ok(['prepare','verify'].includes(stage)&&serial&&output,'stage serial new-output-prefix [prepared-json external-proof-json]');
const pkg='dev.durableagent.probe',adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(value)return value;await pause(150);}throw Error(label+' timed out');}
function pid(name){try{return adb('shell','pidof',name);}catch{return '';}}
async function attach(){
 const uiPid=await until(()=>pid(pkg),'UI PID');assert.match(uiPid,/^\d+$/);
 await until(()=>adb('shell','cat','/proc/net/unix').includes(`webview_devtools_remote_${uiPid}`),'WebView socket');
 const port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${uiPid}`);let socket;
 try{
  const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>row.type==='page'&&row.url==='https://appassets.androidplatform.net/assets/ui/index.html'),'Bundled WebView');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();socket.addEventListener('message',({data})=>{const value=JSON.parse(data),call=pending.get(value.id);if(!call)return;pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  return {uiPid,command,evaluate,close:()=>{socket.close();adb('forward','--remove',`tcp:${port}`);}};
 }catch(error){socket?.close();adb('forward','--remove',`tcp:${port}`);throw error;}
}
let page;const evidence={stage,startedAt:new Date().toISOString(),mode:'product',instrumentationUsed:false};
async function request(method,payload={}){
 assert.ok(['list','models.get','open','sendStatus','input.inspect','input.listSends','history','execution.list'].includes(method),'Read-only public observer methods only');
 return page.evaluate(`new Promise((resolve,reject)=>{const key='lifecycle-observer-'+crypto.randomUUID(),old=window.__durableReceive;const timer=setTimeout(()=>{window.__durableReceive=old;reject(Error('Public observation timeout'))},20000);window.__durableReceive=value=>{old?.(value);if(value.requestId===key){clearTimeout(timer);window.__durableReceive=old;value.ok?resolve(value.value):reject(Error(JSON.stringify(value.error)))}};window.DurableNative.postMessage(JSON.stringify({protocol:1,connectionId:key,requestId:key,method:${JSON.stringify(method)},payload:${JSON.stringify(payload)}}));})`);
}
async function pointer(selector){
 const point=await until(()=>page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),v=visualViewport;const x=r.left+r.width/2,y=r.top+r.height/2;if(r.width<=0||r.height<=0||r.top<(v?.offsetTop??0)||r.bottom>(v?.offsetTop??0)+(v?.height??innerHeight)||r.left<0||r.right>innerWidth||!e.contains(document.elementFromPoint(x,y)))return null;return {x,y}})()`),'Visible enabled control '+selector);
 await page.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await page.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
}
async function screenshot(label){const shot=await page.command('Page.captureScreenshot',{format:'png'});await writeFile(`${output}-${label}.png`,Buffer.from(shot.data,'base64'),{flag:'wx'});}
const activityRecords=()=>adb('shell','dumpsys','activity','activities').split('\n').filter(line=>/\* Hist\s+#\d+:/.test(line)&&line.includes(`${pkg}/.AgentActivity`));
try{
 let prepared,proof;
 if(stage==='verify'){
  assert.ok(preparedPath&&proofPath,'Verify requires original prepared and external completed evidence');prepared=JSON.parse(await readFile(preparedPath,'utf8'));proof=JSON.parse(await readFile(proofPath,'utf8'));
  assert.equal(proof.completed,true);assert.equal(proof.product,prepared.product);assert.equal(proof.run,prepared.run);assert.equal(proof.observerStartedTarget,false);assert.equal(prepared.prepared,true);
 }
 assert.equal(activityRecords().length,0,'Root must close earlier Activity before this isolated lifecycle stage');
 adb('shell','am','start','-W','-n',`${pkg}/.AgentActivity`,'--es','validationMode','product');page=await attach();
 await until(()=>page.evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Real product ready');
 if(stage==='prepare'){
  assert.equal(adb('shell','settings','get','global','wifi_on'),'0','Actual Wi-Fi disabled by root');assert.equal(adb('shell','settings','get','global','mobile_data'),'0','Actual mobile data disabled by root');
  const before=(await request('list')).conversations;assert.ok(before.every(row=>!['running','waiting'].includes(row.phase)),'No other active product work');
  const configuration=await request('models.get');assert.equal(configuration.defaultModel?.provider,'recovery-validation');assert.equal(configuration.defaultModel?.modelId,'mimo-v2.6-flash');const connection=configuration.connections.find(row=>row.id==='recovery-validation');assert.equal(connection?.credential.configured,true);assert.equal(connection.protocol,'mimo-cn');
  const run=randomUUID(),text=`这是恢复验证。只回复 T12-LIFECYCLE-${run}，不调用工具。`;Object.assign(evidence,{run,text,credentialGeneration:connection.credential.generation,configurationVersion:configuration.version});
  await pointer('[data-testid=create-conversation]');const product=await until(async()=>{const rows=(await request('list')).conversations.filter(row=>!before.some(old=>old.id===row.id));assert.ok(rows.length<=1,'Exactly one creation');return rows[0]?.id;},'New product conversation');evidence.product=product;
  await until(()=>page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false"),'Editable draft');assert.equal((await request('open',{id:product})).conversation.model.provider,'recovery-validation');
  await page.evaluate(`(()=>{const input=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(()=>page.evaluate(`document.querySelector('[data-testid=message-input]')?.value===${JSON.stringify(text)}&&document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'`),'UI save receipt for exact text');
  const draft=await request('input.inspect',{id:product});assert.equal(draft.text,text);assert.equal(draft.committed,true);assert.ok(draft.revision>0);
  await pointer('[data-testid=send-message]');evidence.explicitSendClicks=1;
  await until(async()=>{const state=await page.evaluate("({rows:[...document.querySelectorAll('[data-testid=submission-item]')].map(e=>({id:e.dataset.intentId,stage:e.dataset.stage})),error:document.querySelector('.send-error')?.textContent,confirming:document.querySelector('[data-testid=draft-status]')?.textContent.includes('正在确认操作')})");assert.ok(state.rows.length<=1,'One explicit UI send identity');if(state.error)throw Error('Actual UI send failed: '+state.error);return state.rows.length===1&&['accepted','queued','placed','settled'].includes(state.rows[0].stage)&&!state.confirming;},'UI confirms original send without native observer contention');
  const intents=(await request('input.listSends',{id:product})).intents;assert.equal(intents.length,1);const intent=intents[0];evidence.intentId=intent.intentId;
  const status=await request('sendStatus',{intentId:intent.intentId});assert.ok(status.receipt,'Durable SDK admission');
  const waiting=await until(async()=>{const value=await request('open',{id:product});return value.recovery?.reason==='network-offline'&&value;},'Actual offline wait');
  evidence.admission=status.receipt;evidence.waiting=waiting.recovery;evidence.history=await request('history',{id:product});evidence.ownerPid=pid(`${pkg}:agent`);assert.match(evidence.ownerPid,/^\d+$/);assert.equal((await request('execution.list',{id:product})).executions.length,0);await screenshot('prepared');
  page.close();page=null;adb('shell','input','keyevent','4');await until(()=>activityRecords().length===0,'Activity naturally finished');assert.equal(pid(`${pkg}:agent`),evidence.ownerPid,'Same owner remains after all clients leave');
  const services=adb('shell','dumpsys','activity','services',pkg);const ownerRecords=services.split(/(?=  \* ServiceRecord\{)/).filter(block=>/^  \* ServiceRecord\{[^\n]*dev\.durableagent\.probe\/\.ApplicationService\b/m.test(block));assert.equal(ownerRecords.length,1);assert.match(ownerRecords[0],/isForeground=true/);assert.match(ownerRecords[0],/startRequested=true/);await writeFile(`${output}-services.txt`,services+'\n',{flag:'wx'});
  Object.assign(evidence,{prepared:true,allUiAndCdpClosed:true,preparedAt:new Date().toISOString(),httpCountObserved:false});
 }else{
  const status=await request('sendStatus',{intentId:prepared.intentId});assert.equal(status.submission?.status,'done');assert.deepEqual(status.receipt,prepared.admission);
  const history=await request('history',{id:prepared.product});assert.deepEqual(history.items.filter(row=>row.role==='user').map(row=>row.text),[prepared.text]);assert.ok(history.items.filter(row=>row.role==='assistant').at(-1)?.text.includes(`T12-LIFECYCLE-${prepared.run}`));assert.equal((await request('execution.list',{id:prepared.product})).executions.length,0);
  Object.assign(evidence,{passed:true,product:prepared.product,intentId:prepared.intentId,admission:status.receipt,history,externalCompletedAt:proof.observedAt,completeHttpCountObserved:false});
  page.close();page=null;adb('shell','input','keyevent','4');await until(()=>activityRecords().length===0,'Observer Activity finishes');
 }
 await writeFile(`${output}.json`,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify({stage,product:evidence.product,prepared:evidence.prepared,passed:evidence.passed,evidence:`${output}.json`})+'\n');
}catch(error){
 if(page)try{evidence.dom=await page.evaluate("({draft:document.querySelector('[data-testid=draft-status]')?.textContent,sendError:document.querySelector('.send-error')?.textContent,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),phase:document.querySelector('[data-testid=conversation-status]')?.dataset.phase,viewport:{width:innerWidth,height:innerHeight}})");await screenshot('failed');}catch{}
 await writeFile(`${output}-failed.json`,JSON.stringify({...evidence,error:String(error).replaceAll(serial,'[device]')},null,2)+'\n',{flag:'wx'});throw error;
}finally{page?.close();}
