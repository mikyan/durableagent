import {expect,it,vi} from 'vitest';
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

it('asks for explicit source verification without reconnecting or changing a retained execution',async()=>{
 const requests:ApplicationRequest[]=[],row={executionId:'retained',state:'completed',sequence:3};
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  const reply:{ok:true;value:unknown}|{ok:false;error:{code:string;message:string}}=request.method==='execution.list'?{ok:true,value:{executions:[row]}}:request.method==='execution.connect'?{ok:true,value:{protocol:1,executorId:'peer',ledgerEpoch:'ledger'}}:{ok:false,error:{code:'TERMUX_SOURCE_UNVERIFIED',message:'执行通道未完成请求（TERMUX_SOURCE_UNVERIFIED）'}};
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,...reply}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{
  await execution.refresh('conversation');await execution.query('retained');
  expect(execution.view().error).toContain('当前 Termux 安装包的来源尚未确认');
  expect(execution.view().error).toContain('联网后点击“连接执行环境”');
  expect(execution.view().rows).toEqual([row]);
  expect(requests.map(request=>request.method)).toEqual(['execution.list','execution.query']);
  await execution.connect();
  expect(execution.view().connected).toBe(true);expect(execution.view().error).toBeUndefined();
  expect(execution.view().rows).toEqual([row]);
 }finally{client.dispose();}
});

it.each([
 ['TERMUX_SOURCE_UNAVAILABLE','暂时无法获取官方发行记录','联网后重试'],
 ['TERMUX_SOURCE_UNSUPPORTED','暂不支持此 Termux 安装来源或打包形式','保留现有 Termux'],
 ['TERMUX_CAPABILITY_UNSUPPORTED','外部命令接口不兼容','核对安装渠道与版本'],
 ['TERMUX_MISSING','尚未安装 Termux','官方发布页'],
 ['TERMUX_PERMISSION_REQUIRED','尚未取得 Termux 命令执行授权','连接执行环境'],
 ['SETUP_REQUIRED','尚未完成执行环境初始化','复制初始化命令'],
])('explains %s separately without presenting a failed connection as ready',async(code,reason,nextStep)=>{
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code,message:'执行通道未完成请求（'+code+'）'}}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{await execution.connect();expect(execution.view().connected).toBe(false);expect(execution.view().connecting).toBe(false);expect(execution.view().error).toContain(reason);expect(execution.view().error).toContain(nextStep);}finally{client.dispose();}
});

it('keeps an explicitly requested connection pending while source verification and bootstrap complete',async()=>{
 vi.useFakeTimers();let request:ApplicationRequest|undefined;
 const client=new ApplicationClient({postMessage:json=>{request=JSON.parse(json);}});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{
  const pending=execution.connect();
  await vi.advanceTimersByTimeAsync(45000);
  expect(execution.view().connecting).toBe(true);expect(execution.view().error).toBeUndefined();
  client.receive({type:'response',protocol:1,connectionId:request!.connectionId,requestId:request!.requestId,ok:true,value:{protocol:1,executorId:'peer',ledgerEpoch:'ledger'}});
  await pending;expect(execution.view().connected).toBe(true);expect(execution.view().connecting).toBe(false);
 }finally{client.dispose();vi.useRealTimers();}
});

it.each([
 ['BOOTSTRAP_PROTOCOL_MISMATCH','握手协议或响应无法确认','核对本应用与执行端是否为配套发布版本'],
 ['INSTANCE_MISMATCH','无法确认执行端身份','确认连接的是原有 Termux 执行环境'],
])('explains %s while preserving retained executions and pairing',async(code,reason,nextStep)=>{
 const requests:ApplicationRequest[]=[],row={executionId:'retained',state:'completed',sequence:3};
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,...(request.method==='execution.list'?{ok:true,value:{executions:[row]}}:{ok:false,error:{code,message:'执行通道未完成请求（'+code+'）'}})}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{
  await execution.refresh('conversation');await execution.connect();
  expect(execution.view().connected).toBe(false);expect(execution.view().connecting).toBe(false);
  expect(execution.view().error).toContain(reason);expect(execution.view().error).toContain(nextStep);
  expect(execution.view().error).toContain('保留现有配对和执行记录');expect(execution.view().error).toContain('不要重新初始化');
  expect(execution.view().rows).toEqual([row]);
  expect(requests.map(request=>request.method)).toEqual(['execution.list','execution.connect']);
 }finally{client.dispose();}
});

it('opens only the selected official download source through the native route without connecting',async()=>{
 const requests:ApplicationRequest[]=[];
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{opened:true}}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{
  await execution.openDownload('github');await execution.openDownload('fdroid');
  expect(requests.map(({method,payload})=>({method,payload}))).toEqual([
   {method:'execution.openDownload',payload:{source:'github'}},{method:'execution.openDownload',payload:{source:'fdroid'}},
  ]);
  expect(execution.view().connected).toBe(false);expect(execution.view().notice).toContain('浏览器');
 }finally{client.dispose();}
});

it('shows the official addresses when no external browser can open the download page',async()=>{
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:'TERMUX_DOWNLOAD_UNAVAILABLE',message:'unavailable'}}));
 }});
 const execution=new ExecutionCoordinator(()=>client,()=>{});
 try{await execution.openDownload('github');expect(execution.view().openingSource).toBeUndefined();expect(execution.view().error).toContain('https://github.com/termux/termux-app/releases');expect(execution.view().notice).toBeUndefined();}finally{client.dispose();}
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
