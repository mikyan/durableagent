// UI acceptance driver. Real bundled Android WebView and public controls/Interface only.
// Plans name their model boundary (console = synthetic HTTP response through real SDK).
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const [serial,planFile,output]=process.argv.slice(2);
assert.ok(serial&&planFile&&output,'device, plan JSON, output directory required');
const plan=JSON.parse(await readFile(planFile,'utf8'));
await mkdir(output,{recursive:true});
const adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000}).trim();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=60000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(error){last=String(error);}await wait(100);}throw Error(label+' timed out: '+JSON.stringify(last));}
if(plan.launch?.restart)adb('shell','am','force-stop','dev.durableagent.probe');
if(plan.launch)adb('shell','am','start','-n','dev.durableagent.probe/.AgentActivity','--es','validationMode',plan.launch.mode,'--es','validationRun',plan.launch.run);
const pid=await until(()=>adb('shell','pidof','dev.durableagent.probe'),'UI PID');
await until(()=>adb('shell','cat','/proc/net/unix').includes('webview_devtools_remote_'+pid),'WebView socket');
const port=adb('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
let socket;const evidence={plan,started:new Date().toISOString(),pid,steps:[]};
try{
 const page=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(row=>{if(row.type!=='page'||!row.url?.startsWith('https://appassets.androidplatform.net/assets/ui/'))return false;try{const d=JSON.parse(row.description);return d.attached&&d.visible&&d.width>0;}catch{return true;}}),'WebView page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',({data})=>{const value=JSON.parse(data),call=pending.get(value.id);if(!call)return;pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const value=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 const nativeOrigin=async()=>{const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(row=>row.id===page.id);const bounds=JSON.parse(target.description);assert.ok(Number.isFinite(bounds.screenX)&&Number.isFinite(bounds.screenY),'Observed native WebView origin');return bounds;};
 async function click(selector){
  // IME and responsive layout may move a control after focus. Tap only a stable,
  // unobscured target; never retry a send automatically after the tap.
  let previous,stable=0;
  const rect=await until(async()=>{
   const value=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&r.top>=0&&r.bottom<=innerHeight&&hit&&e.contains(hit)?{x,y}:null})()');
   stable=value&&previous&&Math.abs(value.x-previous.x)<.25&&Math.abs(value.y-previous.y)<.25?stable+1:0;previous=value;
   if(stable>=3)return value;await wait(200);return null;
  },'stable visible control '+selector);
  const scale=await evaluate('devicePixelRatio'),origin=await nativeOrigin();adb('shell','input','tap',String(Math.round(origin.screenX+rect.x*scale)),String(Math.round(origin.screenY+rect.y*scale)));await wait(500);
 }
 for(const step of plan.steps){
  let value;
  if(step.when&&!await evaluate(step.when)){evidence.steps.push({step,skipped:true});continue;}
  if(step.back){adb('shell','input','keyevent','4');await wait(700);}
  if(step.swipe){const scale=await evaluate('devicePixelRatio'),origin=await nativeOrigin();const [x1,y1,x2,y2,time=350]=step.swipe;adb('shell','input','swipe',...[x1,y1,x2,y2].map((value,index)=>String(Math.round((index%2?origin.screenY:origin.screenX)+value*scale))),String(time));await wait(500);}
  if(step.wait)value=await until(()=>evaluate(step.wait),step.label||step.wait,step.timeout);
  if(step.click)await click(step.click);
  if(step.fill!==undefined){await click(step.selector||'[data-testid=message-input]');await command('Input.insertText',{text:step.fill});}
  if(step.evaluate)value=await evaluate(step.evaluate);
  if(step.request){
   value=await evaluate('(async()=>{const request='+JSON.stringify(step.request)+';const key="console-"+crypto.randomUUID();return await new Promise((resolve,reject)=>{const old=window.__durableReceive;const timer=setTimeout(()=>{window.__durableReceive=old;reject(Error("Public Interface timeout"))},20000);window.__durableReceive=value=>{old?.(value);if(value.requestId===key){clearTimeout(timer);window.__durableReceive=old;value.ok?resolve(value.value):reject(Error(JSON.stringify(value.error)))}};window.DurableNative.postMessage(JSON.stringify({protocol:1,connectionId:key,requestId:key,method:request.method,payload:request.payload??{}}))})})()');
  }
  if(step.shot){
   await wait(900);
   await writeFile(join(output,step.shot+'.png'),execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}));
   value=await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,title:document.querySelector("h1")?.textContent,active:localStorage.getItem("durableagent.ui.selectedConversation"),draft:document.querySelector("[data-testid=draft-status]")?.dataset.state,controls:[...document.querySelectorAll(".composer button,.panel-heading button,.topbar button")].filter(e=>e.getBoundingClientRect().width>0).map(e=>({label:e.getAttribute("aria-label")||e.textContent,disabled:e.disabled,rect:JSON.parse(JSON.stringify(e.getBoundingClientRect()))}))})');
   value.nativeView=await nativeOrigin();
   value.metadata=await evaluate('[...document.querySelectorAll(".draft-status,.context-pill")].map(e=>({label:e.textContent,rect:e.getBoundingClientRect().toJSON()}))');
  }
  evidence.steps.push({step,value});
  if(step.assert!==undefined)assert.deepEqual(value,step.assert,step.label||'public UI assertion');
 }
 evidence.passed=true;
}catch(error){evidence.error=String(error);throw error;}
finally{evidence.completed=new Date().toISOString();await writeFile(join(output,plan.name+'.json'),JSON.stringify(evidence,null,2)+'\n');socket?.close();adb('forward','--remove','tcp:'+port);}
