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
const saved={run,mode,started:new Date().toISOString(),observed:[],scope:'Actual UI process SIGKILL/reopen, no observer binding; immutable completed history and same native process. Native request metrics are covered separately by instrumentation.'};
async function screenshot(page,stage){
  const viewport=await page.evaluate('({width:innerWidth,height:innerHeight})');
  saved[`${stage}Viewport`]=viewport;
  if(viewport.width===0||viewport.height===0){saved[`${stage}Screenshot`]='Not captured: WebView has no visible viewport (system keyguard). DOM assertions only.';return;}
  try{
    const shot=await page.command('Page.captureScreenshot',{format:'png'});
    await writeFile(`${outputRoot}-${stage}.png`,Buffer.from(shot.data,'base64'));
  }catch(error){saved[`${stage}Screenshot`]=`Screenshot unavailable: ${String(error)}. Functional DOM/process assertions remain separate; no visual acceptance claimed.`;}
}
let page;
try{
  adb('shell','am','force-stop',pkg);
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);
  const inputs=['请只回复一句中文问候，包含 UI-A。','请只回复一句中文问候，包含 UI-B。'];
  for(const input of inputs){
    const previous=await active(page);
    await until(()=>page.evaluate("document.querySelector('[data-testid=create-conversation]')?.disabled===false"),'Create enabled');
    await page.evaluate("document.querySelector('[data-testid=create-conversation]').click()");
    await until(async()=>{const selected=await active(page);return selected&&selected!==previous&&await page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false && document.querySelector('[data-testid=create-conversation]')?.disabled===false");},'New conversation settled');
    const id=await active(page);
    await page.evaluate(`(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(input)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(()=>page.evaluate("document.querySelector('[data-testid=send-message]')?.disabled===false"),'Send enabled');
    await page.evaluate("document.querySelector('[data-testid=send-message]').click()");
    await until(()=>page.evaluate("document.querySelector('[data-testid=conversation-status]')?.dataset.phase==='done' && document.querySelectorAll('[data-testid=history-message]').length===2"),'Reply persisted',120000);
    const messages=await history(page);assert.equal(messages[0].text,input);assert.ok(messages[1].text.length>0);
    saved.observed.push({id,messages});
  }
  const before={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};assert.match(before.hostPid,/^\d+$/);
  await screenshot(page,'before');
  page.close();page=null;
  // Kill only the UI PID under its own debug UID; preserve the started service and data.
  adb('shell','run-as',pkg,'kill','-9',before.uiPid);
  await until(()=>!adb('shell','ps','-A','-o','PID,NAME').split('\n').some(line=>new RegExp(`^\\s*${before.uiPid}\\s`).test(line)),'Old UI PID exited');
  assert.equal(adb('shell','pidof',`${pkg}:agent`),before.hostPid);
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);
  await until(()=>page.evaluate("document.querySelectorAll('[data-testid=history-message]').length===2"),'Restored selected history');
  const after={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};assert.notEqual(after.uiPid,before.uiPid);assert.equal(after.hostPid,before.hostPid);
  assert.equal(await active(page),saved.observed[1].id);assert.deepEqual(await history(page),saved.observed[1].messages);
  // Visit the first completed conversation through its actual navigation control.
  await page.evaluate("document.querySelector('[aria-label=返回首页]').click()");
  await until(()=>page.evaluate("document.querySelectorAll('[data-testid=conversation-item]').length===2"),'Two saved conversations');
  await page.evaluate(`document.querySelector('[data-conversation-id="${saved.observed[0].id}"]').click()`);
  await until(()=>page.evaluate("document.querySelectorAll('[data-testid=history-message]').length===2"),'First restored history');
  assert.deepEqual(await history(page),saved.observed[0].messages);
  await screenshot(page,'after');
  Object.assign(saved,{before,after,passed:true,completed:new Date().toISOString()});
  await writeFile(`${outputRoot}.json`,JSON.stringify(saved,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:true,conversations:saved.observed.length,before,after,output:`${outputRoot}.json`})+'\n');
}catch(error){await writeFile(`${outputRoot}-failed.json`,JSON.stringify({...saved,error:String(error).replaceAll(serial,'[device]')},null,2)+'\n');throw error;}
finally{page?.close();}
