import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {join} from 'node:path';

const [serial, outputRoot, mode='fixture'] = process.argv.slice(2);
if (!serial || !outputRoot || !['fixture','real'].includes(mode)) throw Error('Expected device, output prefix, mode');
const adbPath=process.env.ADB||(process.env.ANDROID_HOME?join(process.env.ANDROID_HOME,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):'adb');
const pkg='dev.durableagent.probe', run=randomUUID();
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=60000){const deadline=Date.now()+timeout;let last;while(Date.now()<deadline){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await pause(100);}throw Error(`${label} timeout: ${JSON.stringify(last)}`);}
async function attach(){
  const pid=await until(()=>adb('shell','pidof',pkg),'UI process');
  assert.match(pid,/^\d+$/);
  await until(()=>adb('shell','cat','/proc/net/unix').includes(`webview_devtools_remote_${pid}`),'WebView debug socket');
  const port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
  let socket;
  try{
    const page=await until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();return pages.find(p=>p.type==='page');},'WebView page');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let sequence=0;const pending=new Map();
    socket.addEventListener('message',({data})=>{const msg=JSON.parse(data);const call=pending.get(msg.id);if(!call)return;pending.delete(msg.id);clearTimeout(call.timer);msg.error?call.reject(Error(JSON.stringify(msg.error))):call.resolve(msg.result);});
    const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async(expression)=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const close=()=>{socket.close();adb('forward','--remove',`tcp:${port}`);};
    return {pid,command,evaluate,close};
  }catch(error){socket?.close();adb('forward','--remove',`tcp:${port}`);throw error;}
}
const active=async(page)=>page.evaluate("localStorage.getItem('durableagent.ui.selectedConversation')");
const history=async(page)=>page.evaluate("Array.from(document.querySelectorAll('[data-testid=history-message]'),e=>({id:e.dataset.messageId,text:e.querySelector('.message-text').textContent,role:e.className}))");
async function ready(page){await until(()=>page.evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Application ready');}
const saved={run,mode,started:new Date().toISOString(),observed:[],scope:'Actual UI process SIGKILL/reopen after durable SDK acceptance; same native process, same intent and receipt, exact newer unsent draft retained. Exact model request counts are covered by separate instrumentation.'};
async function screenshot(page,stage){
  const viewport=await page.evaluate('({width:innerWidth,height:innerHeight})');saved[`${stage}Viewport`]=viewport;
  if(viewport.width===0||viewport.height===0){saved[`${stage}Screenshot`]='Not captured: no visible viewport under system keyguard. DOM assertions only.';return;}
  try{const shot=await page.command('Page.captureScreenshot',{format:'png'});await writeFile(`${outputRoot}-${stage}.png`,Buffer.from(shot.data,'base64'));}
  catch(error){saved[`${stage}Screenshot`]=`Screenshot unavailable: ${String(error)}. No visual acceptance claimed.`;}
}
const draft=async(page)=>page.evaluate("({text:document.querySelector('[data-testid=message-input]')?.value,state:document.querySelector('[data-testid=draft-status]')?.dataset.state,historyItems:document.querySelectorAll('[data-testid=history-message]').length})");
async function committed(page,text){await until(async()=>{const value=await draft(page);return value.text===text&&value.state==='saved';},'Confirmed draft save');assert.equal((await draft(page)).historyItems,0);}
async function visit(page,id){
  await page.evaluate("document.querySelector('[aria-label=返回首页]')?.click()");
  await until(()=>page.evaluate(`!!document.querySelector('[data-conversation-id="${id}"]')`),'Saved conversation listed');
  await page.evaluate(`document.querySelector('[data-conversation-id="${id}"]').click()`);
  await until(()=>page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false"),'Draft editor enabled');
}
async function callOnce(page,method,payload={}){
  const request={protocol:1,connectionId:'root-submission-observer',requestId:randomUUID(),method,payload};
  return page.evaluate(`new Promise((resolve,reject)=>{
    if(!window.__rootSubmissionReplies){window.__rootSubmissionReplies=new Map();const prior=window.__durableReceive;window.__durableReceive=value=>{const reply=typeof value==='string'?JSON.parse(value):value;const pending=window.__rootSubmissionReplies.get(reply.requestId);if(pending){window.__rootSubmissionReplies.delete(reply.requestId);pending(reply);}prior?.(value);};}
    const request=${JSON.stringify(request)};const timer=setTimeout(()=>{window.__rootSubmissionReplies.delete(request.requestId);reject(Error('Public request timed out'));},10000);
    window.__rootSubmissionReplies.set(request.requestId,reply=>{clearTimeout(timer);reply.ok?resolve(reply.value):reject(Error(reply.error.code+': '+reply.error.message));});
    window.DurableNative.postMessage(JSON.stringify(request));
  })`);
}
async function call(page,method,payload={}){
  assert.ok(['list','history','sendList','sendStatus','input.inspect','input.listSends'].includes(method),'Read-only observer method required');
  for(let attempt=0;;attempt++)try{return await callOnce(page,method,payload);}catch(error){
    if(!String(error).includes('INPUT_STORAGE_BUSY')||attempt>=5)throw error;
    saved.observerBusyRetries=(saved.observerBusyRetries??0)+1;await pause(30);
  }
}
async function type(page,text){await page.evaluate(`(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
let page;
try{
  assert.equal(mode,'fixture','This process-death helper uses the controlled provider; cloud ACK repair has separate instrumentation.');
  adb('shell','am','force-stop',pkg);
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);
  await until(()=>page.evaluate("document.querySelector('[data-testid=create-conversation]')?.disabled===false"),'Create enabled');
  await page.evaluate("document.querySelector('[data-testid=create-conversation]').click()");
  const product=await until(async()=>{const list=await call(page,'list');return list.conversations?.length===1&&list.conversations[0];},'One product created');
  const id=product.id;await visit(page,id);
  const sent=`原发送 ${randomUUID()} 北京🌍`,newDraft='发送确认后的下一份草稿：保持原文\n不自动投递🌍';
  await type(page,sent);await until(()=>page.evaluate("document.querySelector('[data-testid=send-message]')?.disabled===false"),'Send enabled');
  await page.evaluate("document.querySelector('[data-testid=send-message]').click()");
  const original=await until(async()=>{const list=await call(page,'sendList',{id});return list.items?.length===1&&list.items[0].intent.delivery==='acknowledged'&&list.items[0].submission?.status==='done'&&list.items[0];},'Original send settled');
  const priorHistory=await call(page,'history',{id});assert.equal(priorHistory.items.filter(x=>x.role==='user').length,1);
  assert.equal(priorHistory.items.find(x=>x.role==='user').text,sent);
  await type(page,newDraft);await until(async()=>{const d=await call(page,'input.inspect',{id});return d.text===newDraft&&await page.evaluate("document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'");},'New draft durably saved');
  const beforeDraft=await call(page,'input.inspect',{id});
  const before={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};assert.match(before.hostPid,/^\d+$/);
  Object.assign(saved,{id,sent,newDraft,original,beforeDraft,priorHistory,before});await screenshot(page,'before');page.close();page=null;
  adb('shell','run-as',pkg,'kill','-9',before.uiPid);
  await until(()=>!adb('shell','ps','-A','-o','PID,NAME').split('\n').some(line=>new RegExp(`^\\s*${before.uiPid}\\s`).test(line)),'Old UI PID exited');
  assert.equal(adb('shell','pidof',`${pkg}:agent`),before.hostPid);
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);await visit(page,id);
  const after={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};assert.notEqual(after.uiPid,before.uiPid);assert.equal(after.hostPid,before.hostPid);
  await until(()=>page.evaluate(`document.querySelector('[data-testid=message-input]')?.value===${JSON.stringify(newDraft)} && document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'`),'Exact new draft in restored UI');
  await until(()=>page.evaluate(`document.querySelectorAll('[data-testid=submission-item]').length===1 && document.querySelector('[data-testid=submission-item]').dataset.intentId===${JSON.stringify(original.intent.intentId)}`),'Original intent shown in restored UI');
  const afterDraft=await call(page,'input.inspect',{id}),status=await call(page,'sendStatus',{intentId:original.intent.intentId}),afterHistory=await call(page,'history',{id});
  assert.equal(afterDraft.text,newDraft);assert.equal(afterDraft.revision,beforeDraft.revision);assert.equal(status.intent.intentId,original.intent.intentId);assert.deepEqual(status.receipt,original.receipt);assert.equal(status.intent.delivery,'acknowledged');assert.deepEqual(afterHistory,priorHistory);
  assert.equal((await call(page,'input.listSends',{id})).intents.length,1);
  await screenshot(page,'after');Object.assign(saved,{after,afterDraft,status,passed:true,completed:new Date().toISOString()});
  await writeFile(`${outputRoot}.json`,JSON.stringify(saved,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:true,before,after,intentCount:1,historyUserCount:1,draftRevision:afterDraft.revision,output:`${outputRoot}.json`})+'\n');
}catch(error){const message=String(error).replaceAll(serial,'[device]');await writeFile(`${outputRoot}-failed.json`,JSON.stringify({...saved,error:message},null,2)+'\n');throw Error(message);}
finally{page?.close();}
