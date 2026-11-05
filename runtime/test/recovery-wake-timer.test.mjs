import test from 'node:test';
import assert from 'node:assert/strict';
import {armRecoveryWake} from './fixtures/recovery-wake-timer.mjs';

function clock(){
 let at=0;const timers=[];
 return {timers,set now(value){at=value;},options:{now:()=>at,setTimer:(fire,delay)=>{const timer={fire,delay,cancelled:false};timers.push(timer);return timer;},clearTimer:timer=>{timer.cancelled=true;}}};
}

test('an early host timer keeps the unchanged SDK deadline armed and wakes once when due',()=>{
 const time=clock();let wakes=0;armRecoveryWake(100,()=>wakes++,time.options);
 assert.equal(time.timers[0].delay,100);
 time.now=99;time.timers[0].fire();assert.equal(wakes,0);assert.equal(time.timers[1].delay,1);
 time.now=100;time.timers[1].fire();assert.equal(wakes,1);
 time.timers[0].fire();time.timers[1].fire();assert.equal(wakes,1,'Old callbacks cannot wake a completed alarm again');
});

test('closing an owner cancels its alarm and an already-queued callback cannot rearm or wake',()=>{
 const time=clock();let wakes=0;const close=armRecoveryWake(100,()=>wakes++,time.options);
 close();assert.equal(time.timers[0].cancelled,true);
 time.now=99;time.timers[0].fire();time.now=100;time.timers[0].fire();
 assert.equal(wakes,0);assert.equal(time.timers.length,1);
});

test('a long or clock-shifted deadline stays bounded by timer limits without waking early',()=>{
 const time=clock();let wakes=0;const at=2147483647+10;armRecoveryWake(at,()=>wakes++,time.options);
 assert.equal(time.timers[0].delay,2147483647);
 time.now=2147483647;time.timers[0].fire();assert.equal(wakes,0);assert.equal(time.timers[1].delay,10);
 time.now=2147483600;time.timers[1].fire();assert.equal(wakes,0);assert.equal(time.timers[2].delay,57);
 time.now=at;time.timers[2].fire();assert.equal(wakes,1);
});
