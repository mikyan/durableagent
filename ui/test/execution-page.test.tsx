// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {ExecutionPanel} from '../src/extensions/execution';
import {ConversationController,type UiState} from '../src/controller';
import {ApplicationClient} from '../src/client';

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

