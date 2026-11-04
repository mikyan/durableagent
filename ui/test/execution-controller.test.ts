import {expect,it} from 'vitest';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import {ApplicationClient} from '../src/client';
import {ExecutionCoordinator} from '../src/execution';

it('explains manual Termux reopening after an asynchronous force-stop error without changing or replaying the execution',async()=>{
 const requests:ApplicationRequest[]=[],row={executionId:'retained',state:'accepted_not_started',sequence:1};
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,...(request.method==='execution.list'?{ok:true,value:{executions:[row]}}:{ok:false,error:{code:'TERMUX_FORCE_STOPPED',message:'执行通道未完成请求（TERMUX_FORCE_STOPPED）'}})}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{
  await execution.refresh('conversation');await execution.query('retained');
  expect(execution.view().error).toBe('Termux 已被系统强行停止。请手动打开 Termux 一次，再返回本应用；无需重新初始化。');
  expect(execution.view().rows).toEqual([row]);
  expect(requests.map(request=>request.method)).toEqual(['execution.list','execution.query']);
 }finally{client.dispose();}
});

it('shows a durable writer queue before external acceptance and still allows native cancellation',async()=>{
 let cancelled=false;
 const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);if(request.method==='execution.cancel')cancelled=true;
  const row=cancelled?{executionId:'waiting',state:'not_started',scopeConfirmed:true,sequence:1}:{executionId:'waiting',state:'queued',source:'application',reason:'WRITER_QUEUED',sequence:0};
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:request.method==='execution.list'?{executions:[row]}:row}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{await execution.refresh('one');expect(execution.view().error).toBeUndefined();expect(execution.view().rows[0]?.state).toBe('queued');await execution.cancel('waiting');expect(cancelled).toBe(true);expect(execution.view().rows[0].state).toBe('not_started');}finally{client.dispose();}
});

it('uses the independent native route to connect, query and cancel without submitting command content',async()=>{
  const requests:ApplicationRequest[]=[];
  let current:Record<string,unknown>={executionId:'known-execution',state:'unknown',source:'application',reason:'CLIENT_CONFIRMATION_LOST'};
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);requests.push(request);
    if(request.method==='execution.cancel')current={executionId:'known-execution',state:'stop_requested',sequence:2};
    if(request.method==='execution.query')current={executionId:'known-execution',state:'running',sequence:1};
    const value=request.method==='execution.list'?{executions:[current]}:request.method==='execution.cancel'||request.method==='execution.query'?current:request.method==='execution.copySetup'?{copied:true}:{protocol:1,executorId:'peer',ledgerEpoch:'ledger',processEpoch:'process'};
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});
  const execution=new ExecutionCoordinator(()=>client,()=>{});
  await execution.copySetup();await execution.connect();await execution.refresh('conversation');
  expect(execution.view().rows[0]).toMatchObject({state:'unknown',source:'application'});
  await execution.query('known-execution');await execution.cancel('known-execution');
  expect(execution.view().rows[0].state).toBe('stop_requested');
  expect(execution.view().notice).toContain('等待确认');
  expect(requests.map(request=>request.method)).toEqual(['execution.copySetup','execution.connect','execution.list','execution.query','execution.list','execution.cancel','execution.list']);
  expect(requests[0].payload).toEqual({});expect(requests[1].payload).toEqual({});
  expect(requests[5].payload).toEqual({executionId:'known-execution'});
  client.dispose();
});

it('shows later confirmation loss for a nonterminal execution while preserving confirmed terminal evidence',async()=>{
  let reads=0;
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);++reads;
    const value={executions:reads===1?[{executionId:'running',state:'running',sequence:2},{executionId:'ended',state:'completed',sequence:3}]:reads===2?[{executionId:'running',state:'unknown',sequence:2,source:'application',reason:'CLIENT_CONFIRMATION_LOST'},{executionId:'ended',state:'unknown',sequence:3,source:'application',reason:'CLIENT_CONFIRMATION_LOST'}]:[{executionId:'running',state:'running',sequence:1},{executionId:'ended',state:'running',sequence:1}]};
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});
  const execution=new ExecutionCoordinator(()=>client,()=>{});
  try{await execution.refresh('conversation');await execution.refresh('conversation');expect(execution.view().rows[0]).toMatchObject({state:'unknown',source:'application'});expect(execution.view().rows[1]).toMatchObject({state:'completed',sequence:3});await execution.refresh('conversation');expect(execution.view().rows[0]).toMatchObject({state:'unknown',source:'application',sequence:2});expect(execution.view().rows[1]).toMatchObject({state:'completed',sequence:3});}finally{client.dispose();}
});

it('a list begun before native cancellation cannot replace its later confirmed result',async()=>{
  let reads=0,late:ApplicationRequest|undefined;
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);
    if(request.method==='execution.list'&&++reads===2){late=request;return;}
    const row=reads===1?{executionId:'known',state:'running',sequence:1}:{executionId:'known',state:'stopped',sequence:3,scopeConfirmed:true};
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:request.method==='execution.list'?{executions:[row]}:row}));
  }});
  const execution=new ExecutionCoordinator(()=>client,()=>{});
  try{await execution.refresh('conversation');const pending=execution.refresh('conversation');await execution.cancel('known');client.receive({type:'response',protocol:1,connectionId:late!.connectionId,requestId:late!.requestId,ok:true,value:{executions:[{executionId:'known',state:'unknown',sequence:1,source:'application'}]}});await pending;expect(execution.view().rows[0]).toMatchObject({state:'stopped',scopeConfirmed:true});}finally{client.dispose();}
});

it('publishes native cancellation immediately while a separate SDK reconciliation waits for the Node owner',async()=>{
  let lists=0;
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);
    if(request.method==='execution.list'&&++lists>1)return;
    const value=request.method==='execution.list'?{executions:[{executionId:'known',state:'unknown',source:'application',sequence:2}]}:{executionId:'known',state:'stopped',sequence:3,scopeConfirmed:true};
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});
  const execution=new ExecutionCoordinator(()=>client,()=>{});
  await execution.refresh('conversation');
  await execution.cancel('known');
  expect(lists).toBe(2);
  expect(execution.view().rows[0]).toMatchObject({state:'stopped',scopeConfirmed:true});
  expect(execution.view().pending).toEqual([]);
  client.dispose();
});

it('loads execution receipts through bounded pages without losing earlier native evidence',async()=>{
  const payloads:unknown[]=[];
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);payloads.push(request.payload);
    const value=request.payload?.cursor?{executions:[{executionId:'second',state:'completed',sequence:2}],nextCursor:null}:{executions:[{executionId:'first',state:'running',sequence:1}],nextCursor:'first'};
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});
  const execution=new ExecutionCoordinator(()=>client,()=>{});
  await execution.refresh('conversation');
  expect(execution.view().rows.map(row=>row.executionId)).toEqual(['first']);
  await execution.loadMore();
  expect(payloads).toEqual([{id:'conversation'},{id:'conversation',cursor:'first'}]);
  expect(execution.view().rows.map(row=>row.executionId)).toEqual(['first','second']);
  expect(execution.view().nextCursor).toBeUndefined();
  client.dispose();
});
