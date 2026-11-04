import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createSession,defineDoc} from '@earendil-works/pi-durable';
import {openOwnedStorage} from '../dist/storage.js';
import {Configuration} from '../dist/application-records.js';

const Legacy=defineDoc({kind:'app.configuration',version:1,scope:'session',initial:()=>({initialized:true,defaultModel:null,workspace:{id:'kept-workspace',path:'/retained/path'}}),checkpointWhen:()=>false});
for(const phase of ['before-commit','after-commit'])test(`actual host process death ${phase} preserves original history and verifies migration commit independently`,{timeout:20000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'retention-kill-'));const path=join(directory,'sdk.sqlite');let child,session;
 try {
  let owned=await openOwnedStorage(path);session=createSession(owned.storage);
  const entry=await session.commit(async tx=>{await tx.doc(Legacy);const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});return tx.appendEntry(conversation.id,{kind:'retained-proof',data:{text:'unique original evidence'}});},context);await session.close(context);session=undefined;
  child=fork(new URL('./fixtures/retention-crash-host.mjs',import.meta.url),[path,phase],{stdio:['ignore','ignore','pipe','ipc']});
  const [ready]=await once(child,'message');assert.equal(ready.stage,phase,ready.error);const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  owned=await openOwnedStorage(path);session=createSession(owned.storage);
  assert.equal((await owned.storage.entry(entry.id,context)).entry.data.text,'unique original evidence');
  if(phase==='before-commit')assert.equal((await session.snapshot(Legacy,context)).workspace.id,'kept-workspace');
  else await assert.rejects(session.snapshot(Legacy,context),/newer version/);
  assert.equal((await session.snapshot(Configuration,context)).workspace.path,'/retained/path');
  await session.commit(async tx=>{await tx.doc(Configuration);},context);await session.close(context);session=undefined;
 }finally{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await session?.close(context);await rm(directory,{recursive:true,force:true});}
});
