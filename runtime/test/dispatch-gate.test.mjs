import test from 'node:test';
import assert from 'node:assert/strict';
import {DispatchGate} from '../dist/dispatch-gate.js';
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
