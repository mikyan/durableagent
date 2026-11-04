// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {ApplicationClient} from '../src/client';
import Timeline from '../src/extensions/timeline';
import type {ApplicationRequest,ConversationSnapshot} from '../../runtime/src/application-protocol';
afterEach(cleanup);
it('UI-only timeline pages real Interface messages, observes current progress and releases only its own subscription',async()=>{
 const requests:ApplicationRequest[]=[];let subscription:ApplicationRequest|undefined;
 const snapshot:ConversationSnapshot={id:'target',revision:1,conversation:{id:'target',title:'Timeline',model:{provider:'p',modelId:'m',name:'M'},workspaceId:'default',projectId:null,createdAt:1,phase:'running'},entries:[{id:'20',role:'assistant',text:'最近的已保存回复',persisted:true}],phase:'running',storedSeq:5};
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json) as ApplicationRequest;requests.push(request);if(request.method==='unsubscribe')return;let value:unknown;
  if(request.method==='history')value=request.payload?.cursor?{items:[{id:'1',role:'user',text:'最初的输入',persisted:true}]}:{items:snapshot.entries,next:'opaque-old'};
  else if(request.method==='subscribe'){subscription=request;value=snapshot;}
  else throw Error('Unexpected UI-only operation');
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
 }});
 const page=render(<Timeline client={client} conversationId="target"/>);
 expect(await screen.findByText('最近的已保存回复')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'加载更早记录'}));
 expect(await screen.findByText('最初的输入')).toBeTruthy();expect(requests.find(r=>r.payload?.cursor)?.payload?.cursor).toBe('opaque-old');
 act(()=>client.receive({type:'conversation',protocol:1,connectionId:client.connectionId,subscriptionId:String(subscription!.payload!.subscriptionId),snapshot:{...snapshot,revision:2,progress:{text:'仍在生成',persisted:false}}}));
 expect(screen.getByText('仍在生成')).toBeTruthy();expect(screen.getByText('生成中 · 尚未保存')).toBeTruthy();
 page.unmount();await waitFor(()=>expect(requests.filter(r=>r.method==='unsubscribe')).toHaveLength(1));expect(requests.some(r=>r.method==='stop'||r.method==='send')).toBe(false);client.dispose();
});
it('subscription failure is observation loss, never a fabricated completed conversation',async()=>{
 let subscription:ApplicationRequest;const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json) as ApplicationRequest;if(request.method==='unsubscribe')return;if(request.method==='subscribe')subscription=request;
  queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:request.method==='history'?{items:[]}:{id:'target',revision:1,entries:[],phase:'running',storedSeq:1,conversation:{id:'target',phase:'running'}}}));
 }});
 render(<Timeline client={client} conversationId="target"/>);await waitFor(()=>expect(subscription!).toBeTruthy());
 act(()=>client.receive({type:'subscription-error',protocol:1,connectionId:client.connectionId,subscriptionId:String(subscription!.payload!.subscriptionId),error:{code:'OBSERVATION_UNAVAILABLE',message:'流已断开'}} as any));
 expect((await screen.findByRole('alert')).textContent).toContain('这不表示会话已完成');client.dispose();
});
it('late history from a previous conversation cannot enter the new timeline, and long records mount full text only on explicit expand',async()=>{
 let finishOlder:(value:unknown)=>void=()=>{};const full='x'.repeat(90000)+'完整尾部';
 const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json) as ApplicationRequest;if(request.method==='unsubscribe')return;
  const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
  if(request.method==='history'&&request.payload?.cursor){finishOlder=reply;return;}
  const second=request.payload?.id==='second';const entries=second?[{id:'40',role:'user',text:full,persisted:true}]:[{id:'20',role:'user',text:'first conversation',persisted:true}];
  queueMicrotask(()=>reply(request.method==='history'?{items:entries,...(!second?{next:'first-older'}:{})}:{id:request.payload?.id,revision:1,entries,phase:'idle',storedSeq:1,conversation:{id:request.payload?.id,phase:'idle'}}));
 }});
 const page=render(<Timeline client={client} conversationId="first"/>);await screen.findByText('first conversation');fireEvent.click(screen.getByRole('button',{name:'加载更早记录'}));
 page.rerender(<Timeline client={client} conversationId="second"/>);await screen.findByText(/长记录已折叠/);
 await act(async()=>{finishOlder({items:[{id:'1',role:'user',text:'stale old history',persisted:true}]});await Promise.resolve();});
 await waitFor(()=>expect(screen.queryByText('stale old history')).toBeNull());expect(screen.queryByText(full)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'展开完整记录'}));expect(screen.getByText(full)).toBeTruthy();client.dispose();
});
