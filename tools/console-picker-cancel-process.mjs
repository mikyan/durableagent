// Root-only actual Android picker cancellation + UI SIGKILL regression. No sends or credentials.
// Caller holds the device lease and has closed its previous validation owner.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const [serial,outputRoot]=process.argv.slice(2);
assert.ok(serial&&outputRoot,'Explicit device and new output prefix required');
const adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const pkg='dev.durableagent.probe',run=randomUUID(),original='取消选择前的原草稿',edited='选择器打开期间继续编辑的草稿 🌍';
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=45000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await read();if(last)return last;}catch(error){last=String(error);}await pause(100);}throw Error(`${label}: ${JSON.stringify(last)}`);}
async function attach(){
 const pid=await until(()=>adb('shell','pidof',pkg),'UI PID');assert.match(pid,/^\d+$/);
 await until(()=>adb('shell','cat','/proc/net/unix').includes(`webview_devtools_remote_${pid}`),'WebView socket');
 const port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);let socket;
 try{
  const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>row.type==='page'&&row.url==='https://appassets.androidplatform.net/assets/ui/index.html'),'Bundled WebView');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',({data})=>{const value=JSON.parse(data),call=pending.get(value.id);if(!call)return;pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);});
  const command=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  return {pid,evaluate,close:()=>{socket.close();adb('forward','--remove',`tcp:${port}`);}};
 }catch(error){socket?.close();adb('forward','--remove',`tcp:${port}`);throw error;}
}
let page;const evidence={run,mode:'fixture',started:new Date().toISOString(),scope:'Actual ACTION_OPEN_DOCUMENT cancellation with a concurrent edit delivered to retained React while system picker is foreground; then real UI SIGKILL and native observation. No model input or Termux action.'};
const draft=()=>page.evaluate("({text:document.querySelector('[data-testid=message-input]')?.value,state:document.querySelector('[data-testid=draft-status]')?.dataset.state,busy:document.querySelector('[data-testid=add-attachment]')?.disabled,historyItems:document.querySelectorAll('[data-testid=history-message]').length})");
const edit=text=>page.evaluate(`(()=>{const e=document.querySelector('[data-testid=message-input]');if(!e||e.disabled)throw Error('Editor unavailable');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function click(selector){await until(()=>page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`),'Enabled '+selector);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function request(method,payload){return page.evaluate(`(async()=>{const key='picker-'+crypto.randomUUID();return await new Promise((resolve,reject)=>{const old=window.__durableReceive,timer=setTimeout(()=>{window.__durableReceive=old;reject(Error('Public input observation timeout'))},15000);window.__durableReceive=value=>{old?.(value);if(value.requestId===key){clearTimeout(timer);window.__durableReceive=old;value.ok?resolve(value.value):reject(Error(JSON.stringify(value.error)))}};window.DurableNative.postMessage(JSON.stringify({protocol:1,connectionId:key,requestId:key,method:${JSON.stringify(method)},payload:${JSON.stringify(payload)}}))})})()`);}
async function screenshot(label){await writeFile(`${outputRoot}-${label}.png`,execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}),{flag:'wx'});}
try{
 adb('shell','am','start','-W','-n',`${pkg}/.AgentActivity`,'--es','validationMode','fixture','--es','validationRun',run);
 page=await attach();await until(()=>page.evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Fixture owner ready');
 await click('[data-testid=create-conversation]');await until(()=>page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false"),'Draft editor');
 const id=await page.evaluate("localStorage.getItem('durableagent.ui.selectedConversation')");assert.match(id,/^[-a-zA-Z0-9_]{1,128}$/);evidence.conversationId=id;
 await edit(original);await until(async()=>{const value=await draft();return value.text===original&&value.state==='saved';},'Original draft committed');
 const originalNative=await request('input.inspect',{id});assert.equal(originalNative.text,original);assert.equal(originalNative.selections.length,0);
 const resolver=adb('shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.OPEN_DOCUMENT','-c','android.intent.category.OPENABLE','-t','text/*');
 const pickerComponent=resolver.split(/\r?\n/).find(line=>/^[\w.]+\/[\w.$]+$/.test(line));assert.ok(pickerComponent,'System document picker resolves');const pickerPackage=pickerComponent.split('/')[0];assert.notEqual(pickerPackage,pkg);evidence.pickerComponent=pickerComponent;
 await click('[data-testid=add-attachment]');await until(()=>page.evaluate("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent==='选择文件')"),'File menu');
 await page.evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent==='选择文件').click()");
 const focused=()=>adb('shell','dumpsys','window','windows').split('\n').find(line=>line.includes('mCurrentFocus='))??'';
 evidence.pickerFocus=await until(()=>{const value=focused();return value.includes(`${pickerPackage}/`)&&value;},'Actual external picker foreground');
 await screenshot('picker');await edit(edited);
 // A real timer on the retained WebView runs after its ordinary debounce/max-save timers.
 await page.evaluate("globalThis.__pickerTimerElapsed=false;setTimeout(()=>{globalThis.__pickerTimerElapsed=true},1200)");
 await until(()=>page.evaluate('globalThis.__pickerTimerElapsed===true'),'Real WebView autosave interval');
 evidence.pending=await draft();assert.equal(evidence.pending.text,edited);assert.equal(evidence.pending.state,'pending');assert.equal(evidence.pending.busy,true);assert.equal((await request('input.inspect',{id})).text,original);
 assert.ok(focused().includes(`${pickerPackage}/`));adb('shell','input','keyevent','4');
 await until(()=>focused().includes(`${pkg}/`),'Returned from actual picker');
 await until(async()=>{const value=await draft();return value.text===edited&&value.state==='saved'&&value.busy===false;},'Concurrent edit automatically saved after cancellation');
 evidence.saved=await request('input.inspect',{id});assert.equal(evidence.saved.text,edited);assert.equal(evidence.saved.selections.length,0);assert.equal((await request('input.listSends',{id})).intents.length,0);assert.equal((await draft()).historyItems,0);await screenshot('saved');
 const before={uiPid:page.pid,agentPid:adb('shell','pidof',`${pkg}:agent`)};assert.match(before.agentPid,/^\d+$/);evidence.before=before;page.close();page=null;
 adb('shell','run-as',pkg,'kill','-9',before.uiPid);
 await until(()=>!adb('shell','ps','-A','-o','PID,NAME').split('\n').some(line=>new RegExp(`^\\s*${before.uiPid}\\s`).test(line)),'Old UI PID exited');
 assert.equal(adb('shell','pidof',`${pkg}:agent`),before.agentPid);
 await until(()=>{let replacement='';try{replacement=adb('shell','pidof',pkg);}catch{}return replacement&&replacement!==before.uiPid||!adb('shell','dumpsys','activity','activities').split('\n').some(line=>/\* Hist\s+#\d+:/.test(line)&&line.includes(`${pkg}/.AgentActivity`));},'Dead Activity removed');
 adb('shell','am','start','-W','-n',`${pkg}/.AgentActivity`,'--es','validationMode','fixture','--es','validationRun',run);
 page=await attach();assert.notEqual(page.pid,before.uiPid);assert.equal(adb('shell','pidof',`${pkg}:agent`),before.agentPid);
 await until(async()=>{const value=await draft();return value.text===edited&&value.state==='saved';},'Draft restored after process death');
 evidence.after={uiPid:page.pid,agentPid:before.agentPid,draft:await draft(),native:await request('input.inspect',{id})};assert.equal(evidence.after.native.text,edited);assert.equal(evidence.after.native.selections.length,0);assert.equal(evidence.after.draft.historyItems,0);await screenshot('reopened');page.close();page=null;
 const observation=adb('shell','am','instrument','-w','-r','-e','pickerRun',run,'-e','pickerConversation',id,'-e','pickerAgentPid',before.agentPid,'-e','class','dev.durableagent.probe.ConsolePickerObservationTest#savedCancelledPickerDraftRemainsUnsentOnTheOriginalOwner',`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`);
 await writeFile(`${outputRoot}-observation.log`,observation+'\n',{flag:'wx'});assert.match(observation,/OK \(1 test\)/);assert.doesNotMatch(observation,/FAILURES!!!|INSTRUMENTATION_FAILED/);
 const match=observation.match(/INSTRUMENTATION_STATUS: consolePickerObservation=(.*)/);assert.ok(match);evidence.nativeObservation=JSON.parse(match[1]);assert.equal(evidence.nativeObservation.modelRequests,0);evidence.passed=true;
}catch(error){evidence.error=String(error).replaceAll(serial,'[device]');throw error;}
finally{page?.close();evidence.completed=new Date().toISOString();await writeFile(`${outputRoot}.json`,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({passed:true,run,conversationId:evidence.conversationId,before:evidence.before,afterUiPid:evidence.after.uiPid,output:`${outputRoot}.json`}));
