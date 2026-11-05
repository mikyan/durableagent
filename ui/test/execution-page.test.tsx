// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import {ExecutionPanel} from '../src/extensions/execution';
import {ConversationController,type UiState} from '../src/controller';
import {ApplicationClient} from '../src/client';

it('offers official installation sources through native browser actions without connecting or navigating the privileged page',async()=>{
 const requests:ApplicationRequest[]=[];
 const client=new ApplicationClient({postMessage:json=>{
  const request:ApplicationRequest=JSON.parse(json);requests.push(request);
  const value=request.method==='status'?{phase:'ready',extensions:['managed-execution']}:request.method==='execution.openDownload'?{opened:true}:{conversations:[]};
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
 }});
 const controller=new ConversationController(()=>client);
 try{
  await controller.connect();render(<ExecutionPanel controller={controller} state={controller.snapshot()}/>);
  fireEvent.click(screen.getByText('安装来源与兼容说明'));
  expect(screen.getByText(/不限定单一 Termux 版本/)).toBeTruthy();
  expect(screen.getByText(/首次连接可能联网/)).toBeTruthy();
  expect(screen.getByText(/不要为连接而卸载/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'GitHub 官方发布页'}));
  await waitFor(()=>expect(requests.some(request=>request.method==='execution.openDownload')).toBe(true));
  await Promise.resolve();
  fireEvent.click(screen.getByRole('button',{name:'F-Droid 官方页面'}));
  await waitFor(()=>expect(requests.filter(request=>request.method==='execution.openDownload')).toHaveLength(2));
  expect(requests.filter(request=>request.method.startsWith('execution.')).map(({method,payload})=>({method,payload}))).toEqual([
   {method:'execution.openDownload',payload:{source:'github'}},{method:'execution.openDownload',payload:{source:'fdroid'}},
  ]);
  expect(screen.queryByRole('link')).toBeNull();
 }finally{cleanup();controller.dispose();}
});

it('keeps application uncertainty and a pending cancel distinct from a confirmed stop',()=>{
  const controller=new ConversationController(()=>new ApplicationClient(undefined));
  const state:UiState={...controller.snapshot(),activeId:'one',execution:{rows:[{executionId:'lost',state:'unknown',source:'application',reason:'CLIENT_CONFIRMATION_LOST'},{executionId:'pending',state:'stop_requested'},{executionId:'incomplete',state:'completed',exitCode:0,captureIncomplete:true}],conversationId:'one',loading:false,connecting:false,copying:false,pending:[],connected:false}};
  try{
    render(<ExecutionPanel controller={controller} state={state}/>);
    expect(screen.getByText('未收到执行端确认')).toBeTruthy();
    expect(screen.getByText('取消已请求，等待停止确认')).toBeTruthy();
    expect(screen.queryByText('已停止')).toBeNull();
    expect(screen.getByText('输出不完整')).toBeTruthy();
    expect(screen.getByText('退出码 0')).toBeTruthy();
    expect(screen.getByRole('button',{name:'复制初始化命令'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'连接执行环境'})).toBeTruthy();
  }finally{cleanup();controller.dispose();}
});

it('queries actual original-file evidence and distinguishes unavailable diffs and unconfirmed scope',async()=>{
 const requests:any[]=[];
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json);requests.push(request);queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{changes:[{operationId:'known-file',executionId:'known-command',bindingId:'binding',path:'/termux/workspace/实际.txt',destination:'/termux/workspace/新名.txt',namespace:'termux:one',original:true,state:'completed',scopeConfirmed:true,diff:{available:true,text:'--- before\n+++ after\n-old\n+真实内容\n'}},{operationId:'uncertain-file',executionId:'lost-command',bindingId:'binding',path:'/termux/workspace/unknown.bin',namespace:'termux:one',original:true,state:'completed',scopeConfirmed:false,diff:{available:false,reason:'binary'}}],nextCursor:null,untrackedExecutions:[{executionId:'arbitrary-shell',state:'completed',diff:{available:false,reason:'unknown_command_scope'}}],untrackedLimited:false}}));}});
 const controller=new ConversationController(()=>client);controller.extensionClient={request:client.request.bind(client),subscribe:client.subscribe.bind(client)};
 const state:UiState={...controller.snapshot(),activeId:'one',status:{phase:'ready',extensions:['managed-execution']}};
 try{render(<ExecutionPanel controller={controller} state={state}/>);fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));expect(await screen.findByText('/termux/workspace/实际.txt')).toBeTruthy();expect(screen.getByText(/\+真实内容/)).toBeTruthy();expect(screen.getAllByText('原件')).toHaveLength(2);expect(screen.getByText('/termux/workspace/新名.txt')).toBeTruthy();expect(screen.getByText('原件结果已记录，执行范围待核验')).toBeTruthy();expect(screen.getByText('二进制内容不提供文本差异')).toBeTruthy();expect(screen.getByText('命令的写入范围未知，无法提供逐文件差异')).toBeTruthy();expect(requests.map(value=>value.method)).toEqual(['files.list']);expect(requests[0].payload).toEqual({id:'one'});
 }finally{cleanup();controller.dispose();client.dispose();}
});

it('shows native original changes and the shared-writer queue without inventing shell paths',async()=>{
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json);queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{changes:[],nextCursor:null,untrackedExecutions:[],untrackedLimited:false,documents:{changes:[{operationId:'native-write',executionId:null,bindingId:'binding',path:'content://documents/document/real',namespace:'saf:original',original:true,state:'queued',scopeConfirmed:false,diff:{available:false,reason:'unconfirmed'}}],limited:true}}}));}});
 const controller=new ConversationController(()=>client);controller.extensionClient={request:client.request.bind(client),subscribe:client.subscribe.bind(client)};
 const state:UiState={...controller.snapshot(),activeId:'one',status:{phase:'ready',extensions:['managed-execution']}};
 try{render(<ExecutionPanel controller={controller} state={state}/>);fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));expect(await screen.findByText('content://documents/document/real')).toBeTruthy();expect(screen.getByText('等待其他写入完成')).toBeTruthy();expect(screen.getByText('原件')).toBeTruthy();expect(screen.queryByText('本会话暂无已知的逐文件修改记录。')).toBeNull();expect(screen.getByText('此处显示最近 20 条文档原件变更。')).toBeTruthy();
 }finally{cleanup();controller.dispose();client.dispose();}
});

it('queries the native original independently and never turns matching bytes into confirmed scope',async()=>{
 const requests:any[]=[],resourceId='a'.repeat(64),requestDigest='b'.repeat(64),uri='content://documents/document/original';
 const row={operationId:'native-write',executionId:null,bindingId:'binding',resourceId,requestDigest,path:uri,namespace:'saf:'+resourceId,sequence:2,original:true,state:'unknown',scopeConfirmed:false,diff:{available:false,reason:'unconfirmed'}};
 let mismatch=false;
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json);requests.push(request);const value=request.method==='files.list'?{changes:[],nextCursor:null,untrackedExecutions:[],untrackedLimited:false,documents:{changes:[row],limited:false}}:{...row,protocol:1,uri,resourceId:mismatch?'c'.repeat(64):resourceId,sequence:3,...(request.method==='document.verify'?{verification:{status:'read',currentDigest:'d'.repeat(64),byteLength:4,matchesExpected:false,matchesContent:true,observedAt:123}}:{})};queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));}});
 const controller=new ConversationController(()=>client);controller.extensionClient={request:client.request.bind(client),subscribe:client.subscribe.bind(client)};
 const state:UiState={...controller.snapshot(),activeId:'one',status:{phase:'ready',extensions:['managed-execution']}};
 try{render(<ExecutionPanel controller={controller} state={state}/>);fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));await screen.findByText(uri);
  fireEvent.click(screen.getByRole('button',{name:'直接核验原件状态'}));await screen.findByText('原生状态已核验');
  fireEvent.click(screen.getByRole('button',{name:'只读核验原件内容'}));await screen.findByText('本次观察的内容与本次写入相符；执行范围仍未确认。');expect(screen.queryByText('原件修改已核验')).toBeNull();
  mismatch=true;fireEvent.click(screen.getByRole('button',{name:'直接核验原件状态'}));await screen.findByRole('alert');expect(screen.getByText('原件结果待核验')).toBeTruthy();
  expect(requests.map(value=>value.method)).toEqual(['files.list','document.query','document.verify','document.query']);expect(requests.slice(1).every(value=>JSON.stringify(value.payload)===JSON.stringify({operationId:'native-write'}))).toBe(true);
 }finally{cleanup();controller.dispose();client.dispose();}
});

it('retains a verified native document terminal through stale application and native replies',async()=>{
 const resourceId='a'.repeat(64),requestDigest='b'.repeat(64),uri='content://documents/document/stable';let sequence=3;
 const row={operationId:'stable-write',executionId:null,bindingId:'binding',resourceId,requestDigest,path:uri,namespace:'saf:'+resourceId,sequence:2,original:true,state:'unknown',scopeConfirmed:false,diff:{available:false,reason:'unconfirmed'}};
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json);const value=request.method==='files.list'?{changes:[],nextCursor:null,untrackedExecutions:[],untrackedLimited:false,documents:{changes:[row],limited:false}}:{...row,protocol:1,uri,sequence,state:sequence===3?'completed':'running',scopeConfirmed:sequence===3};queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));}});
 const controller=new ConversationController(()=>client);controller.extensionClient={request:client.request.bind(client),subscribe:client.subscribe.bind(client)};const state:UiState={...controller.snapshot(),activeId:'one',status:{phase:'ready',extensions:['managed-execution']}};
 try{render(<ExecutionPanel controller={controller} state={state}/>);fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));await screen.findByText(uri);fireEvent.click(screen.getByRole('button',{name:'直接核验原件状态'}));await screen.findByText('原件修改已核验');
  fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));await screen.findByRole('button',{name:'查看文件变更'});expect(screen.getByText('原件修改已核验')).toBeTruthy();
  sequence=2;fireEvent.click(screen.getByRole('button',{name:'直接核验原件状态'}));await screen.findByRole('alert');expect(screen.getByText('原件修改已核验')).toBeTruthy();expect(screen.queryByText('原件结果待核验')).toBeNull();
 }finally{cleanup();controller.dispose();client.dispose();}
});
