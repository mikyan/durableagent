import test from 'node:test';
import assert from 'node:assert/strict';
import {DispatchGate} from '../dist/dispatch-gate.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
const model={api:'openai-completions',id:'synthetic',provider:'synthetic'};
for(const action of ['pause','abort'])test(`a ${action} immediately after stream request fences the actual model invocation`,async()=>{
 const gate=new DispatchGate();gate.release();let calls=0;const controller=new AbortController();const models=gate.models({streamSimple:()=>{calls++;return createAssistantMessageEventStream();}});
 const stream=models.streamSimple(model,{messages:[]},{signal:controller.signal});const release=action==='pause'?gate.pause():undefined;if(action==='abort')controller.abort();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);controller.abort();release?.();const result=await stream.result();assert.equal(result.stopReason,'aborted');assert.equal(calls,0);
});
test('concurrent dispatches share one control check and cannot repeatedly block one another',async()=>{
 const gate=new DispatchGate();gate.release();let checks=0,calls=0,tail=Promise.resolve();gate.check=()=>{const run=tail.then(async()=>{if(++checks>30)throw Error('bounded starvation probe');const release=gate.pause();try{await Promise.resolve();}finally{release();}});tail=run.catch(()=>{});return run;};
 const models=gate.models({streamSimple:()=>{calls++;const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'stop',message:{role:'assistant',content:[],stopReason:'stop',timestamp:Date.now()}});return stream;}});
 await Promise.all([models.streamSimple(model,{messages:[]}).result(),models.streamSimple(model,{messages:[]}).result()]);assert.equal(calls,2);assert.ok(checks<=2,`Repeated checks: ${checks}`);
});

test('readiness check failure preserves its safe category without pretending a user stop or exposing detail',async()=>{
 const {models}=validationConfiguration(),gate=new DispatchGate();
 gate.check=async()=>{throw Object.assign(new Error('private diagnostic must not escape'),{code:'INPUT_STORAGE_BUSY'});};gate.release();
 const model=models.getModel('fixture','conversation');
 const result=await gate.models(models).stream(model,{messages:[]}).result();
 assert.equal(result.stopReason,'error');assert.match(result.errorMessage,/INPUT_STORAGE_BUSY/);assert.match(result.errorMessage,/运行前检查/);assert.doesNotMatch(result.errorMessage,/private diagnostic|运行已停止/);
});

test('an actually aborted dispatch remains stopped and does not invoke the model',async()=>{
 let requests=0;const {models}=validationConfiguration({requested:()=>requests++}),gate=new DispatchGate(),abort=new AbortController();
 abort.abort();gate.release();
 const result=await gate.models(models).stream(models.getModel('fixture','conversation'),{messages:[]},{signal:abort.signal}).result();
 assert.equal(result.stopReason,'aborted');assert.equal(requests,0);
});
