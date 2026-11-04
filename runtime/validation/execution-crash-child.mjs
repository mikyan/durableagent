import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from './submission-authority.mjs';
import {PersistentExecutionPeer,executionConfiguration} from './execution-peer.mjs';
const [directory,stage]=process.argv.slice(2),native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new PersistentExecutionPeer(directory);
const execution=new ManagedExecution({channel:peer,authority:native,boundary:(point)=>{if(point===stage){writeFileSync(join(directory,'cut.txt'),point);process.kill(process.pid,'SIGKILL');}}});
const app=new Application({...executionConfiguration(),path:join(directory,'sdk.sqlite'),inputs:native,sends:native,execution});
const call=async(method,payload)=>{const reply=await app.request({protocol:1,connectionId:'child',requestId:crypto.randomUUID(),method,payload});if(!reply.ok)throw Error(reply.error.message);return reply.value;};
await app.start();await call('create',{creationId:'crash-conversation'});await native.create('crash-conversation','run once','crash-send');await call('send',{intentId:'crash-send'});
const deadline=Date.now()+10000;while((await call('sendStatus',{intentId:'crash-send'})).submission?.status!=='done'){if(Date.now()>deadline)throw Error('Child did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
await app.close();peer.close();native.close();
