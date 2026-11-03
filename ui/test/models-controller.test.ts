import {expect,it} from 'vitest';
import type {ApplicationRequest,ConversationSnapshot,ConversationSummary} from '../../runtime/src/application-protocol';
import {MODELS_EXTENSION,type ModelConfiguration,type CredentialWriteRequest} from '../../runtime/src/model-protocol';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';

it('publishes acknowledged configuration versions and keeps default changes separate from the current conversation',async()=>{
  let configuration:ModelConfiguration={version:0,defaultModel:null,connections:[]};
  const ordinary:ApplicationRequest[]=[],credentials:CredentialWriteRequest[]=[];
  const oldModel={provider:'old',modelId:'old-model',name:'旧模型'};
  const conversation:ConversationSummary={id:'existing',title:'已有会话',model:oldModel,workspaceId:'default',projectId:null,createdAt:1,phase:'idle'};
  const current=():ConversationSnapshot=>({id:conversation.id,revision:1,conversation,entries:[],phase:'idle',storedSeq:1});
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);ordinary.push(request);let value:unknown;
      switch(request.method){
        case 'status':value={phase:'ready',extensions:['conversation',MODELS_EXTENSION.id]};break;
        case 'list':value={conversations:[conversation]};break;
        case 'models.get':value=configuration;break;
        case 'models.create':
          expect(request.payload?.expectedVersion).toBe(0);
          configuration={...configuration,version:1,connections:[{id:'new',name:'新连接',protocol:'openai-compatible',endpoint:'https://models.example/v1',models:[{id:'new-model',name:'新模型',contextWindow:8192,maxTokens:1024}],enabled:true,createdAt:1,credential:{connectionId:'new',state:'absent',generation:0,configured:false}}]};value=configuration;break;
        case 'models.setDefault':expect(request.payload?.expectedVersion).toBe(1);configuration={...configuration,version:2,defaultModel:{provider:'new',modelId:'new-model',name:'新模型'}};value=configuration;break;
        case 'models.select':conversation.model={provider:'new',modelId:'new-model',name:'新模型'};value={...current(),revision:2};break;
        case 'open':case 'subscribe':value=current();break;
        case 'history':value={items:[]};break;
        default:value={};
      }
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    },writeCredential:json=>{
      const request:CredentialWriteRequest=JSON.parse(json);credentials.push(request);
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{connectionId:request.target,state:'configured',generation:1,configured:true}}));
    }});return client;
  });
  await controller.connect();await controller.open('existing');await controller.openModels();
  expect(controller.snapshot().models?.version).toBe(0);
  await controller.createConnection({name:'新连接',protocol:'openai-compatible',endpoint:'https://models.example/v1',modelId:'new-model'});
  expect(ordinary.find(request=>request.method==='models.create')?.payload?.creationId).toMatch(/^[0-9a-f-]{36}$/);
  await controller.setDefaultModel({provider:'new',modelId:'new-model'});
  expect(controller.snapshot().models?.version).toBe(2);
  expect(controller.snapshot().conversation?.conversation.model).toEqual(oldModel);
  await controller.writeModelCredential('new','save','synthetic-controller-key');
  expect(credentials[0]).toMatchObject({target:'new',expectedGeneration:0,key:'synthetic-controller-key'});
  expect(controller.snapshot().models?.connections[0].credential.generation).toBe(1);
  expect(JSON.stringify(controller.snapshot())).not.toContain('synthetic-controller-key');
  expect(JSON.stringify(ordinary)).not.toContain('synthetic-controller-key');
  await controller.selectConversationModel({provider:'new',modelId:'new-model'});
  expect(controller.snapshot().conversation?.conversation.model.modelId).toBe('new-model');
  controller.dispose();
});
