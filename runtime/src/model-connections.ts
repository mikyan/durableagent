import {createModels,createProvider,type Models,type Provider} from '@earendil-works/pi-ai/models';
import {xiaomiTokenPlanCnProvider} from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type {CredentialStore} from '@earendil-works/pi-ai';
import type {DeferredHandle,Model,Api} from '@earendil-works/pi-ai';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import type {ConnectionDefinition,CredentialInfo,ModelConfiguration} from './model-protocol.js';
import type {ModelSelection} from './application-protocol.js';
export type CredentialAccess={metadata(id:string):Promise<CredentialInfo>;resolve(id:string):Promise<{key:string;generation:number}>};
export type StoredModels={version:number;defaultModel:ModelSelection|null;connections:ConnectionDefinition[]};
export class ModelConfigurationError extends Error {constructor(readonly code:string,message:string){super(message);}}
const failure=(code:string,message:string):never=>{throw new ModelConfigurationError(code,message);};
const marker='application-request-auth';
type Options={credentials:CredentialAccess;fetch?:typeof fetch;allowLoopbackHttp?:boolean;beforePublish?:(configuration:StoredModels)=>void;providerFactory?:(definition:ConnectionDefinition)=>Provider;onRequest?:(receipt:{connectionId:string;generation:number;endpoint:string})=>void};
/** Immutable connection definitions and one synchronous publication. Secrets only cross final fetch. */
export class ModelConnections {
  readonly models;
  private stored:StoredModels={version:0,defaultModel:null,connections:[]};
  private usable=false;
  constructor(private readonly options:Options) {
    const credentials:CredentialStore={read:async id=>{const info=await options.credentials.metadata(id);return info.configured?{type:'api_key',key:marker}:undefined;},list:async()=>{const metadata=await Promise.all(this.stored.connections.map(item=>options.credentials.metadata(item.id)));return metadata.filter(item=>item.configured).map(item=>({providerId:item.connectionId,type:'api_key' as const}));},modify:async()=>failure('NATIVE_WRITE_REQUIRED','请使用原生凭据入口'),delete:async()=>failure('NATIVE_WRITE_REQUIRED','请使用原生凭据入口')};
    this.models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
  }
  block(){this.usable=false;}
  version(){return this.stored.version;}
  contains(id:string){return this.usable&&this.stored.connections.some(item=>item.id===id);}
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
    if(protocol!=='mimo-cn'&&protocol!=='openai-compatible')return failure('INVALID_ARGUMENT','不支持的模型协议');
    const endpoint=this.endpoint(payload.endpoint);
    const modelId=payload.modelId;
    if(protocol==='openai-compatible'&&(typeof modelId!=='string'||!modelId.trim()||modelId.length>200))return failure('INVALID_ARGUMENT','请输入模型 ID');
    const models=protocol==='mimo-cn'?xiaomiTokenPlanCnProvider().getModels().map(model=>({id:model.id,name:model.name,contextWindow:model.contextWindow,maxTokens:model.maxTokens})):[{id:modelId as string,name:modelId as string,contextWindow:32768,maxTokens:4096}];
    return {id,name:name.trim(),protocol,endpoint,models,enabled:true,createdAt:Date.now()};
  }
  selection(value:unknown,configuration=this.stored):ModelSelection {
    const ref=value as Partial<ModelSelection>|null,definition=configuration.connections.find(item=>item.id===ref?.provider),model=definition?.models.find(item=>item.id===ref?.modelId);
    if(!definition?.enabled||!model)return failure('MODEL_UNAVAILABLE','所选模型不存在或连接已停用');
    return {provider:definition.id,modelId:model.id,name:model.name};
  }
  publish(configuration:StoredModels) {
    const next=structuredClone(configuration);
    const providers=next.connections.map(definition=>this.provider(definition));
    this.options.beforePublish?.(next);
    // Synchronous, no await: readers cannot see a partially published generation.
    this.models.clearProviders();for(const provider of providers)this.models.setProvider(provider);
    this.stored=next;this.usable=true;
  }
  async publicConfiguration():Promise<ModelConfiguration> {const snapshot=this.stored;return {...structuredClone(snapshot),connections:await Promise.all(snapshot.connections.map(async definition=>({...structuredClone(definition),credential:await this.options.credentials.metadata(definition.id)})))};}
  private enabled(id:string) {if(!this.usable)return failure('CONFIG_UNAVAILABLE','模型配置尚未就绪');const definition=this.stored.connections.find(item=>item.id===id);if(!definition?.enabled)return failure('CONNECTION_DISABLED','连接已停用，请重新选择模型');return definition;}
  private provider(definition:ConnectionDefinition):Provider {
    this.endpoint(definition.endpoint);
    const api=openAICompletionsApi();
    const builtin=xiaomiTokenPlanCnProvider().getModels();
    const models=definition.models.map(item=>({...builtin.find(model=>definition.protocol==='mimo-cn'&&model.id===item.id),...item,api:'openai-completions' as const,provider:definition.id,baseUrl:definition.endpoint,reasoning:false,input:['text' as const],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}));
    const provider=this.options.providerFactory?.(definition)??createProvider({id:definition.id,name:definition.name,baseUrl:definition.endpoint,models,auth:{apiKey:{name:'应用凭据',resolve:async()=>({auth:{apiKey:marker}})}},api});
    const checkedFetch=(admission:{generation:number;secrets:Set<string>;expectedGeneration?:number}):typeof fetch=>async(input,init)=>{
      const request=new Request(input,init);this.enabled(definition.id);
      if(request.url!==`${definition.endpoint}/chat/completions`||request.method!=='POST')return failure('DESTINATION_REJECTED','模型请求地址不符合连接定义');
      const credential=await this.options.credentials.resolve(definition.id).catch(error=>{if(error instanceof ModelConfigurationError)throw error;return failure('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');});
      if(admission.expectedGeneration!==undefined&&credential.generation!==admission.expectedGeneration)return failure('DEFERRED_ACCOUNT_UNKNOWN','旧响应凭据兼容性未确认，请处理原响应。');
      // Recheck after asynchronous credential resolution. Already sent requests continue unchanged.
      this.enabled(definition.id);
      const current=await this.options.credentials.metadata(definition.id);
      if(!current.configured||current.generation!==credential.generation)return failure('CREDENTIAL_CHANGED','凭据已变更，请重试');
      this.enabled(definition.id); // Final synchronous gate after the last asynchronous read.
      admission.generation=credential.generation;
      admission.secrets.add(credential.key);
      const headers=new Headers(request.headers);headers.delete('authorization');headers.delete('api-key');
      headers.set(definition.protocol==='mimo-cn'?'api-key':'authorization',definition.protocol==='mimo-cn'?credential.key:`Bearer ${credential.key}`);
      let response:Response;
      this.options.onRequest?.({connectionId:definition.id,generation:credential.generation,endpoint:definition.endpoint});
      try{response=await (this.options.fetch??fetch)(new Request(request,{headers,redirect:'error'}));}catch{return failure('MODEL_NETWORK_ERROR','模型网络请求失败');}
      return redactResponse(response,credential.key);
    };
    const invoke=(model:Model<Api>,options:any,run:(options:any,handle?:DeferredHandle)=>AssistantMessageEventStream,handle?:DeferredHandle)=>{
      const output=new AssistantMessageEventStream();
      void (async()=>{
        try {
          if(options?.apiKey!==marker||Object.keys(options?.headers??{}).length||Object.keys(options?.env??{}).length)failure('AUTH_OVERRIDE_REJECTED','模型请求不能覆盖应用凭据');
          if(model.baseUrl!==definition.endpoint)failure('DESTINATION_REJECTED','模型请求地址不符合连接定义');
          if(handle){
            if(!this.usable)failure('CONFIG_UNAVAILABLE','旧响应配置尚未就绪，请处理原响应。');
            if(!this.stored.connections.find(item=>item.id===definition.id)?.enabled)failure('DEFERRED_DISABLED','旧连接已停用，请处理原响应。');
          }else this.enabled(definition.id);
          const credential=await this.options.credentials.metadata(definition.id);
          let original=handle;
          if(handle){
            const data=handle.data as any,stamp=data?.appCredential;
            if(handle.provider!==definition.id||handle.modelId!==model.id||stamp?.version!==1||stamp.connectionId!==definition.id)failure('DEFERRED_UNRECOVERABLE','旧响应无法恢复，请处理原响应。');
            if(!credential.configured||stamp.generation!==credential.generation)failure('DEFERRED_ACCOUNT_UNKNOWN','旧响应凭据兼容性未确认，请处理原响应。');
            original={...handle,data:data.providerData??undefined};
          }else if(!credential.configured)failure('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');
          const admission={generation:credential.generation,secrets:new Set<string>(),expectedGeneration:handle?credential.generation:undefined};
          const selected={...options,apiKey:marker,headers:undefined,fetch:checkedFetch(admission),onProviderStreamEvent:options?.onProviderStreamEvent?((event:unknown)=>options.onProviderStreamEvent(sanitizeEvent(event,admission.secrets))):undefined,maxRetries:0,timeoutMs:45000,maxTokens:Math.min(options?.maxTokens??1024,4096),...(definition.protocol==='mimo-cn'?{reasoning:'off',samplingParams:{thinking:{type:'disabled'}}}:{})};
          for await(const event of run(selected,original)){
            if(event.type==='done'&&event.message.deferred){event.message.deferred={...event.message.deferred,data:{appCredential:{version:1,connectionId:definition.id,generation:admission.generation},providerData:event.message.deferred.data??null}};}
            // Provider JSON parsing can decode escaped credentials that byte filtering cannot see.
            // Each invocation retains its sent credential, even if the vault is rotated meanwhile.
            output.push(sanitizeEvent(event,admission.secrets));
          }
        }catch(error){
          const message=error instanceof ModelConfigurationError?error.message:'模型请求无法完成，请检查连接设置';
          output.push({type:'error',reason:'error',error:{role:'assistant',content:[],api:model.api,provider:definition.id,model:model.id,stopReason:'error',errorMessage:message,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});
        }
      })();return output;
    };
    return {...provider,id:definition.id,getModels:()=>models,auth:{apiKey:{name:'应用凭据',resolve:async()=>({auth:{apiKey:marker,baseUrl:definition.endpoint}})}},stream:(m,c,o)=>invoke(m,o,selected=>provider.stream(m,c,selected)),streamSimple:(m,c,o)=>invoke(m,o,selected=>provider.streamSimple(m,c,selected)),...(provider.fetchDeferred?{fetchDeferred:(m:Model<Api>,handle:DeferredHandle,o:any)=>invoke(m,o,(selected,original)=>provider.fetchDeferred!(m,original!,selected),handle)}:{})};
  }
}
function sanitizeEvent<T>(event:T,secrets:ReadonlySet<string>):T {
  const partial=(event as any).type!=='done'&&(event as any).type!=='error';
  const clean=(value:any,field='',depth=0,messageRoot=false):any=>{
    if(typeof value==='string'){
      for(const secret of secrets){value=value.replaceAll(secret,'[REDACTED]');if(partial&&['text','thinking','delta','content','errorMessage'].includes(field))for(let size=Math.min(secret.length-1,value.length);size>0;size--)if(value.endsWith(secret.slice(0,size))){value=value.slice(0,-size)+'[REDACTED]';break;}}
      return value;
    }
    if(Array.isArray(value))return value.map(item=>clean(item,field,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!(key==='metadata'&&messageRoot)).map(([key,item])=>[clean(key),clean(item,key,depth+1,depth===0&&['message','error','partial'].includes(key))]));
    return value;
  };return clean(event);
}
// Filter before the provider parser sees errors, metadata or streamed content. Keep the
// unmatched tail across chunks, so reflected keys split at arbitrary UTF-8 boundaries cannot leak.
function redactResponse(response:Response,secret:string):Response {
  if(!response.body||!secret)return response;
  const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();let pending='';
  return new Response(new ReadableStream<Uint8Array>({async pull(controller){try{while(true){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});let count=done?pending.length:Math.max(0,pending.length-secret.length+1);const last=pending.lastIndexOf(secret,count);if(last>=0&&last+secret.length>count)count=last;if(count<pending.length&&count>0&&/[\uD800-\uDBFF]/.test(pending[count-1]))count--;const safe=pending.slice(0,count).replaceAll(secret,'[REDACTED]');pending=pending.slice(count);if(safe)controller.enqueue(encoder.encode(safe));if(done){controller.close();return;}if(safe)return;}}catch{controller.error(Error('模型响应读取失败'));}},async cancel(reason){await reader.cancel(reason);}}),{status:response.status,statusText:response.statusText.replaceAll(secret,'[REDACTED]'),headers:{'content-type':response.headers.get('content-type')??'application/octet-stream'}});
}
