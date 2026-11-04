import test from 'node:test';
import assert from 'node:assert/strict';
import {continuationEligibility} from '../dist/execution-continuation.js';
test('continuation requires confirmed external scope and cannot clear a durable policy interruption',()=>{
 for(const state of ['completed','stopped','not_started']){
  assert.equal(continuationEligibility({state}),'verify-external');
  assert.equal(continuationEligibility({state,scopeConfirmed:true}),'proceed');
  assert.equal(continuationEligibility({state,scopeConfirmed:true},true),'policy-interrupted');
 }
 assert.equal(continuationEligibility({state:'unknown',source:'application',cancelReason:'network_policy'}),'verify-external');
 assert.equal(continuationEligibility({state:'unknown',cancelReason:'network_policy'}),'policy-interrupted');
 assert.equal(continuationEligibility({state:'running',scopeConfirmed:false}),'proceed');
});
