// Real Android window/React regression. Unique input-only domains, no owner or model input.
// Caller holds an explicit device lease and has normally closed its idle validation owner.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const [serial,outputRoot]=process.argv.slice(2);
assert.ok(serial&&outputRoot,'Explicit device and new output prefix required');
const adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const pkg='dev.durableagent.probe';
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=15000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await read();if(last)return last;}catch(error){last=String(error);}await pause(100);}throw Error(`${label}: ${JSON.stringify(last)}`);}
const evidence={started:new Date().toISOString(),scope:'Fresh Activity then two retained-Activity input-only domain switches; real menu hit targets must avoid Android system bars and accept physical taps. No model input or host.'};
let socket,port;
async function disconnect(){socket?.close();socket=null;if(port)adb('forward','--remove',`tcp:${port}`);port=null;}
async function connect(previousTarget){
 const pid=await until(()=>adb('shell','pidof',pkg),'UI process');assert.match(pid,/^\d+$/);
 await until(()=>adb('shell','cat','/proc/net/unix').includes(`webview_devtools_remote_${pid}`),'WebView socket');
 port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
 const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>{if(row.id===previousTarget||row.type!=='page'||row.url!=='https://appassets.androidplatform.net/assets/ui/index.html')return false;try{return JSON.parse(row.description).visible;}catch{return true;}}),'Visible new bundled page');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',({data})=>{const value=JSON.parse(data),call=pending.get(value.id);if(!call)return;pending.delete(value.id);clearTimeout(call.timer);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 await until(()=>evaluate("!!document.querySelector('[aria-label=\"打开会话列表\"]')"),'Menu ready');
 return {pid,target:target.id,evaluate};
}
async function inspect(page,label){
 // Let the initial Android/WebView layout finish; do not rotate/focus an editor to repair insets.
 await pause(700);
 const window=adb('shell','dumpsys','window');
 const status=window.match(/type=statusBars frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\] visible=true/);
 assert.ok(status,'Visible Android status bar frame');
 const nativeBottom=Number(status[4]);
 const activity=adb('shell','dumpsys','activity','activities').match(/topResumedActivity=ActivityRecord\{([^ ]+) u0 dev\.durableagent\.probe\/.AgentActivity/);
 assert.ok(activity,'Resumed application Activity');
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row=>row.id===page.target);
 const nativeView=JSON.parse(target.description);
 assert.ok(Number.isFinite(nativeView.screenX)&&Number.isFinite(nativeView.screenY),'Observed native WebView origin');
 const dom=await page.evaluate(`(()=>{const e=document.querySelector('[aria-label="打开会话列表"]'),r=e.getBoundingClientRect();return {dpr:devicePixelRatio,width:innerWidth,height:innerHeight,topPadding:getComputedStyle(document.querySelector('.main')).paddingTop,rect:JSON.parse(JSON.stringify(r)),expanded:e.getAttribute('aria-expanded'),scrollY,viewportY:visualViewport.offsetTop}})()`);
 const value={uiPid:page.pid,webViewTarget:page.target,activity:activity[1],nativeStatusBottom:nativeBottom,nativeView,dom};evidence[label]=value;
 await writeFile(`${outputRoot}-${label}.png`,execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}),{flag:'wx'});
 value.physicalMenuTop=nativeView.screenY+dom.rect.top*dom.dpr;
 value.unobscured=value.physicalMenuTop>=nativeBottom;
 if(!value.unobscured)return value; // Still observe both retained-Activity switches before failing.
 assert.ok(dom.rect.left>=0&&dom.rect.right<=dom.width&&dom.rect.bottom<=dom.height,`${label}: menu remains in viewport`);
 assert.equal(dom.expanded,'false');
 adb('shell','input','tap',String(Math.round(nativeView.screenX+(dom.rect.x+dom.rect.width/2)*dom.dpr)),String(Math.round(nativeView.screenY+(dom.rect.y+dom.rect.height/2)*dom.dpr)));
 await until(()=>page.evaluate("document.querySelector('[aria-label=\"打开会话列表\"]')?.getAttribute('aria-expanded')==='true'"),'Physical menu tap opened navigation');
 await pause(400); // Allow the visible drawer transition to finish before its screenshot.
 value.physicalMenuTapOpened=true;
 await writeFile(`${outputRoot}-${label}-opened.png`,execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}),{flag:'wx'});
 return value;
}
try{
 assert.ok(!adb('shell','dumpsys','activity','services',`${pkg}/.ApplicationService`).includes('ServiceRecord{'),'Caller must normally close idle owner before test');
 let previousTarget;
 for(const label of ['fresh','reused','reusedAgain']){
  const run=randomUUID();evidence[label+'Run']=run;
  const launch=adb('shell','am','start','-W',...(label==='fresh'?['-f','0x10008000']:[]),'-n',`${pkg}/.AgentActivity`,'--es','validationMode','input-only','--es','validationRun',run);
  evidence[label+'Launch']=launch;
  const page=await connect(previousTarget);previousTarget=page.target;await inspect(page,label);
  if(label!=='fresh'){assert.equal(evidence[label].activity,evidence.fresh.activity,'Same Activity handles domain switch');assert.equal(evidence[label].uiPid,evidence.fresh.uiPid);assert.notEqual(evidence[label].webViewTarget,evidence.fresh.webViewTarget,'New bundled WebView');}
  await disconnect();
 }
 for(const label of ['fresh','reused','reusedAgain'])assert.ok(evidence[label].unobscured,`${label}: entire menu target overlaps Android status bar (${evidence[label].physicalMenuTop} < ${evidence[label].nativeStatusBottom})`);
 assert.ok(!adb('shell','dumpsys','activity','services',`${pkg}/.ApplicationService`).includes('ServiceRecord{'),'Input-only observation never opens owner');
 evidence.passed=true;
}catch(error){evidence.error=String(error).replaceAll(serial,'[device]');throw Error(evidence.error);}
finally{await disconnect();evidence.completed=new Date().toISOString();await writeFile(`${outputRoot}.json`,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({passed:true,output:`${outputRoot}.json`}));
