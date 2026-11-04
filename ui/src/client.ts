import {APPLICATION_PROTOCOL,type ApplicationEnvelope,type ApplicationMethod,type ApplicationRequest,type ConversationSnapshot} from '../../runtime/src/application-protocol';
import type {CredentialInfo,CredentialWriteRequest} from '../../runtime/src/model-protocol';

export interface NativePort {postMessage(message:string):void;writeCredential?(message:string):void}
export type CredentialMutation={operation:'save';target:string;expectedGeneration:number;key:string}|{operation:'remove';target:string;expectedGeneration:number};
export class ApplicationFailure extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='ApplicationFailure';}
}
export class ApplicationClient {
  readonly connectionId=crypto.randomUUID();
  private pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private disposed=false;
  private subscriptions=new Map<string,{id:string;revision:number;listener:(snapshot:ConversationSnapshot)=>void;failed?:(error:Error)=>void}>();
  constructor(private readonly port:NativePort|undefined,private readonly timeoutMs=20000) {}
  request<T=unknown>(method:ApplicationMethod,payload?:Record<string,unknown>,timeoutMs=this.timeoutMs):Promise<T> {
    if(this.disposed)return Promise.reject(new ApplicationFailure('CONNECTION_CLOSED','连接已关闭，请重新连接。'));
    if(!this.port)return Promise.reject(new ApplicationFailure('HOST_UNAVAILABLE','无法连接运行宿主，请在应用中打开此页面。'));
    const request:ApplicationRequest={protocol:APPLICATION_PROTOCOL,connectionId:this.connectionId,requestId:crypto.randomUUID(),method,payload};
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request.requestId);reject(new ApplicationFailure('RESPONSE_TIMEOUT','尚未收到确认，请重新连接查看当前状态。'));},timeoutMs);
      this.pending.set(request.requestId,{resolve:value=>resolve(value as T),reject,timer});
      try {this.port!.postMessage(JSON.stringify(request));}
      catch {clearTimeout(timer);this.pending.delete(request.requestId);reject(new ApplicationFailure('HOST_UNAVAILABLE','运行宿主连接已断开。'));}
    });
  }
  writeCredential(input:CredentialMutation):Promise<CredentialInfo> {
    if(this.disposed)return Promise.reject(new ApplicationFailure('CONNECTION_CLOSED','连接已关闭，请重新连接。'));
    if(!this.port?.writeCredential)return Promise.reject(new ApplicationFailure('CREDENTIAL_WRITER_UNAVAILABLE','当前宿主无法安全保存凭据，请更新应用后重试。'));
    const request:CredentialWriteRequest={protocol:APPLICATION_PROTOCOL,connectionId:this.connectionId,requestId:crypto.randomUUID(),operation:input.operation,target:input.target,expectedGeneration:input.expectedGeneration,...(input.operation==='save'?{key:input.key}:{})};
    const requestId=request.requestId;
    return new Promise<CredentialInfo>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new ApplicationFailure('RESPONSE_TIMEOUT','尚未收到凭据写入确认，请刷新状态后重试。'));},this.timeoutMs);
      this.pending.set(requestId,{resolve:value=>resolve(value as CredentialInfo),reject,timer});
      try{this.port!.writeCredential!(JSON.stringify(request));}
      catch{clearTimeout(timer);this.pending.delete(requestId);reject(new ApplicationFailure('CREDENTIAL_WRITER_UNAVAILABLE','凭据写入连接已断开。'));}
    });
  }
  receive(envelope:ApplicationEnvelope) {
    if(this.disposed||envelope.connectionId!==this.connectionId)return;
    if(envelope.type==='subscription-error'){if(envelope.protocol===APPLICATION_PROTOCOL)this.subscriptions.get(envelope.subscriptionId)?.failed?.(new ApplicationFailure(envelope.error.code,envelope.error.message));return;}
    if(envelope.type==='conversation') {
      if(envelope.protocol===APPLICATION_PROTOCOL)this.adopt(envelope.subscriptionId,envelope.snapshot);
      return;
    }
    const pending=this.pending.get(envelope.requestId);
    if(!pending)return;
    this.pending.delete(envelope.requestId);clearTimeout(pending.timer);
    if(envelope.protocol!==APPLICATION_PROTOCOL)pending.reject(new ApplicationFailure('PROTOCOL_MISMATCH','界面与运行宿主版本不兼容。'));
    else if(envelope.ok)pending.resolve(envelope.value);
    else pending.reject(new ApplicationFailure(envelope.error.code,envelope.error.message));
  }
  async subscribe(id:string,listener:(snapshot:ConversationSnapshot)=>void,failed?:(error:Error)=>void) {
    const subscriptionId=crypto.randomUUID();
    this.subscriptions.set(subscriptionId,{id,revision:-1,listener,failed});
    try {
      const snapshot=await this.request<ConversationSnapshot>('subscribe',{id,subscriptionId});
      this.adopt(subscriptionId,snapshot);
      return {unsubscribe:()=>this.unsubscribe(subscriptionId)};
    }catch(error){this.subscriptions.delete(subscriptionId);throw error;}
  }
  private adopt(subscriptionId:string,snapshot:ConversationSnapshot) {
    const subscription=this.subscriptions.get(subscriptionId);
    if(!subscription||snapshot.id!==subscription.id||snapshot.revision<=subscription.revision)return;
    subscription.revision=snapshot.revision;subscription.listener(snapshot);
  }
  private unsubscribe(subscriptionId:string) {
    if(!this.subscriptions.delete(subscriptionId)||!this.port||this.disposed)return;
    const request:ApplicationRequest={protocol:APPLICATION_PROTOCOL,connectionId:this.connectionId,requestId:crypto.randomUUID(),method:'unsubscribe',payload:{subscriptionId}};
    try {this.port.postMessage(JSON.stringify(request));}catch{/* A disconnected host also releases its connection subscriptions. */}
  }
  dispose() {
    for(const subscriptionId of this.subscriptions.keys())this.unsubscribe(subscriptionId);
    this.disposed=true;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new ApplicationFailure('CONNECTION_CLOSED','连接已关闭，请重新连接。'));}
    this.pending.clear();
  }
}
