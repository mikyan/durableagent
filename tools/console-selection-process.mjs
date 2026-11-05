// Requires an isolated fixture domain and no active work. Caller stops its own fixture host before starting.
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
    const page=await until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();return pages.find(p=>{if(p.type!=='page'||!p.url?.includes('appassets'))return false;try{const d=JSON.parse(p.description);return d.attached&&d.visible&&d.width>0;}catch{return true;}});},'WebView page');
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
const active=async(page)=>page.evaluate("window.DurableNative.getUiPreference?.('selectedConversation') ?? localStorage.getItem('durableagent.ui.selectedConversation')");
const history=async(page)=>page.evaluate("Array.from(document.querySelectorAll('[data-testid=history-message]'),e=>({id:e.dataset.messageId,text:e.querySelector('.message-text').textContent,role:e.className}))");
async function ready(page){await until(()=>page.evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Application ready');}
const saved={run,mode,started:new Date().toISOString(),observed:[],scope:'Actual UI process SIGKILL/reopen of two confirmed text drafts, no observer binding; same native process, empty submitted histories. Exact model request counts are covered by separate instrumentation.'};
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
let page;
try{
  assert.equal(mode,'fixture','This test never provisions or sends to a model.');
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);
  const inputs=['第一份尚未发送的草稿 🌍\n'.repeat(60),'第二份独立草稿：引号"、反斜线\\、换行\n和中文🌍'];
  for(const text of inputs){
    const previous=saved.observed.at(-1)?.id; // UI preferences are shared across isolated validation domains.
    await until(()=>page.evaluate("document.querySelector('[data-testid=create-conversation]')?.disabled===false"),'Create enabled');
    await page.evaluate("document.querySelector('[data-testid=create-conversation]').click()");
    await until(async()=>{const selected=await active(page);return selected&&selected!==previous&&await page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false && document.querySelector('[data-testid=create-conversation]')?.disabled===false");},'New conversation settled');
    const id=await active(page);
    await page.evaluate(`(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await committed(page,text);saved.observed.push({id,text,...await draft(page)});
  }
  const before={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};assert.match(before.hostPid,/^\d+$/);
  saved.before=before;await screenshot(page,'before');page.close();page=null;
  adb('shell','run-as',pkg,'kill','-9',before.uiPid);
  await until(()=>!adb('shell','ps','-A','-o','PID,NAME').split('\n').some(line=>new RegExp(`^\\s*${before.uiPid}\\s`).test(line)),'Old UI PID exited');
  assert.equal(adb('shell','pidof',`${pkg}:agent`),before.hostPid);
  // Process death precedes ActivityTaskManager record removal. An immediate singleTop
  // start can be delivered to that dying record and then discarded by Android.
  await until(()=>{let replacement='';try{replacement=adb('shell','pidof',pkg);}catch{}return replacement&&replacement!==before.uiPid||!adb('shell','dumpsys','activity','activities').split('\n').some(line=>/\* Hist\s+#\d+:/.test(line)&&line.includes(`${pkg}/.AgentActivity`));},'Dead Activity removed or replacement UI started');
  adb('shell','am','start','-W','-n',`${pkg}/.AgentActivity`,'--es','validationMode',mode,'--es','validationRun',run);
  page=await attach();await ready(page);
  const after={uiPid:page.pid,hostPid:adb('shell','pidof',`${pkg}:agent`)};saved.after=after;assert.notEqual(after.uiPid,before.uiPid);assert.equal(after.hostPid,before.hostPid);
  saved.restoredSelected=await active(page);saved.expectedLastSelected=saved.observed[1].id;saved.lastSelectedRestored=saved.restoredSelected===saved.expectedLastSelected;assert.equal(saved.lastSelectedRestored,true,'Last selected conversation survives UI SIGKILL');
  // Draft durability does not depend on WebView's best-effort last-selected-page preference.
  await until(()=>page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false || document.querySelectorAll('[data-testid=conversation-item]').length===2"),'Restored navigation or draft editor');
  for(const expected of saved.observed){await visit(page,expected.id);await committed(page,expected.text);assert.deepEqual(await history(page),[]);}
  await screenshot(page,'after');Object.assign(saved,{before,after,passed:true,completed:new Date().toISOString()});
  await writeFile(`${outputRoot}.json`,JSON.stringify(saved,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:true,conversations:saved.observed.length,before,after,output:`${outputRoot}.json`})+'\n');
}catch(error){await writeFile(`${outputRoot}-failed.json`,JSON.stringify({...saved,error:String(error).replaceAll(serial,'[device]')},null,2)+'\n');throw error;}
finally{page?.close();}