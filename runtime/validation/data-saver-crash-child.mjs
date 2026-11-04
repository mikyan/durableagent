// The policy/executor are external boundary fixtures; SDK scheduling and both app stores are real.
import {writeFileSync,openSync,fsyncSync,closeSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from './submission-authority.mjs';
import {PersistentExecutionPeer,executionConfiguration} from './execution-peer.mjs';
const directory=process.argv[2],native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new PersistentExecutionPeer(directory);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
let record;
const policy={
 register:async request=>record={executionId:request.executionId,requestDigest:createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex'),productId:request.context.productId,controlGeneration:request.context.controlGeneration,namespace:request.context.namespace,classification:'unknown',summary:'fixed command',period:1,phase:'waiting',reason:'metered',grantPeriod:null},
 prepared:async(id,requestDigest,finalDigest)=>{if(id!==record.executionId||requestDigest!==record.requestDigest)throw Error('Identity mismatch');record.finalDigest=finalDigest;const path=join(directory,'prepared-policy.json');writeFileSync(path,JSON.stringify(record));const fd=openSync(path,'r+');fsyncSync(fd);closeSync(fd);process.kill(process.pid,'SIGKILL');},
};
const execution=new ManagedExecution({channel:peer,authority:native,dataSaver:policy});
const app=new Application({...executionConfiguration(()=>appendFileSync(join(directory,'model-requests.txt'),'request\n')),path:join(directory,'sdk.sqlite'),inputs:native,sends:native,execution});
const call=async(method,payload)=>{const result=await app.request({protocol:1,connectionId:'policy-crash',requestId:crypto.randomUUID(),method,payload});if(!result.ok)throw Error(result.error.message);return result.value;};
await app.start();await call('create',{creationId:'conversation'});await native.create('conversation','run once after reopen','send');await call('send',{intentId:'send'});
setTimeout(()=>{throw Error('Prepared policy crash boundary was not reached');},10000);
