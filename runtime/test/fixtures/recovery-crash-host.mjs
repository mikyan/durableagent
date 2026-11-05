import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Application} from '../../validation/application-fixture.mjs';
import {validationConfiguration} from '../../dist/application-validation.js';
import {deferredConfiguration} from './recovery-deferred-provider.mjs';
import {armRecoveryWake} from './recovery-wake-timer.mjs';
const [directory,mode,restartLimit,maxRetries]=process.argv.slice(2);let app,cancelWake=()=>{};
const call=async(method,payload={})=>{const value=await app.request({protocol:1,connectionId:'recovery-child',requestId:crypto.randomUUID(),method,payload});if(!value.ok)throw Error(value.error.message);return value.value;};
const recovery={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async wake=>{cancelWake();cancelWake=()=>{};if(wake.at!==undefined)cancelWake=armRecoveryWake(wake.at,()=>app.wake());}};
const configuration=mode==='poll-crash'?deferredConfiguration({started:()=>appendFileSync(join(directory,'deferred-starts.txt'),'request\n'),polled:()=>{appendFileSync(join(directory,'polls.txt'),'poll\n');process.kill(process.pid,'SIGKILL');}}):validationConfiguration({hang:true,requested:()=>{
 appendFileSync(join(directory,'requests.txt'),'request\n');
 if(mode==='crash')process.kill(process.pid,'SIGKILL');
 else setImmediate(()=>void app.close().then(()=>{writeFileSync(join(directory,'closed.txt'),'closed');process.exit(0);}).catch(error=>{process.stderr.write(String(error));process.exit(2);}));
}});
app=new Application({path:join(directory,'app.sqlite'),workspacePath:directory,...configuration,recovery,bootstrapSettings:()=>({retry:{enabled:Number(maxRetries)>0,maxRetries:Number(maxRetries),baseDelayMs:10},restartLimit:Number(restartLimit),stream:{deferred:true}})});
await app.start();if(!(await call('list')).conversations.length){await call('create',{creationId:'chat'});await call('send',{id:'chat',text:'one durable input across host loss',actionId:'original'});}
setInterval(()=>{},1000);
