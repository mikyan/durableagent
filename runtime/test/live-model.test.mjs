import test from 'node:test';
import assert from 'node:assert/strict';
import {liveModels} from '../dist/live-model.js';
import {fixtureTransport} from '../dist/transport.js';

test('a finite six-request validation budget permits three tool round trips and rejects a seventh HTTP request',async()=>{
 const original=globalThis.fetch,metrics={};let requests=0;
 globalThis.fetch=fixtureTransport({requested:()=>requests++,aborted:()=>{}});
 try {
  const live=liveModels('synthetic-validation-placeholder',patch=>Object.assign(metrics,patch),{forceEcho:false,maxRequests:6});
  const model=live.models.getModel(live.provider,live.model);
  const stream=()=>live.models.streamSimple(model,{messages:[{role:'user',content:'validation',timestamp:0}]}).result();
  for(let index=0;index<6;index++)assert.equal((await stream()).stopReason,'stop',`response ${index+1}`);
  assert.equal(requests,6);assert.equal(metrics.transportRequests,6);
  assert.equal((await stream()).stopReason,'error');
  assert.equal(requests,6,'over-budget dispatch must never reach the HTTP boundary');
 } finally {globalThis.fetch=original;}
});
