// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {App} from '../src/App';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest,ConversationSnapshot,ConversationSummary,HistoryMessage} from '../../runtime/src/application-protocol';

afterEach(cleanup);
function consoleFixture(){
 const native=new InputPlatform(),requests:ApplicationRequest[]=[];
 const conversations:ConversationSummary[]=[
  {id:'one',title:'原件处理',model:{provider:'fixture',modelId:'one',name:'测试模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'done'},
  {id:'two',title:'旅行计划',model:{provider:'fixture',modelId:'two',name:'另一个模型'},workspaceId:'default',projectId:null,createdAt:2,phase:'idle'}
 ];
 conversations.forEach(row=>native.rememberConversation(row));
 const histories:Record<string,HistoryMessage[]>={one:[{id:'11',role:'user',text:'核对原始文件',persisted:true},{id:'12',role:'assistant',text:'已核对本次原件内容。',persisted:true}],two:[]};
 const preferences=new Map<string,string>();
 const failures:Record<string,string>={},older:Record<string,HistoryMessage[]>={};
 const controller=new ConversationController(()=>{
  const client=new ApplicationClient({postMessage:json=>{
   const request:ApplicationRequest=JSON.parse(json);requests.push(request);
   if(request.method==='input.capabilities'){queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{camera:true}}));return;}
   if(request.method==='input.select'){queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:'INPUT_PICKER_CANCELLED',message:'已取消附件选择，原草稿保持不变。'}}));return;}
   if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
   const id=String(request.payload?.id??'one'),row=conversations.find(value=>value.id===id)!;
   const snapshot:ConversationSnapshot={id,conversation:row,revision:1,entries:histories[id]??[],phase:failures[id]?'failed':row?.phase??'idle',reason:failures[id],storedSeq:1};
   const value=request.method==='status'?{phase:'ready',extensions:['conversation']}:
    request.method==='list'?{conversations}:request.method==='history'?(request.payload?.cursor?{items:older[id]??[]}:{items:histories[id]??[],next:older[id]?'previous':undefined}):
    request.method==='extensions.get'?{items:[{descriptor:{id:'timeline',title:'会话时间线'},ui:{state:'packaged'},agent:{state:'not-provided'}}]}:
    request.method==='files.list'?{changes:[],nextCursor:null,untrackedExecutions:[],untrackedLimited:false}:
    request.method==='context.get'?{id,state:'estimated',tokens:271,modelLimit:32768,messages:2,scope:'committed-messages',note:'当前上下文估算不含动态系统指令与工具定义。'}:snapshot;
   queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
  }});return client;
 },{get:key=>preferences.get(key)??null,set:(key,value)=>{preferences.set(key,value);}});
 return {controller,native,requests,conversations,histories,preferences,failures,older};
}

it('navigates between an independent home, conversation list, tools and settings without executing a command',async()=>{
 const f=consoleFixture();
 try{
  render(<App controller={f.controller}/>);
  await screen.findByText('从一个问题开始');
  expect(screen.queryByText('复制初始化命令')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'打开会话列表'}));
  fireEvent.click(screen.getByRole('button',{name:'会话列表'}));
  expect(await screen.findByRole('heading',{name:'会话列表',level:1})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'打开会话列表'}));
  fireEvent.click(screen.getByRole('button',{name:'工具'}));
  expect(await screen.findByRole('heading',{name:'工具',level:1})).toBeTruthy();
  expect(screen.getByRole('button',{name:'复制初始化命令'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'打开会话列表'}));
  fireEvent.click(screen.getByRole('button',{name:'设置'}));
  expect(await screen.findByRole('heading',{name:'设置',level:1})).toBeTruthy();
  expect(screen.getByText(/私有会话与草稿不参与系统备份/)).toBeTruthy();
  expect(f.requests.some(row=>['send','create','execution.connect','execution.copySetup'].includes(row.method))).toBe(false);
 }finally{f.controller.dispose();}
});

it('searches only the current loaded history, jumps to the exact message and switches conversations without sharing drafts',async()=>{
 const f=consoleFixture();
 f.native.drafts.set('one',{id:'one',revision:1,stateVersion:1,text:'原件草稿',committed:true,selections:[]});
 f.native.drafts.set('two',{id:'two',revision:1,stateVersion:1,text:'旅行草稿',committed:true,selections:[]});
 try{
  render(<App controller={f.controller}/>);
  fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  await waitFor(()=>expect((screen.getByRole('textbox',{name:'消息'}) as HTMLTextAreaElement).value).toBe('原件草稿'));
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));
  const dialog=screen.getByRole('dialog',{name:'会话详情'});
  fireEvent.change(within(dialog).getByRole('searchbox',{name:'搜索当前会话'}),{target:{value:'原件内容'}});
  expect(within(dialog).getByText('已搜索当前加载的 2 条记录；历史已全部载入。')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:/定位消息.*已核对本次原件内容/}));
  const selected=screen.getAllByTestId('history-message').find(row=>row.dataset.messageId==='12')!;
  expect(document.activeElement).toBe(selected);
  expect(selected.dataset.highlighted).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));
  fireEvent.click(screen.getByRole('button',{name:'下一个会话'}));
  await waitFor(()=>expect((screen.getByRole('textbox',{name:'消息'}) as HTMLTextAreaElement).value).toBe('旅行草稿'));
  expect(screen.queryByText('已核对本次原件内容。')).toBeNull();
  expect(f.preferences.get('selectedConversation')).toBe('two');
  expect(f.requests.some(row=>row.method==='send')).toBe(false);
 }finally{f.controller.dispose();}
});

it('labels actual context projection as an estimate and explains YOLO separately from system permissions',async()=>{
 const f=consoleFixture();
 try{
  render(<App controller={f.controller}/>);
  fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  expect(await screen.findByText(/上下文约 271/)).toBeTruthy();
  expect(screen.getByText('YOLO')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));
  const dialog=screen.getByRole('dialog',{name:'会话详情'});
  expect(within(dialog).getByText(/32,768/)).toBeTruthy();
  expect(within(dialog).getByText(/当前上下文估算不含动态系统指令/)).toBeTruthy();
  expect(within(dialog).getByText(/操作无需应用逐项审批/)).toBeTruthy();
  expect(within(dialog).getByText(/系统授权/)).toBeTruthy();
 }finally{f.controller.dispose();}
});

it('opens real file changes and a packaged UI extension in the conversation auxiliary area, releasing only its UI subscription',async()=>{
 const f=consoleFixture();
 try{
  render(<App controller={f.controller}/>);fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  await screen.findByText('已核对本次原件内容。');
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));
  fireEvent.click(screen.getByRole('button',{name:'文件变更与执行'}));
  const panel=screen.getByRole('dialog',{name:'会话辅助区域'});
  fireEvent.click(within(panel).getByRole('button',{name:'查看文件变更'}));
  await waitFor(()=>expect(f.requests.some(row=>row.method==='files.list'&&row.payload?.id==='one')).toBe(true));
  fireEvent.click(within(panel).getByRole('button',{name:'扩展'}));
  fireEvent.click(await within(panel).findByRole('button',{name:'打开时间线'}));
  expect(await within(panel).findByTestId('extension-timeline')).toBeTruthy();
  await waitFor(()=>expect(f.requests.filter(row=>row.method==='subscribe').length).toBe(2));
  fireEvent.click(within(panel).getByRole('button',{name:'关闭辅助区域'}));
  await waitFor(()=>expect(f.requests.filter(row=>row.method==='unsubscribe').length).toBe(1));
  expect(screen.getByText('已核对本次原件内容。')).toBeTruthy();
  expect(f.requests.some(row=>['stop','send','input.stop'].includes(row.method))).toBe(false);
 }finally{f.controller.dispose();}
});

it('shows the question strip only above the visible transcript and supports jump and dismiss',async()=>{
 const f=consoleFixture();
 try{
  render(<App controller={f.controller}/>);fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  await screen.findByText('已核对本次原件内容。');
  const input=screen.getAllByTestId('history-message').find(row=>row.dataset.messageId==='11')!;
  const viewport=input.closest('.thread-scroll')!;
  const rect=(top:number,bottom:number)=>({top,bottom,height:bottom-top,left:0,right:400,width:400,x:0,y:top,toJSON:()=>({})});
  vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue(rect(100,700));
  const position=vi.spyOn(input,'getBoundingClientRect').mockReturnValue(rect(120,180));
  fireEvent.scroll(viewport);expect(screen.queryByRole('button',{name:'回到本次输入'})).toBeNull();
  position.mockReturnValue(rect(-80,90));fireEvent.scroll(viewport);
  fireEvent.click(await screen.findByRole('button',{name:'回到本次输入'}));
  expect(document.activeElement).toBe(input);
  fireEvent.scroll(viewport);
  fireEvent.click(await screen.findByRole('button',{name:'关闭输入浮条'}));
  fireEvent.scroll(viewport);expect(screen.queryByRole('button',{name:'回到本次输入'})).toBeNull();
 }finally{vi.restoreAllMocks();f.controller.dispose();}
});

it('keeps the unloaded scope explicit until earlier records arrive and locates their stable identity',async()=>{
 const f=consoleFixture();f.older.one=[{id:'3',role:'user',text:'仅在旧页中的关键字',persisted:true}];
 try{
  render(<App controller={f.controller}/>);fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);await screen.findByText('已核对本次原件内容。');
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));const dialog=screen.getByRole('dialog',{name:'会话详情'});
  fireEvent.change(within(dialog).getByRole('searchbox',{name:'搜索当前会话'}),{target:{value:'旧页'}});
  expect(within(dialog).getByText(/还有更早记录未载入/)).toBeTruthy();
  expect(within(dialog).queryByRole('button',{name:/定位消息/})).toBeNull();
  fireEvent.click(within(dialog).getByRole('button',{name:'载入更早记录再搜索'}));
  fireEvent.click(await within(dialog).findByRole('button',{name:/定位消息.*旧页/}));
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe('3');
  expect(f.requests.filter(row=>row.method==='history'&&row.payload?.cursor).map(row=>row.payload?.id)).toEqual(['one']);
 }finally{f.controller.dispose();}
});
it('presents authentication failures in Chinese with a model settings action and retains the failure category',async()=>{
 const f=consoleFixture();f.failures.one='401 {"error":{"type":"authentication_error","message":"Invalid API key"}}';
 try{
  render(<App controller={f.controller}/>);fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  expect(await screen.findByText(/模型服务拒绝了当前凭据/)).toBeTruthy();
  expect(screen.getByText(/鉴权失败.*401/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'检查模型与凭据'}));
  expect(await screen.findByRole('heading',{name:'模型与连接',level:1})).toBeTruthy();
  expect(f.requests.some(row=>row.method==='send')).toBe(false);
 }finally{f.controller.dispose();}
});

it('offers the available native camera next to image and file picking, preserving the draft on cancellation',async()=>{
 const f=consoleFixture();f.native.drafts.set('one',{id:'one',revision:1,stateVersion:1,text:'拍照前的草稿',committed:true,selections:[]});
 try{
  render(<App controller={f.controller}/>);fireEvent.click((await screen.findAllByTestId('conversation-item'))[0]);
  await waitFor(()=>expect((screen.getByRole('textbox',{name:'消息'}) as HTMLTextAreaElement).value).toBe('拍照前的草稿'));
  fireEvent.click(screen.getByRole('button',{name:'添加附件'}));
  const menu=screen.getByRole('menu',{name:'添加附件'});
  expect(within(menu).getByRole('menuitem',{name:'选择图片'})).toBeTruthy();
  expect(within(menu).getByRole('menuitem',{name:'选择文件'})).toBeTruthy();
  fireEvent.click(await within(menu).findByRole('menuitem',{name:'拍照'}));
  await waitFor(()=>expect(f.requests.find(row=>row.method==='input.select')?.payload?.kind).toBe('camera'));
  expect((screen.getByRole('textbox',{name:'消息'}) as HTMLTextAreaElement).value).toBe('拍照前的草稿');
  expect(f.native.drafts.get('one')?.text).toBe('拍照前的草稿');
  await waitFor(()=>expect(screen.getByTestId('draft-status').dataset.state).toBe('saved'));
  expect(f.requests.some(row=>row.method==='send')).toBe(false);
 }finally{f.controller.dispose();}
});

it('opens a notification target only after it resolves to an existing conversation and never creates or resends',async()=>{
 const f=consoleFixture();
 try{
  f.controller.openTarget('two');
  render(<App controller={f.controller}/>);
  await waitFor(()=>expect(f.controller.snapshot().activeId).toBe('two'));
  await f.controller.openTarget('one');await waitFor(()=>expect(f.controller.snapshot().activeId).toBe('one'));
  await f.controller.openTarget('unknown');await f.controller.refresh();
  expect(f.controller.snapshot().activeId).toBe('one');
  expect(f.requests.some(row=>['send','create'].includes(row.method))).toBe(false);
 }finally{f.controller.dispose();}
});
