// Focused native inset regression: real IME and rotation, one unsent fixture draft.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const [serial,prefix]=process.argv.slice(2);assert.ok(serial&&prefix,'Explicit leased device and new absolute output prefix required');
const pkg='dev.durableagent.probe',run=randomUUID(),draft='原生边距回归草稿 🌍';
const adbPath=process.env.ADB||join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence={run,draft,scope:'Actual portrait/landscape IME bounds and rotation retain one unsent draft. Fixture mode, no model input.',started:new Date().toISOString()};
async function plan(name,steps){
 const file=`${prefix}-${name}-plan.json`,output=`${prefix}-${name}`;
 await writeFile(file,JSON.stringify({name,steps},null,2)+'\n',{flag:'wx'});
 try{execFileSync(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),'console-device.mjs'),serial,file,output],{encoding:'utf8',timeout:90000});}
 finally{evidence[name]=JSON.parse(await readFile(join(output,name+'.json'),'utf8'));}
 return evidence[name];
}
function bounds(name){
 const record=evidence[name].steps.findLast(row=>row.step.shot)?.value;assert.ok(record,'Observed screenshot geometry');
 const dump=adb('shell','dumpsys','window');
 const status=dump.match(/type=statusBars frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\] visible=true/);
 const ime=dump.match(/type=ime frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\](?: visibleFrame=\S+)? visible=true/);
 evidence[name+'InsetSources']=dump.split('\n').filter(line=>/type=(ime|statusBars) frame=/.test(line));
 assert.ok(status&&ime,'Real system status bar and visible IME');
 const top=Number(status[4]),bottom=Number(ime[2]);evidence[name+'Bounds']={statusBottom:top,imeTop:bottom,nativeView:record.nativeView,controls:record.controls};
 assert.ok(record.nativeView.screenY>=top,'WebView avoids top status bar');
 assert.ok(record.nativeView.screenY+record.nativeView.height<=bottom,'Native viewport ends above IME');
 const send=record.controls.find(row=>row.label==='发送消息');assert.ok(send&&!send.disabled,'Unsent draft can still be explicitly sent');
 for(const control of record.controls.filter(row=>row.label==='发送消息'||row.label==='会话详情')){
  const actualTop=record.nativeView.screenY+control.rect.top*record.dpr,actualBottom=record.nativeView.screenY+control.rect.bottom*record.dpr;
  assert.ok(actualTop>=top&&actualBottom<=bottom,`${control.label} avoids system bars and IME`);
 }
 for(const metadata of record.metadata){assert.ok(record.nativeView.screenY+metadata.rect.top*record.dpr>=top&&record.nativeView.screenY+metadata.rect.bottom*record.dpr<=bottom,`${metadata.label} remains visible above IME`);}
}
let started=false;const baseline={ime:adb('shell','settings','get','secure','show_ime_with_hard_keyboard'),auto:adb('shell','settings','get','system','accelerometer_rotation'),rotation:adb('shell','settings','get','system','user_rotation')};evidence.baseline=baseline;
try{
 assert.ok(!adb('shell','dumpsys','activity','services',`${pkg}/.ApplicationService`).includes('ServiceRecord{'),'Caller must close previous idle owner');
 adb('shell','settings','put','secure','show_ime_with_hard_keyboard','1');
 adb('shell','am','start','-W','-f','0x10008000','-n',`${pkg}/.AgentActivity`,'--es','validationMode','fixture','--es','validationRun',run);started=true;
 await plan('portrait',[
  {wait:"document.querySelector('[data-testid=application]')?.dataset.status==='ready'"},
  {click:'[data-testid=create-conversation]'},
  {wait:"document.querySelector('[data-testid=message-input]')?.disabled===false"},
  {fill:draft},{wait:"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'"},
  {shot:'portrait-ime'},{evaluate:"localStorage.getItem('durableagent.ui.selectedConversation')"}
 ]);bounds('portrait');
 const id=evidence.portrait.steps.at(-1).value;evidence.conversationId=id;
 adb('shell','input','keyevent','4');await pause(500);
 adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');await pause(1000);
 await plan('landscape',[
  {wait:"innerWidth>innerHeight&&document.querySelector('[data-testid=message-input]')?.disabled===false"},
  {evaluate:"document.querySelector('[data-testid=message-input]').value",assert:draft},
  {click:'[data-testid=message-input]'},{shot:'landscape-ime'}
 ]);bounds('landscape');
 adb('shell','input','keyevent','4');await pause(500);
 adb('shell','settings','put','system','user_rotation',baseline.rotation);adb('shell','settings','put','system','accelerometer_rotation',baseline.auto);await pause(1000);
 await plan('restored',[
  {wait:"innerHeight>innerWidth&&document.querySelector('[data-testid=message-input]')?.disabled===false"},
  {evaluate:"document.querySelector('[data-testid=message-input]').value",assert:draft},
  {request:{method:'input.listSends',payload:{id}}},
  {request:{method:'history',payload:{id,limit:30}}},
  {request:{method:'input.read',payload:{id}}},
  {shot:'portrait-restored'}
 ]);
 assert.equal(evidence.restored.steps[2].value.intents.length,0);assert.equal(evidence.restored.steps[3].value.items.length,0);assert.equal(evidence.restored.steps[4].value.text,draft);
 evidence.passed=true;
}catch(error){evidence.error=String(error).replaceAll(serial,'[device]');throw Error(evidence.error);}
finally{
 const cleanup=async action=>{try{await action();}catch(error){(evidence.cleanupErrors??=[]).push({error:String(error).replaceAll(serial,'[device]'),exitStatus:error.status,stdout:error.stdout,stderr:error.stderr});}};
 await cleanup(()=>adb('shell','settings','put','system','user_rotation',baseline.rotation));await cleanup(()=>adb('shell','settings','put','system','accelerometer_rotation',baseline.auto));await cleanup(()=>adb('shell','settings','put','secure','show_ime_with_hard_keyboard',baseline.ime));
 if(started){await cleanup(()=>adb('shell','am','start','-W','-f','0x10008000','-n',`${pkg}/.AgentActivity`,'--es','validationMode','input-only','--es','validationRun',run));await pause(500);await cleanup(()=>{try{evidence.stopResult=adb('shell','run-as',pkg,'/system/bin/am','stopservice','--user','0','-n',`${pkg}/.ApplicationService`);}catch(error){if(error.status===255&&String(error.stderr).trim()==='Service stopped')evidence.stopResult={exitStatus:255,stdout:error.stdout,stderr:error.stderr};else throw error;}});}
 await cleanup(async()=>{const end=Date.now()+10000;do{evidence.finalService=adb('shell','dumpsys','activity','services',`${pkg}/.ApplicationService`);if(!evidence.finalService.includes('ServiceRecord{'))break;await pause(100);}while(Date.now()<end);});evidence.completed=new Date().toISOString();await writeFile(`${prefix}.json`,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
}
assert.ok(!evidence.finalService.includes('ServiceRecord{'),'Own idle owner is absent');console.log(JSON.stringify({passed:true,run,conversationId:evidence.conversationId,output:`${prefix}.json`}));
