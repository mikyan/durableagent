import {builtinProviders} from '@earendil-works/pi-ai/providers/all';
import {createModels,type Provider,type Models} from '@earendil-works/pi-ai/models';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import type {Api,Model,DeferredHandle,TranscriptContext,AuthContext,AuthResult,Credential} from '@earendil-works/pi-ai';
import {access as fileAccess} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {ConnectionDefinition,ProviderView,PublicModel} from './model-protocol.js';
import {authenticationFailure,credentialSecrets,decodeCredential,encryptedCredentialStore,ProviderAuthentication,ProviderAuthenticationError,type PrivateCredentialAccess} from './provider-auth.js';
import {sanitizeEvent,redactResponse} from './model-secrets.js';
import {InputError,validateContextBudget,validateProviderInput,type ProviderInputEvidence} from './input.js';
import type {ModelRetryAfter} from './model-retry-after.js';

const marker='application-request-auth';
const publicModel=(model:Model<Api>):PublicModel=>({id:model.id,name:model.name,contextWindow:model.contextWindow,maxTokens:model.maxTokens});
const fail=(code:string,message:string):never=>{throw new ProviderAuthenticationError(code,message);};
type Hooks={enabled:(id:string)=>void;retryAfter:()=>ModelRetryAfter|undefined;fetch?:typeof fetch;onRequest?:(receipt:{connectionId:string;generation:number;endpoint:string;input:ProviderInputEvidence;requestTools:{names:string[];choice:string}})=>void};
/** Keep SDK protocols, model metadata and auth implementations together; never map them to one HTTP API. */
export class SdkProviders {
  readonly authModels:ReturnType<typeof createModels>;
  readonly authentication:ProviderAuthentication;
  private providers=new Map<string,Provider>();
  private definitions=new Map<string,ConnectionDefinition>();
  private catalogs=new Map<string,Model<Api>[]>();
  constructor(private readonly access:PrivateCredentialAccess,private readonly hooks:Hooks){
    const authContext:AuthContext={env:async()=>undefined,fileExists:async path=>{try{await fileAccess(path.startsWith('~/')?join(homedir(),path.slice(2)):path);return true;}catch{return false;}}};
    const guard=async(id:string,current:Credential,next:Credential)=>{
      const provider=this.providers.get(id);if(!provider)fail('PROVIDER_UNAVAILABLE','SDK 未提供此连接');
      const endpoint=async(credential:Credential)=>credential.type==='oauth'?(await provider!.auth.oauth?.toAuth(credential))?.baseUrl:(await provider!.auth.apiKey?.resolve({credential,ctx:authContext,signal:AbortSignal.timeout(15000)}))?.auth.baseUrl;
      const before=await endpoint(current),after=await endpoint(next);
      if(before?.replace(/\/$/,'')!==after?.replace(/\/$/,''))fail('CONNECTION_TARGET_CHANGED','认证返回的服务地址已改变，请新建连接');
    };
    this.authModels=createModels({credentials:encryptedCredentialStore(access,guard),authContext});
    this.authentication=new ProviderAuthentication(this.authModels,access,id=>this.definitions.get(id)?.providerId);
  }
  catalog():ProviderView[]{return builtinProviders().map(provider=>({id:provider.id,name:provider.name,models:provider.getModels().map(publicModel),authMethods:[...(provider.auth.apiKey?.login?[{type:'api_key' as const,label:provider.auth.apiKey.name}]:[]),...(provider.auth.oauth?[{type:'oauth' as const,label:provider.auth.oauth.loginLabel??provider.auth.oauth.name}]:[])],...(provider.baseUrl?{defaultEndpoint:provider.baseUrl}:{})}));}
  definitionModels(providerId:string):PublicModel[]{const provider=builtinProviders().find(item=>item.id===providerId);if(!provider)fail('PROVIDER_UNAVAILABLE','SDK 未提供此模型服务');return provider!.getModels().map(publicModel);}
  async refresh(id:string){this.hooks.enabled(id);const provider=this.providers.get(id);if(!provider)fail('PROVIDER_UNAVAILABLE','仅 SDK 连接支持刷新目录');if(provider!.refreshModels&&this.definitions.get(id)?.endpoint)fail('MODEL_CATALOG_UNAVAILABLE','此自定义服务地址没有 SDK 目录刷新实现，已保留上次目录');const result=await this.authModels.refresh({providers:[id],allowNetwork:true,force:true,signal:AbortSignal.timeout(45000)});if(result.aborted||result.errors.size)fail('MODEL_CATALOG_UNAVAILABLE','提供方模型目录刷新失败，已保留上次目录');return structuredClone(provider!.getModels());}
  provider(definition:ConnectionDefinition,restored?:Model<Api>[]):Provider{
    let original=this.providers.get(definition.id);
    if(!original){original=builtinProviders().find(item=>item.id===definition.providerId);if(!original)fail('PROVIDER_UNAVAILABLE','SDK 未提供此模型服务');this.providers.set(definition.id,original!);}
    const implementation=original!;this.definitions.set(definition.id,definition);
    // Publish refreshed catalogs only after their application document commits.
    this.catalogs.set(definition.id,structuredClone([...(restored??implementation.getModels())]));
    const models=()=>this.catalogs.get(definition.id)!.map(model=>({...model,provider:definition.id,...(definition.endpoint?{baseUrl:definition.endpoint}:{})}));
    const connection:Provider={...implementation,id:definition.id,name:definition.name,getModels:models,...(definition.endpoint?{baseUrl:definition.endpoint}:{})};
    this.authModels.setProvider(connection);
    const invoke=(model:Model<Api>,transcript:TranscriptContext|undefined,options:any,method:'stream'|'streamSimple'|'fetchDeferred',handle?:DeferredHandle)=>{
      const output=new AssistantMessageEventStream();
      void(async()=>{
        let secrets=new Set<string>();
        try{
          this.hooks.enabled(definition.id);
          if(options?.apiKey!==marker||Object.keys(options?.env??{}).length||Object.keys(options?.headers??{}).length)fail('AUTH_OVERRIDE_REJECTED','模型请求不能覆盖应用凭据');
          if(transcript){validateContextBudget(transcript);if(!model.input.includes('image')&&transcript.messages.some(message=>Array.isArray(message.content)&&message.content.some((part:any)=>part.type==='image')))fail('IMAGE_UNSUPPORTED','当前模型未声明支持图片，请更换模型');}
          await this.hooks.retryAfter()?.wait(definition.id,options?.signal);
          let originalHandle=handle;
          const before=await this.access.metadata(definition.id);
          if(!before.configured)fail('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');
          if(handle){const stamp=(handle.data as any)?.appCredential;if(handle.provider!==definition.id||stamp?.connectionId!==definition.id||stamp?.generation!==before.generation)fail('DEFERRED_ACCOUNT_UNKNOWN','旧响应的凭据兼容性无法确认，请处理原响应');originalHandle={...handle,data:(handle.data as any).providerData};}
          // Auth resolution may refresh OAuth. Admit only a stable generation;
          // if it changed, resolve again from the committed replacement.
          let resolved:AuthResult|undefined;
          let credential:Awaited<ReturnType<PrivateCredentialAccess['resolve']>>|undefined;
          let current=before;
          for(let attempt=0;attempt<3;attempt++){
            const starting=await this.access.metadata(definition.id);
            resolved=await this.authModels.getAuth(model,{signal:options?.signal});
            if(!resolved)fail('CREDENTIAL_UNAVAILABLE','提供方认证配置不完整，请检查登录和连接设置');
            credential=await this.access.resolve(definition.id);current=await this.access.metadata(definition.id);
            if(!current.configured)fail('CREDENTIAL_UNAVAILABLE','模型凭据不可用，请检查设置');
            if(handle&&current.generation!==before.generation)fail('DEFERRED_ACCOUNT_UNKNOWN','旧响应的凭据已刷新，请处理原响应');
            if(current.generation===starting.generation&&current.generation===credential.generation)break;
            if(attempt===2)fail('CREDENTIAL_CHANGED','凭据正在变更，请重试');
          }
          const storedCredential=decodeCredential(credential!.key);
          if(implementation.filterModels&&!implementation.filterModels(this.catalogs.get(definition.id)!,storedCredential).some(item=>item.id===model.id))fail('MODEL_UNAVAILABLE','此账号当前未开放所选模型，请选择其他模型');
          secrets=new Set([...credentialSecrets(storedCredential),...credentialSecrets(resolved!)]);
          const endpoint=resolved!.auth.baseUrl||definition.endpoint||model.baseUrl;
          if(endpoint){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)fail('DESTINATION_REJECTED','模型服务地址必须是无内嵌凭据的 HTTPS 地址');if(definition.endpoint&&new URL(definition.endpoint).origin!==url.origin)fail('DESTINATION_REJECTED','鉴权返回的服务地址与固定连接不一致，请新建连接');}
          // SDK adapters use their canonical provider id for protocol-specific headers and compatibility.
          // Public receipts are mapped back to the immutable application connection below.
          const requestModel={...model,provider:implementation.id,...(endpoint?{baseUrl:endpoint}:{})};
          if(originalHandle)originalHandle={...originalHandle,provider:implementation.id};
          this.hooks.enabled(definition.id);
          const checkedFetch:typeof fetch=async(input,init)=>{
            const request=new Request(input,init),url=new URL(request.url);
            if(url.protocol!=='https:'||url.username||url.password)fail('DESTINATION_REJECTED','模型请求地址无效');
            if(endpoint&&url.origin!==new URL(endpoint).origin)fail('DESTINATION_REJECTED','模型请求目的地与连接不一致');
            await this.hooks.retryAfter()?.wait(definition.id,request.signal);
            const info=await this.access.metadata(definition.id);if(info.generation!==current.generation||!info.configured)fail('CREDENTIAL_CHANGED','凭据已变更，请重试');
            this.hooks.enabled(definition.id);
            let response:Response;try{response=await(this.hooks.fetch??fetch)(new Request(request,{redirect:'error'}));}catch{fail('MODEL_NETWORK_ERROR','模型网络请求失败');}
            if(response!.status===429||response!.status===503)await this.hooks.retryAfter()?.record(definition.id,response!.headers.get('retry-after'));
            for(const secret of secrets)response=redactResponse(response!,secret);return response!;
          };
          // Google and Bedrock own their SDK transport and reject/ignore a custom fetch.
          const nativeTransport=['google-generative-ai','google-vertex','bedrock-converse-stream'].includes(model.api);
          const selected={...options,...resolved!.auth,env:resolved!.env,apiKey:resolved!.auth.apiKey,headers:resolved!.auth.headers,maxRetries:0,timeoutMs:45000,transport:'sse',...(nativeTransport?{fetch:undefined}:{fetch:checkedFetch}),
            onProviderStreamEvent:options?.onProviderStreamEvent?((event:unknown)=>options.onProviderStreamEvent(sanitizeEvent(event,secrets))):undefined,
            onPayload:async(payload:unknown)=>{validateContextBudget(payload);const evidence=await validateProviderInput(new Request('https://payload.invalid/',{method:'POST',body:JSON.stringify(payload)}),model);await this.hooks.retryAfter()?.wait(definition.id,options?.signal);const latest=await this.access.metadata(definition.id);if(!latest.configured||latest.generation!==current.generation)fail('CREDENTIAL_CHANGED','凭据已变更，请重试');this.hooks.enabled(definition.id);this.hooks.onRequest?.({connectionId:definition.id,generation:current.generation,endpoint:endpoint??'',input:evidence,requestTools:{names:[],choice:'sdk'}});return payload;}};
          const stream=method==='fetchDeferred'?implementation.fetchDeferred?.(requestModel,originalHandle!,selected):method==='streamSimple'?implementation.streamSimple(requestModel,transcript!,selected):implementation.stream(requestModel,transcript!,selected);
          if(!stream)fail('DEFERRED_UNRECOVERABLE','提供方不支持恢复此响应');
          for await(const event of stream!){
            for(const key of ['message','partial','error'])if((event as any)[key]?.provider)(event as any)[key].provider=definition.id;
            if(event.type==='done'&&event.message.deferred)event.message.deferred={...event.message.deferred,provider:definition.id,data:{appCredential:{version:1,connectionId:definition.id,generation:current.generation},providerData:event.message.deferred.data??null}};
            output.push(sanitizeEvent(event,secrets));
          }
        }catch(error){const message=error instanceof ProviderAuthenticationError||error instanceof InputError?error.message:authenticationFailure(error).message;output.push({type:'error',reason:'error',error:{role:'assistant',content:[],api:model.api,provider:definition.id,model:model.id,stopReason:'error',errorMessage:message,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});}
      })();return output;
    };
    return {...connection,auth:{apiKey:{name:'应用加密凭据',resolve:async()=>({auth:{apiKey:marker}})}},stream:(m,c,o)=>invoke(m,c,o,'stream'),streamSimple:(m,c,o)=>invoke(m,c,o,'streamSimple'),...(implementation.fetchDeferred?{fetchDeferred:(m:Model<Api>,h:DeferredHandle,o:any)=>invoke(m,undefined,o,'fetchDeferred',h)}:{})};
  }
  close(){this.authentication.close();}
}
