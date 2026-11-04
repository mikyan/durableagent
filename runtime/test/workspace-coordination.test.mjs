import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness,createRegistry} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from '../dist/storage.js';
import {WorkspaceCoordinator} from '../dist/workspace-coordination.js';
const position=path=>({namespace:'termux:one',canonicalPath:path,objectId:'inode:'+path,ancestorObjectIds:['inode:/work']});
const claim=(id,scope)=>({operationId:id,requestDigest:'a'.repeat(64),namespace:'termux:one',source:'termux',bindingId:'binding',productId:id,scope});
const whole={domain:'device-files',kind:'environment'},local=path=>({domain:'device-files',kind:'paths',positions:[position(path)]});
const open=async path=>{const {storage}=await openOwnedStorage(path);return Harness.open(storage,{models:createModels(),registry:createRegistry()},context);};

test('a shell writer holds local file writes across host reopen until matching terminal scope evidence arrives',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'writer-domain-')),path=join(dir,'sdk.sqlite');let harness=await open(path),finished=false;
 const verify=async c=>({operationId:c.operationId,requestDigest:c.requestDigest,namespace:c.namespace,state:finished?'completed':'unknown',scopeConfirmed:finished,sequence:finished?3:0});
 let writes=new WorkspaceCoordinator(harness,verify);
 try{
  assert.equal((await writes.reserve(claim('shell',whole))).state,'granted');
  assert.equal((await writes.reserve(claim('file',local('/work/a.txt')))).state,'queued');
  await harness.close(context);harness=await open(path);writes=new WorkspaceCoordinator(harness,verify);
  await writes.refresh();assert.equal((await writes.reserve(claim('file',local('/work/a.txt')))).state,'queued');
  assert.equal((await writes.list()).find(x=>x.operationId==='shell').state,'unknown');
  finished=true;await writes.refresh();assert.equal((await writes.reserve(claim('file',local('/work/a.txt')))).state,'granted');
 }finally{await harness.close(context);await rm(dir,{recursive:true,force:true});}
});

test('known disjoint files can write together while canonical aliases, hardlinks and directory descendants wait',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'writer-overlap-')),harness=await open(join(dir,'sdk.sqlite'));
 const writes=new WorkspaceCoordinator(harness,async()=>{throw Error('No terminal receipt');});
 try{
  assert.equal((await writes.reserve(claim('a',local('/work/a.txt')))).state,'granted');
  assert.equal((await writes.reserve(claim('b',local('/work/b.txt')))).state,'granted');
  assert.equal((await writes.reserve(claim('alias',local('/work/a.txt')))).state,'queued');
  const hardlink=local('/elsewhere/link.txt');hardlink.positions[0].objectId='inode:/work/a.txt';
  assert.equal((await writes.reserve(claim('hardlink',hardlink))).state,'queued');
  const directory=local('/different-name');directory.positions[0].objectId='inode:/work';
  assert.equal((await writes.reserve(claim('parent',directory))).state,'queued');
  assert.equal((await writes.reserve(claim('shell',whole))).state,'queued');
  assert.equal((await writes.reserve(claim('later-file',local('/work/c.txt')))).state,'queued','a queued whole-environment writer must not starve');
 }finally{await harness.close(context);await rm(dir,{recursive:true,force:true});}
});

test('cancelling a queued write never grants it later and cannot release a granted or uncertain writer',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'writer-cancel-')),harness=await open(join(dir,'sdk.sqlite'));let confirmed=false;
 const writes=new WorkspaceCoordinator(harness,async c=>({operationId:c.operationId,requestDigest:c.requestDigest,namespace:c.namespace,state:'stopped',scopeConfirmed:confirmed,sequence:2}));
 try{
  await writes.reserve(claim('active',whole));await writes.reserve(claim('queued',local('/work/a.txt')));
  assert.equal(await writes.cancelQueued('queued'),true);assert.equal(await writes.cancelQueued('active'),false);
  await writes.refresh();assert.notEqual((await writes.list()).find(x=>x.operationId==='active').state,'released');
  confirmed=true;await writes.refresh();assert.equal((await writes.reserve(claim('queued',local('/work/a.txt')))).state,'cancelled');
  assert.equal((await writes.reserve(claim('explicit-new',local('/work/a.txt')))).state,'granted');
 }finally{await harness.close(context);await rm(dir,{recursive:true,force:true});}
});
