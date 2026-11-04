import {expect,it} from 'vitest';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import {ApplicationClient} from '../src/client';
import {ExecutionCoordinator} from '../src/execution';

it('uses the independent native route to connect, query and cancel without submitting command content',async()=>{
  const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);requests.push(request);
    const value=request.method==='execution.list'?{executions:[{executionId:'known-execution',state:'unknown',source:'application',reason:'CLIENT_CONFIRMATION_LOST'}]}:request.method==='execution.cancel'?{executionId:'known-execution',state:'stop_requested',sequence:2}:request.method==='execution.query'?{executionId:'known-execution',state:'running',sequence:1}:request.method==='execution.copySetup'?{copied:true}:{protocol:1,executorId:'peer',ledgerEpoch:'ledger',processEpoch:'process'};
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
