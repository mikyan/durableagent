// Read-only navigation of one explicitly supplied, completed FileApplicationTest domain.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const [serial,run,id,prefix]=process.argv.slice(2);
assert.ok(serial&&prefix&&/^[a-f0-9-]{36}$/.test(run)&&/^[a-f0-9-]{36}$/.test(id),'Explicit leased device, retained run/conversation and new absolute prefix required');
const request=method=>({request:{method,payload:{id,...(method==='history'?{limit:200}:{})}}});
const plan={name:'retained-file-diff',launch:{mode:'execution',run},steps:[
 {wait:"document.querySelector('[data-testid=application]')?.dataset.status==='ready'"},
 {evaluate:"localStorage.getItem('durableagent.ui.selectedConversation')",assert:id},
 request('open'),request('input.listSends'),request('history'),
 {when:"document.querySelector('button[aria-label=\"会话详情\"]')?.getAttribute('aria-expanded')==='false'",click:'button[aria-label="会话详情"]'},
 {evaluate:"(()=>{const e=document.querySelector('.details-panel > .detail-actions > button:first-child');if(!e||e.textContent!=='文件变更与执行')throw Error('Visible detail action missing');e.scrollIntoView({block:'center'});return e.textContent})()",assert:'文件变更与执行'},
 {click:'.details-panel > .detail-actions > button:first-child'},
 {click:'.file-changes > .execution-actions > button'},
 {wait:"[...document.querySelectorAll('.file-diff')].some(e=>e.textContent.includes('+真实修改-after'))"},
 {evaluate:"(()=>{const e=[...document.querySelectorAll('.file-diff')].find(e=>e.textContent.includes('+真实修改-after'));e.scrollIntoView({block:'center'});return e.textContent})()"},
 {wait:"(()=>{const e=[...document.querySelectorAll('.file-diff')].find(e=>e.textContent.includes('+真实修改-after'));if(!e)return false;const r=e.getBoundingClientRect(),a=document.querySelector('.auxiliary-scroll').getBoundingClientRect();return r.top>=Math.max(a.top,0)&&r.bottom<=Math.min(a.bottom,innerHeight)})()"},
 {shot:'retained-original-diff'},
 request('open'),request('input.listSends'),request('history')
]};
await writeFile(prefix+'-plan.json',JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
let error;try{execFileSync(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),'console-device.mjs'),serial,prefix+'-plan.json',prefix],{stdio:'inherit',timeout:180000});}catch(reason){error=reason;}
const result=JSON.parse(await readFile(join(prefix,'retained-file-diff.json'),'utf8'));
try{
 if(error)throw error;
 const reads=method=>result.steps.filter(row=>row.step.request?.method===method).map(row=>row.value);
 const phases=reads('open');assert.equal(phases.length,2);assert.equal(phases[0].phase,'done');assert.equal(phases[1].phase,'done');
 for(const method of ['input.listSends','history']){const values=reads(method);assert.equal(values.length,2);assert.deepEqual(values[0],values[1],method+' remains identical across navigation');}
 result.retainedObservation={run,conversationId:id,phase:'done',historyUnchanged:true,intentsUnchanged:true,noSendStep:true};
}catch(reason){result.passed=false;result.observationError=String(reason);error=reason;}
await writeFile(prefix+'-observation.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
if(error)throw error;
console.log(JSON.stringify(result.retainedObservation));
