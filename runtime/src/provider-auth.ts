import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {AuthEvent,AuthPrompt as SdkPrompt,Credential,CredentialStore,Models} from '@earendil-works/pi-ai';
import type {CredentialInfo,ProviderAuthRequest,ProviderAuthSession} from './model-protocol.js';

export interface PrivateCredentialAccess {
  metadata(id:string):Promise<CredentialInfo>;
  resolve(id:string):Promise<{key:string;generation:number}>;
  acquire?(id:string):Promise<{lease:string}>;
  release?(id:string,lease:string):Promise<void>;
  save?(id:string,credential:string,generation:number,lease:string):Promise<CredentialInfo>;
  deviceId?():Promise<string>;
  openUrl?(url:string):Promise<void>;
}
export class ProviderAuthenticationError extends Error {
  constructor(readonly code:string,message:string){super(message);}
}
const fail=(code:string,message:string):never=>{throw new ProviderAuthenticationError(code,message);};
export function authenticationFailure(error:unknown):{code:string;message:string}{
  let current:any=error;for(let depth=0;current&&depth<6;depth++,current=current.cause)if(current instanceof ProviderAuthenticationError)return {code:current.code,message:current.message};
  const code=typeof(error as any)?.code==='string'&&/^[a-zA-Z_]{1,64}$/.test((error as any).code)?String((error as any).code).toUpperCase():'FAILED';
  return {code:'PROVIDER_AUTH_'+code,message:code==='OAUTH'?'提供方登录已失效或刷新失败，请重新登录；原凭据和会话已保留。':`提供方认证或凭据保存失败（${code}），请检查登录、网络与提供方配置。`};
}
export function decodeCredential(value:string):Credential {
  if(value.startsWith('{')){try{const parsed=JSON.parse(value);if(parsed.format==='durableagent-sdk-credential'&&parsed.version===1&&['api_key','oauth'].includes(parsed.credential?.type))return parsed.credential;}catch{}}
  return {type:'api_key',key:value};
}
export function credentialSecrets(value:unknown):Set<string> {
  const values=new Set<string>();
  // Provider env also contains booleans, regions and profile names; treating every
  // string as a token would corrupt streamed JSON and ordinary model content.
  const sensitive=/(?:key|token|secret|password|credential|authorization|access|refresh|accountid)/i;
  const visit=(item:unknown,key='')=>{if(typeof item==='string'&&item&&sensitive.test(key))values.add(item);else if(Array.isArray(item))item.forEach(value=>visit(value,key));else if(item&&typeof item==='object')Object.entries(item).forEach(([key,value])=>visit(value,key));};visit(value);return values;
}
// This context follows one explicit SDK login, including its final queued store
// mutation. Request-time refresh does not enter this context.
const loginMutation=new AsyncLocalStorage<{target:string}>();
function checkLoginIdentity(current:Credential|undefined,next:Credential,generation:number){
  if(next.type!=='oauth')return;
  if(!current&&generation>0)fail('CONNECTION_ACCOUNT_UNKNOWN','此连接的原账号身份已不可确认，请添加新账号连接；原会话已保留。');
  if(current?.type==='oauth'&&(typeof current.accountId!=='string'||!current.accountId||typeof next.accountId!=='string'||!next.accountId))fail('CONNECTION_ACCOUNT_UNKNOWN','提供方没有返回可核对的账号身份，请添加新账号连接；原凭据和会话已保留。');
}
/** The SDK serializes refresh/login with a native per-connection OS lease. No auth.json is used. */
export function encryptedCredentialStore(access:PrivateCredentialAccess,guard?:(id:string,current:Credential,next:Credential)=>Promise<void>):CredentialStore {
  const read=async(id:string)=>{const info=await access.metadata(id);return info.configured?decodeCredential((await access.resolve(id)).key):undefined;};
  const tails=new Map<string,Promise<unknown>>();
  const mutate=async(id:string,modify:Parameters<CredentialStore['modify']>[1],options:Parameters<CredentialStore['modify']>[2],explicitLogin:boolean)=>{
    if(!access.acquire||!access.release||!access.save)fail('AUTH_STORAGE_UNAVAILABLE','当前应用不支持保存登录凭据');
    options?.signal?.throwIfAborted();
    const {lease}=await access.acquire!(id);
    try{
      options?.signal?.throwIfAborted();
      const info=await access.metadata(id),current=info.configured?decodeCredential((await access.resolve(id)).key):undefined;
      const next=await modify(current);options?.signal?.throwIfAborted();
      if(next===undefined)return current;
      // Recheck under the native lease: another login/removal may have completed
      // while this interactive login was waiting for the user or the network.
      if(explicitLogin)checkLoginIdentity(current,next,info.generation);
      if(current&&current.type!==next.type)fail('CONNECTION_TARGET_CHANGED','认证方式已改变，请新建连接以保留原请求身份');
      // Provider-scoped destination/environment changes require another immutable connection.
      if(current?.type==='api_key'&&next.type==='api_key'&&JSON.stringify(current.env??{})!==JSON.stringify(next.env??{}))fail('CONNECTION_TARGET_CHANGED','连接环境已改变，请新建连接以保留原请求身份');
      if(current?.type==='oauth'&&next.type==='oauth')for(const field of ['accountId','enterpriseUrl'])if(current[field]!==undefined&&next[field]!==current[field])fail('CONNECTION_ACCOUNT_CHANGED','登录账号或服务已改变，请新建连接');
      if(current)await guard?.(id,current,next);
      await access.save!(id,JSON.stringify({format:'durableagent-sdk-credential',version:1,credential:next}),info.generation,lease);
      return next;
    }finally{await access.release!(id,lease);}
  };
  return {read,list:async()=>[],delete:async()=>fail('NATIVE_WRITE_REQUIRED','请通过原生凭据入口移除登录'),modify:(id,modify,options)=>{
    const explicitLogin=loginMutation.getStore()?.target===id;
    const pending=(tails.get(id)??Promise.resolve()).then(()=>mutate(id,modify,options,explicitLogin),()=>mutate(id,modify,options,explicitLogin));
    tails.set(id,pending);void pending.finally(()=>{if(tails.get(id)===pending)tails.delete(id);}).catch(()=>{});return pending;
  }};
}
type ActiveSession={view:ProviderAuthSession;abort:AbortController;secrets:Set<string>;answer?:{id:string;secret:boolean;resolve:(answer:string)=>void;reject:(error:Error)=>void};owner:string;timeout:ReturnType<typeof setTimeout>};
/** Ephemeral UI-only login state. Answers and tokens never enter Application.request or documents. */
export class ProviderAuthentication {
  private sessions=new Map<string,ActiveSession>();
  constructor(private readonly models:Models,private readonly access:PrivateCredentialAccess,private readonly providerId:(id:string)=>string|undefined){}
  async request(request:ProviderAuthRequest):Promise<ProviderAuthSession> {
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.connectionId)||!request.target||!this.providerId(request.target))fail('AUTH_TARGET_UNAVAILABLE','模型连接尚未就绪');
    if(request.operation==='start'){
      if(request.authType!=='api_key'&&request.authType!=='oauth')fail('AUTH_METHOD_INVALID','请选择支持的登录方式');
      for(const item of this.sessions.values())if(item.view.target===request.target&&['running','waiting'].includes(item.view.state))fail('AUTH_ALREADY_RUNNING','此连接已有登录正在进行');
      if(this.sessions.size>=16){for(const [id,item]of this.sessions)if(!['running','waiting'].includes(item.view.state))this.sessions.delete(id);if(this.sessions.size>=16)fail('AUTH_BUSY','登录操作过多，请先取消已有登录');}
      const id=randomUUID(),abort=new AbortController();
      const item:ActiveSession={owner:request.connectionId,abort,secrets:new Set(),view:{id,target:request.target,providerId:this.providerId(request.target)!,authType:request.authType!,state:'running',events:[]},timeout:setTimeout(()=>this.cancel(id),10*60_000)};
      this.sessions.set(id,item);
      void this.login(item);return this.public(item);
    }
    const item=this.sessions.get(request.sessionId??'');
    if(!item||item.owner!==request.connectionId||item.view.target!==request.target)fail('AUTH_SESSION_UNKNOWN','登录会话已结束，请重新开始');
    if(request.operation==='cancel')this.cancel(item!.view.id);
    else if(request.operation==='answer'){
      if(!item!.answer||item!.answer.id!==request.promptId||typeof request.answer!=='string'||request.answer.length>65536)fail('AUTH_PROMPT_CHANGED','登录步骤已改变，请刷新后重试');
      const answer=item!.answer!;item!.answer=undefined;item!.view.prompt=undefined;item!.view.state='running';
      if(answer.secret&&request.answer)item!.secrets.add(request.answer!);answer.resolve(request.answer!);
    }else if(request.operation==='openUrl'){
      const event=item!.view.events[request.eventIndex??-1],url=event?.type==='auth_url'?event.url:event?.type==='device_code'?event.verificationUri:undefined;
      if(!url||!this.access.openUrl)fail('AUTH_URL_UNAVAILABLE','当前登录步骤没有可打开的授权页面');
      const parsed=new URL(url!);if(parsed.protocol!=='https:'||parsed.username||parsed.password)fail('AUTH_URL_UNAVAILABLE','授权页面地址无效');
      await this.access.openUrl!(url!);
    }else if(request.operation!=='status')fail('AUTH_OPERATION_INVALID','不支持的登录操作');
    return this.public(item!);
  }
  private async login(item:ActiveSession){
    try{
      const deviceId=await this.access.deviceId?.();
      await loginMutation.run({target:item.view.target},()=>this.models.login(item.view.target,item.view.authType,{signal:item.abort.signal,notify:event=>{
        if(item.abort.signal.aborted)return;
        if(item.view.events.length>=256)fail('AUTH_EVENT_LIMIT','登录步骤过多，请取消后重新开始');
        item.view.events.push(this.clean(item,event));
      },prompt:prompt=>this.prompt(item,prompt)},{agentName:'DurableAgent',...(deviceId?{getDeviceId:()=>deviceId}:{})}));
      item.view.state='completed';
    }catch(error){
      item.view.state=item.abort.signal.aborted?'cancelled':'failed';
      if(item.view.state==='failed')item.view.error=authenticationFailure(error);
    }finally{item.view.prompt=undefined;item.answer=undefined;clearTimeout(item.timeout);item.secrets.clear();}
  }
  private prompt(item:ActiveSession,prompt:SdkPrompt):Promise<string>{
    const id=randomUUID();const {signal,...publicPrompt}=prompt;
    item.view.prompt={...this.clean(item,publicPrompt),id};item.view.state='waiting';
    return new Promise((resolve,reject)=>{
      const abort=()=>{if(item.answer?.id===id){item.answer=undefined;item.view.prompt=undefined;reject(new Error('Authentication cancelled'));}};
      signal?.addEventListener('abort',abort,{once:true});item.abort.signal.addEventListener('abort',abort,{once:true});
      const finish=(callback:()=>void)=>{signal?.removeEventListener('abort',abort);item.abort.signal.removeEventListener('abort',abort);callback();};
      item.answer={id,secret:prompt.type==='secret'||prompt.type==='manual_code',resolve:value=>finish(()=>resolve(value)),reject:error=>finish(()=>reject(error))};
      if(signal?.aborted||item.abort.signal.aborted)abort();
    });
  }
  private clean<T>(item:ActiveSession,value:T):T {
    const visit=(value:any,key=''):any=>{
      if(typeof value==='string'){if(['id','type','target','providerId','authType','state'].includes(key))return value;for(const secret of item.secrets)value=value.replaceAll(secret,'[REDACTED]');return value;}
      if(Array.isArray(value))return value.map(item=>visit(item,key));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,visit(value,key)]));return value;
    };return visit(value);
  }
  private public(item:ActiveSession):ProviderAuthSession{return this.clean(item,item.view);}
  private cancel(id:string){const item=this.sessions.get(id);if(!item||!['running','waiting'].includes(item.view.state))return;item.abort.abort();item.answer?.reject(new Error('Authentication cancelled'));item.answer=undefined;item.view.prompt=undefined;item.view.state='cancelled';clearTimeout(item.timeout);}
  disconnect(owner:string){for(const [id,item]of this.sessions)if(item.owner===owner)this.cancel(id);}
  close(){for(const id of this.sessions.keys())this.cancel(id);this.sessions.clear();}
}
