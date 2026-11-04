// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it} from 'vitest';
import {App} from '../src/App';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest,ConversationSummary} from '../../runtime/src/application-protocol';
import type {SubmissionProgress} from '../../runtime/src/submission-protocol';
import type {UiState} from '../src/controller';
import {SendStates} from '../src/extensions/submissions';

it('keeps external uncertainty visible after SDK abort and confirms completion only with native proof',()=>{
  const controller={refreshSubmissions:async()=>{}} as unknown as ConversationController;
  const control={id:'one',version:1,generation:1,stoppedThrough:1};
  const state={submissions:{items:[],control,stopping:false,stopStatus:{control,phase:'external-unconfirmed',externalPending:1,externalUnknown:1}}} as unknown as UiState;
  try{
    const {rerender}=render(<SendStates controller={controller} state={state}/>);
    expect(screen.getByTestId('stop-status').textContent).toContain('外部结果待核验');
    expect(screen.getByTestId('stop-status').textContent).not.toContain('停止完成');
    rerender(<SendStates controller={controller} state={{...state,submissions:{...state.submissions!,stopStatus:{control,phase:'stopped',externalPending:0,externalUnknown:0}}} as UiState}/>);
    expect(screen.getByTestId('stop-status').textContent).toContain('停止完成');
  }finally{cleanup();}
});

it('allows an explicit queued send and distinguishes input settlement from the conversation still running',async()=>{
  const native=new InputPlatform();const summary:ConversationSummary={id:'one',title:'仍在执行的会话',model:{provider:'fixture',modelId:'one',name:'模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'running'};native.rememberConversation(summary);
  let progress:SubmissionProgress['status']='queued';const requests:ApplicationRequest[]=[];
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
      if(request.method==='send'){void native.fixtureAdmission(String(request.payload?.intentId)).then(status=>reply({...status,submission:{status:progress}}));return;}
      if(request.method==='sendList'){void native.listSends(request.payload).then(async page=>reply({items:await Promise.all(page.intents.map(async intent=>({...await native.fixtureStatus(intent.intentId),submission:{status:progress}})))}));return;}
      const value=request.method==='status'?{phase:'ready',extensions:['conversation','submission']}:request.method==='list'?{conversations:[summary]}:request.method==='history'?{items:[]}:{id:'one',revision:1,conversation:summary,entries:[],phase:'running',storedSeq:1};
      queueMicrotask(()=>reply(value));
    }});return client;
  },{get:key=>key==='selectedConversation'?'one':null,set:()=>{}});
  try{
    render(<App controller={controller}/>);const input=await screen.findByRole('textbox',{name:'消息'});await waitFor(()=>expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input,{target:{value:'忙时明确发出的下一条输入'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    expect(await screen.findByText('已接纳 · 排队中')).toBeTruthy();expect(screen.getByText(/排队不表示模型已读取/)).toBeTruthy();
    expect(screen.getByTestId('conversation-status').dataset.phase).toBe('running');
    progress='placed';fireEvent.click(screen.getByRole('button',{name:'刷新发送状态'}));expect(await screen.findByText('已放入消息记录')).toBeTruthy();
    progress='done';fireEvent.click(screen.getByRole('button',{name:'刷新发送状态'}));expect(await screen.findByText('输入已结算')).toBeTruthy();
    expect(screen.getByText(/不代表整个会话或外部操作全部结束/)).toBeTruthy();expect(screen.getByTestId('conversation-status').dataset.phase).toBe('running');
    expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
  }finally{cleanup();controller.dispose();}
});

it('keeps a native stop request pending until the SDK interruption is confirmed and retains settled input status',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'已接纳的输入'});
  const request=(method:ApplicationRequest['method'],payload:Record<string,unknown>)=>native.apply({protocol:1,connectionId:'test',requestId:method,method,payload});
  const frozen=request('input.freeze',{id:'one',expectedRevision:1,operationId:'freeze'}) as {token:string};
  const intent=request('input.createSend',{id:'one',actionId:'intent-one',inputToken:frozen.token,expectedContext:native.read('one').submissionContext!,expectedControlVersion:0}) as {intentId:string};
  const status=await native.fixtureAdmission(intent.intentId),control=await native.readControl('one');
  request('input.stop',{id:'one',actionId:'stop-one',expectedControlVersion:control.version});
  const stopped=await native.readControl('one'),cancelled=await native.readSend(intent.intentId);
  const controller={refreshSubmissions:async()=>{},retrySubmission:async()=>{}} as unknown as ConversationController;
  const state={submissions:{items:[{intentId:intent.intentId,id:'one',createdAt:1,preview:cancelled.preview,durable:'saved',intent:cancelled,status:{...status,submission:{status:'placed'}},busy:false}],control:stopped,stopping:false}} as UiState;
  try{
    const {rerender}=render(<SendStates controller={controller} state={state}/>);
    expect(screen.getByText('已接纳 · 已请求停止')).toBeTruthy();
    expect(screen.queryByText('已接纳 · 已停止')).toBeNull();
    const confirmed=await native.confirmAbort('one',stopped.pendingAbort!);
    rerender(<SendStates controller={controller} state={{...state,submissions:{...state.submissions!,control:confirmed}}}/>);
    expect(screen.getByText('已接纳 · 会话中断已确认')).toBeTruthy();
    rerender(<SendStates controller={controller} state={{...state,submissions:{...state.submissions!,items:state.submissions!.items.map(item=>({...item,status:{...status,submission:{status:'done'}}}))}}}/>);
    expect(screen.getByText('输入已结算')).toBeTruthy();
    expect(screen.getByTestId('stop-status').textContent).toContain('等待会话中断核验');
  }finally{cleanup();}
});
