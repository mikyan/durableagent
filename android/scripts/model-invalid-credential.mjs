import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {join} from 'node:path';

const [serial, outputRoot] = process.argv.slice(2);
if (!serial || !outputRoot) throw Error('Usage: node model-invalid-credential.mjs <device> <output-prefix>');
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
let page;
async function click(id){await until(()=>page.evaluate(`document.querySelector('[data-testid=${id}]')?.disabled===false`),`${id} enabled`);await page.evaluate(`document.querySelector('[data-testid=${id}]').click()`);}
async function input(id,value,tag='HTMLInputElement'){await page.evaluate(`(()=>{const e=document.querySelector('[data-testid=${id}]');Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${tag==='HTMLSelectElement'?'change':'input'}',{bubbles:true}));})()`);}
try {
  adb('shell','am','force-stop',pkg);
  adb('shell','am','start','-n',`${pkg}/.AgentActivity`,'--es','validationMode','models','--es','validationRun',run);
  page=await attach();
  await until(()=>page.evaluate("document.querySelector('[data-testid=application]')?.dataset.status==='ready'"),'Application ready');
  await page.evaluate("(()=>{const menu=document.querySelector('[aria-label=\"打开会话列表\"]');if(menu&&getComputedStyle(menu).display!=='none')menu.click();})()");
  await click('open-model-settings');
  await until(()=>page.evaluate("document.querySelector('[data-testid=connection-name]')?.disabled===false"),'Settings loaded');
  await input('connection-name','真实服务鉴权失败验证');await click('add-connection');
  await until(()=>page.evaluate("!!document.querySelector('[data-testid=connection-card]')"),'Connection created');
  const connectionId=await page.evaluate("document.querySelector('[data-testid=connection-card]').dataset.connectionId");
  const syntheticInvalidKey='synthetic-invalid-mimo-device-validation-000';
  await input('credential-input',syntheticInvalidKey);await click('credential-save');
  await until(()=>page.evaluate("document.querySelector('[data-testid=credential-status]')?.dataset.state==='configured'"),'Key saved');
  await input('default-model',JSON.stringify([connectionId,'mimo-v2.6-flash']),'HTMLSelectElement');await click('default-model-apply');
  await until(()=>page.evaluate("document.querySelector('[data-testid=default-model-apply]')?.disabled===true"),'Default committed');
  await page.evaluate("document.querySelector('[aria-label=\"返回会话\"]').click()");
  await click('create-conversation');
  await until(()=>page.evaluate("document.querySelector('[data-testid=message-input]')?.disabled===false"),'Conversation ready');
  await input('message-input','验证真实服务在无效凭据下给出明确错误。','HTMLTextAreaElement');await click('send-message');
  await until(()=>page.evaluate("document.querySelector('[data-testid=conversation-status]')?.dataset.phase==='failed'"),'Real authentication failure',90000);
  const result=await page.evaluate("({phase:document.querySelector('[data-testid=conversation-status]').dataset.phase,reason:document.querySelector('[data-testid=conversation-status]').textContent,messages:Array.from(document.querySelectorAll('[data-testid=history-message]'),e=>({id:e.dataset.messageId,text:e.querySelector('.message-text').textContent,role:e.className})),allText:document.body.textContent,width:innerWidth,height:innerHeight})");
  assert.equal(result.phase,'failed');assert.match(result.reason,/401|invalid|authentication|auth|鉴权|认证|凭据/i);assert.ok(!result.allText.includes(syntheticInvalidKey));delete result.allText;
  const evidence={passed:true,run,connectionId,endpoint:'https://token-plan-cn.xiaomimimo.com/v1',model:'mimo-v2.6-flash',scope:'Actual React/native vault/SDK request to real MiMo endpoint using deliberately invalid synthetic key; failure observed through public UI, no real private key used.',result};
  await writeFile(`${outputRoot}.json`,JSON.stringify(evidence,null,2)+'\n');
  if(result.width>0&&result.height>0){try{const shot=await page.command('Page.captureScreenshot',{format:'png'});await writeFile(`${outputRoot}.png`,Buffer.from(shot.data,'base64'));}catch{}}
  process.stdout.write(JSON.stringify({passed:true,phase:result.phase,reason:result.reason})+'\n');
} finally {page?.close();}
