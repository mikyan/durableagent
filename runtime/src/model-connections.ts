import {sanitizeEvent,redactResponse} from './model-secrets.js';
import {SdkProviders} from './sdk-providers.js';
import type {PrivateCredentialAccess} from './provider-auth.js';
import type {ProviderAuthRequest} from './model-protocol.js';
import type {ModelRetryAfter} from './model-retry-after.js';
import {createModels,createProvider,type Models,type Provider} from '@earendil-works/pi-ai/models';
import {xiaomiTokenPlanCnProvider} from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type {CredentialStore} from '@earendil-works/pi-ai';
import type {DeferredHandle,Model,Api} from '@earendil-works/pi-ai';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import type {ConnectionDefinition,CredentialInfo,ModelConfiguration} from './model-protocol.js';
import type {ModelSelection} from './application-protocol.js';
import {InputError,inputCapability,validateContextBudget,validateProviderInput,type ProviderInputEvidence} from './input.js';
export type CredentialAccess=PrivateCredentialAccess;
export type StoredModels={version:number;defaultModel:ModelSelection|null;connections:ConnectionDefinition[];catalogs?:Record<string,string>};
export class ModelConfigurationError extends Error {constructor(readonly code:string,message:string){super(message);}}
const failure=(code:string,message:string):never=>{throw new ModelConfigurationError(code,message);};
const marker='application-request-auth';
type Options={credentials:CredentialAccess;fetch?:typeof fetch;allowLoopbackHttp?:boolean;beforePublish?:(configuration:StoredModels)=>void;providerFactory?:(definition:ConnectionDefinition)=>Provider;onRequest?:(receipt:{connectionId:string;generation:number;endpoint:string;input:ProviderInputEvidence;requestTools:{names:string[];choice:string}})=>void};
/** Immutable connection definitions and one synchronous publication. Secrets only cross final fetch. */
export class ModelConnections {
  readonly models;
  private stored:StoredModels={version:0,defaultModel:null,connections:[]};
  private usable=false;
  private retryAfter?:ModelRetryAfter;
  private readonly sdk:SdkProviders;
  attachRetryAfter(value:ModelRetryAfter){this.retryAfter=value;}
  constructor(private readonly options:Options) {
    this.sdk=new SdkProviders(options.credentials,{enabled:id=>{this.enabled(id);},retryAfter:()=>this.retryAfter,fetch:options.fetch,onRequest:options.onRequest});
    const credentials:CredentialStore={read:async id=>{const info=await options.credentials.metadata(id);return info.configured?{type:'api_key',key:marker}:undefined;},list:async()=>{const metadata=await Promise.all(this.stored.connections.map(item=>options.credentials.metadata(item.id)));return metadata.filter(item=>item.configured).map(item=>({providerId:item.connectionId,type:'api_key' as const}));},modify:async()=>failure('NATIVE_WRITE_REQUIRED','请使用原生凭据入口'),delete:async()=>failure('NATIVE_WRITE_REQUIRED','请使用原生凭据入口')};
    this.models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
  }
  block(){this.usable=false;}
  version(){return this.stored.version;}
  contains(id:string){return this.usable&&this.stored.connections.some(item=>item.id===id);}
  capability(provider:string,modelId:string){const definition=this.stored.connections.find(item=>item.id===provider);const model=this.models.getModel(provider,modelId);return this.usable&&definition?.enabled&&model?inputCapability(model,definition.protocol==='openai-compatible'?'connection-text-only':'sdk-catalog'):undefined;}
  endpoint(value:unknown) {
    if(typeof value!=='string'||value.length>2000)return failure('INVALID_ENDPOINT','请输入有效的 HTTPS 服务地址');
    let url:URL;try{url=new URL(value);}catch{return failure('INVALID_ENDPOINT','请输入有效的 HTTPS 服务地址');}
    const local=this.options.allowLoopbackHttp&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash)return failure('INVALID_ENDPOINT','服务地址必须使用 HTTPS，且不能包含凭据、查询参数或片段');
    return url.toString().replace(/\/$/,'');
  }
  definition(payload:Record<string,unknown>):ConnectionDefinition {
    const id=payload.creationId,name=payload.name,protocol=payload.protocol;
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||typeof name!=='string'||!name.trim()||name.length>100)return failure('INVALID_ARGUMENT','连接名称或标识无效');
    if(protocol!=='mimo-cn'&&protocol!=='openai-compatible'&&protocol!=='sdk')return failure('INVALID_ARGUMENT','不支持的模型协议');
    if(protocol==='sdk'){
      if(typeof payload.providerId!=='string')return failure('INVALID_ARGUMENT','请选择模型提供方');
      const models=this.sdk.definitionModels(payload.providerId);
      return {id,name:name.trim(),protocol,providerId:payload.providerId,endpoint:payload.endpoint?this.endpoint(payload.endpoint):'',models,enabled:true,createdAt:Date.now()};
    }
    const endpoint=this.endpoint(payload.endpoint);
    const modelId=payload.modelId;
    if(protocol==='openai-compatible'&&(typeof modelId!=='string'||!modelId.trim()||modelId.length>200))return failure('INVALID_ARGUMENT','请输入模型 ID');
    const models=protocol==='mimo-cn'?xiaomiTokenPlanCnProvider().getModels().map(model=>({id:model.id,name:model.name,contextWindow:model.contextWindow,maxTokens:model.maxTokens})):[{id:modelId as string,name:modelId as string,contextWindow:32768,maxTokens:4096}];
    return {id,name:name.trim(),protocol,endpoint,models,enabled:true,createdAt:Date.now()};
  }
  selection(value:unknown,configuration=this.stored):ModelSelection {
    const ref=value as Partial<ModelSelection>|null,definition=configuration.connections.find(item=>item.id===ref?.provider),model=definition?.protocol==='sdk'?this.models.getModel(definition.id,ref?.modelId??''):definition?.models.find(item=>item.id===ref?.modelId);
    if(!definition?.enabled||!model)return failure('MODEL_UNAVAILABLE','所选模型不存在或连接已停用');
    return {provider:definition.id,modelId:model.id,name:model.name};
  }
  publish(configuration:StoredModels) {
    const next=structuredClone(configuration);
    const providers=next.connections.map(definition=>this.provider(definition,next.catalogs?.[definition.id]?JSON.parse(next.catalogs[definition.id]):undefined));
    this.options.beforePublish?.(next);
    // Synchronous, no await: readers cannot see a partially published generation.
    this.models.clearProviders();for(const provider of providers)this.models.setProvider(provider);
    this.stored=next;this.usable=true;
  }
  async publicConfiguration():Promise<ModelConfiguration> {const snapshot=this.stored;return {version:snapshot.version,defaultModel:structuredClone(snapshot.defaultModel),providers:this.sdk.catalog(),connections:await Promise.all(snapshot.connections.map(async definition=>({...structuredClone(definition),...(definition.protocol==='sdk'?{models:this.models.getModels(definition.id).map(model=>({id:model.id,name:model.name,contextWindow:model.contextWindow,maxTokens:model.maxTokens}))}:{}),credential:await this.options.credentials.metadata(definition.id)})))};}
  async refresh(id:string){return this.sdk.refresh(id);}
  authenticate(request:ProviderAuthRequest){if(!this.contains(request.target))return failure('AUTH_TARGET_UNAVAILABLE','模型连接尚未就绪');return this.sdk.authentication.request(request);}
  disconnectAuthentication(owner:string){this.sdk.authentication.disconnect(owner);}
  close(){this.sdk.close();}
  private enabled(id:string) {if(!this.usable)return failure('CONFIG_UNAVAILABLE','模型配置尚未就绪');const definition=this.stored.connections.find(item=>item.id===id);if(!definition?.enabled)return failure('CONNECTION_DISABLED','连接已停用，请重新选择模型');return definition;}
  private provider(definition:ConnectionDefinition,catalog?:Model<Api>[]):Provider {
    if(definition.protocol==='sdk')return this.sdk.provider(definition,catalog);
    this.endpoint(definition.endpoint);
    const api=openAICompletionsApi();
    const builtin=xiaomiTokenPlanCnProvider().getModels();
    const models=definition.models.map(item=>{const catalog=builtin.find(model=>definition.protocol==='mimo-cn'&&model.id===item.id);return {...catalog,...item,api:'openai-completions' as const,provider:definition.id,baseUrl:definition.endpoint,reasoning:false,input:catalog?.input??['text' as const],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};});
    const provider=this.options.providerFactory?.(definition)??createProvider({id:definition.id,name:definition.name,baseUrl:definition.endpoint,models,auth:{apiKey:{name:'应用凭据',resolve:async()=>({auth:{apiKey:marker}})}},api});
    const checkedFetch=(admission:{generation:number;secrets:Set<string>;expectedGeneration?:number;inputFailure?:string;preDispatchWait?:boolean},model:Model<Api>):typeof fetch=>async(input,init)=>{
      const request=new Request(input,init);this.enabled(definition.id);
      if(request.url!==`${definition.endpoint}/chat/completions`||request.method!=='POST')return failure('DESTINATION_REJECTED','模型请求地址不符合连接定义');
      let inputEvidence:ProviderInputEvidence;
      try{inputEvidence=await validateProviderInput(request,model);}catch(error){if(error instanceof InputError)admission.inputFailure=error.message;throw error;}
      const body=this.options.onRequest?await request.clone().json() as any:undefined;
      const toolName=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:'invalid';
      const requestTools={names:Array.isArray(body?.tools)?body.tools.map((tool:any)=>toolName(tool?.function?.name)):[],choice:body?.tool_choice===undefined?'default':['auto','none','required'].includes(body.tool_choice)?body.tool_choice:body.tool_choice?.type==='function'?'function:'+toolName(body.tool_choice.function?.name):'other'};
      const credential=await this.options.credentials.resolve(definition.id).catch(error=>{if(error instanceof ModelConfigurationError)throw error;return failure('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');});
      if(admission.expectedGeneration!==undefined&&credential.generation!==admission.expectedGeneration)return failure('DEFERRED_ACCOUNT_UNKNOWN','旧响应凭据兼容性未确认，请处理原响应。');
      // Recheck after asynchronous credential resolution. Already sent requests continue unchanged.
      this.enabled(definition.id);
      const current=await this.options.credentials.metadata(definition.id);
      if(!current.configured||current.generation!==credential.generation)return failure('CREDENTIAL_CHANGED','凭据已变更，请重试');
      this.enabled(definition.id); // Final synchronous gate after the last asynchronous read.
      // No await between this final eligibility check and fetch: another
      // response may have extended the deadline during credential resolution.
      if(this.retryAfter?.until(definition.id)!==undefined){admission.preDispatchWait=true;return failure('MODEL_NOT_BEFORE','等待模型服务允许下一次请求');}
      admission.generation=credential.generation;
      admission.secrets.add(credential.key);
      const headers=new Headers(request.headers);headers.delete('authorization');headers.delete('api-key');
      headers.set(definition.protocol==='mimo-cn'?'api-key':'authorization',definition.protocol==='mimo-cn'?credential.key:`Bearer ${credential.key}`);
      let response:Response;
      this.options.onRequest?.({connectionId:definition.id,generation:credential.generation,endpoint:definition.endpoint,input:inputEvidence,requestTools});
      try{response=await (this.options.fetch??fetch)(new Request(request,{headers,redirect:'error'}));}catch{return failure('MODEL_NETWORK_ERROR','模型网络请求失败');}
      if(response.status===429||response.status===503)await this.retryAfter?.record(definition.id,response.headers.get('retry-after'));
      return redactResponse(response,credential.key);
    };
    const invoke=(model:Model<Api>,options:any,run:(options:any,handle?:DeferredHandle)=>AssistantMessageEventStream,handle?:DeferredHandle,transcript?:{messages:readonly {content:unknown}[]})=>{
      const output=new AssistantMessageEventStream();
      void (async()=>{
        try {
          if(transcript)validateContextBudget(transcript);
          // The upstream adapter replaces unsupported images with a text placeholder.
          // Refuse before that transformation, including images retained in prior history.
          if(!model.input.includes('image')&&transcript?.messages.some(message=>Array.isArray(message.content)&&message.content.some((part:any)=>part.type==='image')))failure('IMAGE_UNSUPPORTED','当前模型未声明支持图片，请更换模型或开启不含图片的新会话');
          if(options?.apiKey!==marker||Object.keys(options?.headers??{}).length||Object.keys(options?.env??{}).length)failure('AUTH_OVERRIDE_REJECTED','模型请求不能覆盖应用凭据');
          if(model.baseUrl!==definition.endpoint)failure('DESTINATION_REJECTED','模型请求地址不符合连接定义');
          if(handle){
            if(!this.usable)failure('CONFIG_UNAVAILABLE','旧响应配置尚未就绪，请处理原响应。');
            if(!this.stored.connections.find(item=>item.id===definition.id)?.enabled)failure('DEFERRED_DISABLED','旧连接已停用，请处理原响应。');
          }else this.enabled(definition.id);
          // Eligibility is outside the provider HTTP timeout and is abortable.
          // This loop only rebuilds a provider invocation that sent no request.
          for(;;){
            await this.retryAfter?.wait(definition.id,options?.signal);
            this.enabled(definition.id);
            const credential=await this.options.credentials.metadata(definition.id);
            let original=handle;
            if(handle){
              const data=handle.data as any,stamp=data?.appCredential;
              if(handle.provider!==definition.id||handle.modelId!==model.id||stamp?.version!==1||stamp.connectionId!==definition.id)failure('DEFERRED_UNRECOVERABLE','旧响应无法恢复，请处理原响应。');
              if(!credential.configured||stamp.generation!==credential.generation)failure('DEFERRED_ACCOUNT_UNKNOWN','旧响应凭据兼容性未确认，请处理原响应。');
              original={...handle,data:data.providerData??undefined};
            }else if(!credential.configured)failure('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');
            const admission:{generation:number;secrets:Set<string>;expectedGeneration?:number;inputFailure?:string;preDispatchWait?:boolean}={generation:credential.generation,secrets:new Set<string>(),expectedGeneration:handle?credential.generation:undefined};
            const selected={...options,apiKey:marker,headers:undefined,fetch:checkedFetch(admission,model),onProviderStreamEvent:options?.onProviderStreamEvent?((event:unknown)=>options.onProviderStreamEvent(sanitizeEvent(event,admission.secrets))):undefined,maxRetries:0,timeoutMs:45000,maxTokens:Math.min(options?.maxTokens??1024,4096),...(definition.protocol==='mimo-cn'?{reasoning:'off',samplingParams:{thinking:{type:'disabled'}}}:{})};
            for await(const event of run(selected,original)){
              if(admission.preDispatchWait)continue;
              if(admission.inputFailure&&event.type==='error')event.error.errorMessage=admission.inputFailure;
              if(event.type==='done'&&event.message.deferred){event.message.deferred={...event.message.deferred,data:{appCredential:{version:1,connectionId:definition.id,generation:admission.generation},providerData:event.message.deferred.data??null}};}
              // Provider JSON parsing can decode escaped credentials that byte filtering cannot see.
              // Each invocation retains its sent credential, even if the vault is rotated meanwhile.
              output.push(sanitizeEvent(event,admission.secrets));
            }
            if(!admission.preDispatchWait)break;
          }
        }catch(error){
          const message=error instanceof ModelConfigurationError||error instanceof InputError?error.message:'模型请求无法完成，请检查连接设置';
          output.push({type:'error',reason:'error',error:{role:'assistant',content:[],api:model.api,provider:definition.id,model:model.id,stopReason:'error',errorMessage:message,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});
        }
      })();return output;
    };
    return {...provider,id:definition.id,getModels:()=>models,auth:{apiKey:{name:'应用凭据',resolve:async()=>({auth:{apiKey:marker,baseUrl:definition.endpoint}})}},stream:(m,c,o)=>invoke(m,o,selected=>provider.stream(m,c,selected),undefined,c),streamSimple:(m,c,o)=>invoke(m,o,selected=>provider.streamSimple(m,c,selected),undefined,c),...(provider.fetchDeferred?{fetchDeferred:(m:Model<Api>,handle:DeferredHandle,o:any)=>invoke(m,o,(selected,original)=>provider.fetchDeferred!(m,original!,selected),handle)}:{})};
  }
}
