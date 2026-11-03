import {describe,it,expect} from 'vitest';
import {ApplicationClient} from '../src/client';
import type {ApplicationRequest,ConversationSnapshot} from '../../runtime/src/application-protocol';

const snapshot=(revision:number,text:string):ConversationSnapshot=>({id:'conversation-1',revision,conversation:{id:'conversation-1',title:'会话一',model:{provider:'test',modelId:'one',name:'模型一'},workspaceId:'default',projectId:null,createdAt:1,phase:'running'},entries:[],progress:{text,persisted:false},phase:'running',storedSeq:4});

describe('public application connection',()=>{
  it('correlates a native reply and exposes a recognizable action failure',async()=>{
    const sent:ApplicationRequest[]=[];
    const client=new ApplicationClient({postMessage:json=>sent.push(JSON.parse(json))});
    const result=client.request('status');
    const request=sent[0];
    client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{phase:'ready',extensions:['conversation']}});
    await expect(result).resolves.toEqual({phase:'ready',extensions:['conversation']});
    const rejected=client.request('create',{creationId:'creation-1'});
    const creation=sent[1];
    client.receive({type:'response',protocol:1,connectionId:creation.connectionId,requestId:creation.requestId,ok:false,error:{code:'CONFIG_LOADING',message:'配置正在载入'}});
    await expect(rejected).rejects.toMatchObject({code:'CONFIG_LOADING',message:'配置正在载入'});
    client.dispose();
  });
  it('resynchronizes by snapshot and ignores old connections, subscriptions and revisions without stopping execution',async()=>{
    const sent:ApplicationRequest[]=[];
    const port={postMessage:(json:string)=>sent.push(JSON.parse(json))};
    const client=new ApplicationClient(port);const seen:string[]=[];
    const subscribing=client.subscribe('conversation-1',value=>seen.push(value.progress?.text??''));
    const subscribe=sent[0];const subscriptionId=subscribe.payload!.subscriptionId as string;
    client.receive({type:'conversation',protocol:1,connectionId:client.connectionId,subscriptionId,snapshot:snapshot(3,'新进度')});
    client.receive({type:'response',protocol:1,connectionId:client.connectionId,requestId:subscribe.requestId,ok:true,value:snapshot(2,'旧快照')});
    const subscription=await subscribing;
    expect(seen).toEqual(['新进度']);
    client.receive({type:'conversation',protocol:1,connectionId:client.connectionId,subscriptionId,snapshot:snapshot(1,'迟到内容')});
    client.dispose();
    const next=new ApplicationClient(port);const reopened:string[]=[];
    const reconnect=next.subscribe('conversation-1',value=>reopened.push(value.progress?.text??''));
    const latest=sent.at(-1)!;
    next.receive({type:'conversation',protocol:1,connectionId:client.connectionId,subscriptionId,snapshot:snapshot(100,'旧连接迟到')});
    next.receive({type:'response',protocol:1,connectionId:next.connectionId,requestId:latest.requestId,ok:true,value:snapshot(4,'完整当前状态')});
    await reconnect;
    expect(reopened).toEqual(['完整当前状态']);expect(seen).toEqual(['新进度']);
    expect(sent.map(request=>request.method)).toEqual(['subscribe','unsubscribe','subscribe']);
    subscription.unsubscribe();next.dispose();
    expect(sent.some(request=>request.method==='stop'||request.method==='send')).toBe(false);
  });
});
