import {expect,it} from 'vitest';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import type {DataSaverSettings,ExecutionPolicy} from '../../runtime/src/data-saver-protocol';
import {ApplicationClient} from '../src/client';
import {DataSaverCoordinator} from '../src/data-saver';
import {ConversationController} from '../src/controller';

it('the actual conversation controller loads the shared policy only after the extension is ready',async()=>{
 const requests:ApplicationRequest[]=[];
 const settings:DataSaverSettings={enabled:true,version:2,period:3,restricted:true,reason:'network-unknown',network:{identity:null,known:false,metered:true,blocked:false}};
 const controller=new ConversationController(()=>{
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);requests.push(request);
   const value=request.method==='status'?{phase:'ready',extensions:['conversation','data-saver']}:request.method==='dataSaver.get'?settings:{conversations:[]};
   queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});return client;
 });
 try{await controller.connect();expect(controller.snapshot().dataSaver?.settings).toEqual(settings);expect(requests.filter(value=>value.method==='dataSaver.get')).toHaveLength(1);}
 finally{controller.dispose();}
});

it('a late grant response for the previous conversation does not claim that the newly opened conversation was granted',async()=>{
 const settings:DataSaverSettings={enabled:true,version:1,period:3,restricted:true,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}};
 const row:ExecutionPolicy={executionId:'one',requestDigest:'a'.repeat(64),finalDigest:'b'.repeat(64),productId:'first',controlGeneration:1,namespace:'termux:fixture',classification:'unknown',summary:'first operation',period:3,phase:'waiting',reason:'metered',grantPeriod:null};let held:ApplicationRequest|undefined;
 const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);if(request.method==='dataSaver.grant'){held=request;return;}
  const value=request.method==='dataSaver.operations'?{operations:(request.payload as {id:string}).id==='first'?[row]:[],nextCursor:null}:settings;
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
 }});const coordinator=new DataSaverCoordinator(()=>client,()=>{});
 try{await coordinator.refresh('first');const granting=coordinator.grant('one');await coordinator.refresh('second');expect(held).toBeTruthy();client.receive({type:'response',protocol:1,connectionId:held!.connectionId,requestId:held!.requestId,ok:true,value:{...row,phase:'granted'}});await granting;
  expect(coordinator.view().conversationId).toBe('second');expect(coordinator.view().operations).toEqual([]);expect(coordinator.view().notice).toBeUndefined();expect(coordinator.view().pending).toBe(false);
 }finally{coordinator.reset();client.dispose();}
});

it('shows policy waits and grants the exact selected execution while the global setting remains enabled',async()=>{
 const requests:ApplicationRequest[]=[];
 let settings:DataSaverSettings={enabled:false,version:0,period:3,restricted:false,reason:'disabled',network:{identity:'fixture',known:true,metered:true,blocked:false}};
 let row:ExecutionPolicy={executionId:'one',requestDigest:'a'.repeat(64),finalDigest:'b'.repeat(64),productId:'conversation',controlGeneration:1,namespace:'termux:fixture',classification:'unknown',summary:'unknown script',period:3,phase:'waiting',reason:'metered',grantPeriod:null};
 const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  if(request.method==='dataSaver.configure')settings={...settings,enabled:true,version:1,restricted:true,reason:'metered'};
  if(request.method==='dataSaver.grant')row={...row,phase:'granted',grantPeriod:3};
  const value=request.method==='dataSaver.operations'?{operations:[row],nextCursor:null}:request.method==='dataSaver.grant'?row:settings;
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
 }});
 const coordinator=new DataSaverCoordinator(()=>client,()=>{});
 try{
  await coordinator.refresh('conversation');expect(coordinator.view().settings?.enabled).toBe(false);
  await coordinator.configure(true);expect(coordinator.view().settings?.enabled).toBe(true);expect(coordinator.view().operations[0].phase).toBe('waiting');
  await coordinator.grant('one');expect(coordinator.view().operations[0].phase).toBe('granted');expect(coordinator.view().settings?.enabled).toBe(true);
  expect(requests.find(value=>value.method==='dataSaver.grant')?.payload).toEqual({id:'conversation',executionId:'one',requestDigest:'a'.repeat(64),finalDigest:'b'.repeat(64),period:3});
  expect(requests.filter(value=>value.method==='dataSaver.configure')).toHaveLength(1);expect(requests.some(value=>value.method==='send')).toBe(false);
 }finally{coordinator.reset();client.dispose();}
});
