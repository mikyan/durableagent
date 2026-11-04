import assert from 'node:assert/strict';
const cases=[];const test=(name,run)=>cases.push({name,run});let root;
export function registerRegistryPolicyChecks(register){for(const {name,run}of cases)register(name,{timeout:30000},run);}
export async function runRegistryPolicyChecks(onCase,{tempRoot}={}){root=tempRoot;try{for(const {name,run}of cases){await run();await onCase({name,passed:true});}}finally{root=undefined;}}
import {createRegistry,defineExtension} from '@earendil-works/pi-durable';
import {assembleAgentExtensions} from '../dist/extensions/assembly.js';
import {Harness,defineTool,defineTask} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {obj} from '@earendil-works/pi-schema';
import {openOwnedStorage} from '../dist/storage.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('UI-only packages need no Agent placeholder; both identities are validated before SDK installation',()=>{
 const registry=createRegistry(),factory=()=>defineExtension({name:'sdk.notes'});
 const descriptors=[{id:'timeline',title:'时间线',ui:'timeline'},{id:'notes',title:'笔记',ui:'notes',agent:'notes'}];
 const result=assembleAgentExtensions(descriptors,{notes:factory},registry);
 assert.deepEqual(registry.snapshot().installed().map(x=>x.name),['sdk.notes']);
 assert.equal(result.get('timeline'),undefined);assert.equal(result.get('notes'),'sdk.notes');
 assert.throws(()=>assembleAgentExtensions([...descriptors,descriptors[0]],{notes:factory},createRegistry()),/重复应用扩展身份/);
 assert.throws(()=>assembleAgentExtensions([{id:'one',title:'一',agent:'a'},{id:'two',title:'二',agent:'b'}],{a:factory,b:factory},createRegistry()),/重复 SDK 扩展身份/);
 assert.throws(()=>assembleAgentExtensions([{id:'missing',title:'缺失',agent:'missing'}],{},createRegistry()),/缺少 Agent 入口/);
});

test('actual SDK selection order owns intentional tools and sections overrides; duplicate tasks fail in the SDK',async()=>{
 const directory=await mkdtemp(join(root??tmpdir(),'extension-registry-')),registry=createRegistry(),calls=[];
 const factory=label=>()=>defineExtension({name:'sdk.'+label,sections:[{key:'shared',render:()=>label}],tools:[defineTool({name:'choose',description:label,parameters:obj({}),execute:async()=>{calls.push(label);return {output:[{type:'text',text:label}]};}})]});
 const a=factory('a'),b=factory('b');assembleAgentExtensions([{id:'a',title:'A',agent:'a'},{id:'b',title:'B',agent:'b'}],{a,b},registry);
 const config=validationConfiguration({toolName:()=> 'choose'}),h=await Harness.open((await openOwnedStorage(join(directory,'sdk.sqlite'))).storage,{registry,models:()=>config.models},context);
 try{
  const conversation=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:config.initialModel,extensions:[registry.snapshot().extension('sdk.b'),registry.snapshot().extension('sdk.a')]}},context);
  const selected=await conversation.agent(context);assert.equal(selected.tools[0].description,'a');assert.equal(await selected.sections[0].render({}), 'a');
  await conversation.submit({type:'input',requestId:'one',content:'choose'},context);await conversation.waitForIdle(context);assert.deepEqual(calls,['a']);
  await conversation.configure({extensions:[registry.snapshot().extension('sdk.a'),registry.snapshot().extension('sdk.b')]},context);assert.equal((await conversation.agent(context)).tools[0].description,'b');
  const task=defineTask({name:'same-task',version:1,initial:()=>({phase:'run'}),phases:{run:async(_,runtime,ctx)=>runtime.commit(()=>({status:'terminal',outcome:{status:'completed',value:null}}),ctx)},abort:async(_,runtime,ctx)=>runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),ctx)});
  assert.throws(()=>assembleAgentExtensions([{id:'task-a',title:'A',agent:'a'},{id:'task-b',title:'B',agent:'b'}],{a:()=>({name:'task-a',tasks:[task]}),b:()=>({name:'task-b',tasks:[task]})},createRegistry()),/Task same-task.*already installed/);
 }finally{await h.close(context);await rm(directory,{recursive:true,force:true});}
});

test('SDK uninstall neither cancels an acquired tool call nor disposes its owner resource',async()=>{
 const directory=await mkdtemp(join(root??tmpdir(),'extension-owner-')),registry=createRegistry();let release,entered;
 const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),resource={active:0,released:0};
 const extension=defineExtension({name:'sdk.resource',tools:[defineTool({name:'owned',parameters:obj({}),description:'owned resource',execute:async()=>{resource.active++;entered();try{await held;return {output:[{type:'text',text:'owner completed'}]};}finally{resource.active--;resource.released++;}}})]});
 assembleAgentExtensions([{id:'resource',title:'Resource',agent:'resource'}],{resource:()=>extension},registry);
 const config=validationConfiguration({toolName:()=> 'owned'}),h=await Harness.open((await openOwnedStorage(join(directory,'sdk.sqlite'))).storage,{registry,models:()=>config.models},context);
 try{const conversation=await h.createConversation({ownership:{kind:'ownerless'},agent:{model:config.initialModel}},context);await conversation.submit({type:'input',requestId:'one',content:'use resource'},context);await started;registry.uninstall(extension);assert.equal(resource.active,1);assert.equal(resource.released,0);assert.equal((await conversation.agent(context)).tools.length,0);release();await conversation.waitForIdle(context);assert.equal(resource.active,0);assert.equal(resource.released,1);}finally{release();await h.close(context);await rm(directory,{recursive:true,force:true});}
});
