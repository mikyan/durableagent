import {it,expect} from 'vitest';
import {InputPlatform} from './input-platform';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import type {ApplicationRequest,ConversationSnapshot,ConversationSummary} from '../../runtime/src/application-protocol';

it('rebuilding the page reacquires the selected conversation without accepting another input',async()=>{
  const native=new InputPlatform();
  const conversations:ConversationSummary[]=[];const inputs:string[]=[];let current:ApplicationClient;
  const snapshot=():ConversationSnapshot=>({id:'product-1',revision:2,conversation:conversations[0],entries:inputs.map((text,index)=>({id:String(index+1),role:'user',text,persisted:true})),phase:'done',storedSeq:8});
  const connect=()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      let value:unknown;
      if(request.method==='status')value={phase:'ready',extensions:['conversation']};
      if(request.method==='list')value={conversations:[...conversations]};
      if(request.method==='create') {
        const conversation:ConversationSummary={id:'product-1',title:'新会话',model:{provider:'test',modelId:'one',name:'模型一'},workspaceId:'default',projectId:null,createdAt:1,phase:'idle'};
        native.rememberConversation(conversation);conversations.push(conversation);value={conversation,storedSeq:3};
      }
      if(request.method==='open'||request.method==='subscribe')value=snapshot();
      if(request.method==='history')value={items:snapshot().entries};
      if(request.method==='send'){inputs.push(native.frozen.get(String(request.payload!.inputToken))!.text);value={submissionId:'input-1',storedSeq:8,status:'accepted'};}
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }});current=client;return client;
  };
  const saved=new Map<string,string>();const preferences={get:(key:string)=>saved.get(key)??null,set:(key:string,value:string)=>saved.set(key,value)};
  const first=new ConversationController(connect,preferences);await first.connect();await first.create();
  expect(first.snapshot().activeId).toBe('product-1');await first.send('只发送一次');first.dispose();
  const second=new ConversationController(connect,preferences);await second.connect();
  expect(second.snapshot().history.map(message=>message.text)).toEqual(['只发送一次']);
  expect(inputs).toEqual(['只发送一次']);expect(conversations).toHaveLength(1);
  second.dispose();
});

it('waits for configuration and pages older history through the same public connection',async()=>{
  const native=new InputPlatform();
  let configured=false;const requests:ApplicationRequest[]=[];
  const summary:ConversationSummary={id:'product-1',title:'历史',model:{provider:'test',modelId:'one',name:'模型一'},workspaceId:'default',projectId:null,createdAt:1,phase:'running'};
  native.rememberConversation(summary);
  const current:ConversationSnapshot={id:summary.id,revision:4,conversation:summary,entries:[{id:'30',role:'user',text:'较新输入',persisted:true}],phase:'running',storedSeq:30};
  const connect=()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      const value=request.method==='status'?{phase:configured?'ready':'configuring',extensions:['conversation']}:request.method==='list'?{conversations:[summary]}:request.method==='history'?(request.payload?.cursor?{items:[{id:'2',role:'user',text:'较早输入',persisted:true}]}:{items:current.entries,next:'older-page'}):request.method==='stop'?{status:'stopped',storedSeq:31}:current;
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }});return client;
  };
  const controller=new ConversationController(connect);await controller.connect();await controller.create();await controller.send('不能启动');
  expect(requests.map(request=>request.method)).toEqual(['status','input.list']);
  configured=true;await controller.refresh();await controller.open(summary.id);await controller.loadOlder();
  expect(controller.snapshot().history.map(message=>message.text)).toEqual(['较早输入','较新输入']);
  expect(controller.snapshot().next).toBeUndefined();
  await controller.stop();expect(requests.filter(request=>request.method==='stop')).toHaveLength(1);
  expect(new Set(requests.map(request=>request.connectionId)).size).toBe(1);
  controller.dispose();
});

it('keeps a creation retry identity across a page rebuild after a missing receipt',async()=>{
  const native=new InputPlatform();
  const products=new Map<string,ConversationSummary>();
  const saved=new Map<string,string>();
  let loseReceipt=true;
  const connect=()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}let value:unknown={};
      if(request.method==='status')value={phase:'ready',extensions:['conversation']};
      if(request.method==='list')value={conversations:[...products.values()]};
      if(request.method==='create'){
        const key=String(request.payload?.creationId);
        if(!products.has(key))products.set(key,{id:String(products.size+1),title:'一次创建',model:{provider:'test',modelId:'one',name:'模型一'},workspaceId:'default',projectId:null,createdAt:1,phase:'idle'});
        if(loseReceipt){loseReceipt=false;return;}
        native.rememberConversation(products.get(key)!);value={conversation:products.get(key),storedSeq:1};
      }
      if(request.method==='open'||request.method==='subscribe')value={id:'1',revision:1,conversation:[...products.values()][0],entries:[],phase:'idle',storedSeq:null};
      if(request.method==='history')value={items:[]};
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }},30);return client;
  };
  const preferences={get:(key:string)=>saved.get(key)??null,set:(key:string,value:string)=>{saved.set(key,value);}};
  const first=new ConversationController(connect,preferences);await first.connect();await first.create();
  expect(first.snapshot().error).toContain('尚未收到确认');first.dispose();
  const rebuilt=new ConversationController(connect,preferences);await rebuilt.connect();await rebuilt.create();
  expect(rebuilt.snapshot().activeId).toBe('1');expect(rebuilt.snapshot().conversations.map(item=>item.id)).toEqual(['1']);expect(products.size).toBe(1);
  rebuilt.dispose();
});
