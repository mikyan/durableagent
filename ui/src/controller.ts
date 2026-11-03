import type {ApplicationStatus,ConversationSnapshot,ConversationSummary,HistoryMessage,HistoryPage} from '../../runtime/src/application-protocol';
import {ApplicationClient,ApplicationFailure} from './client';
import {MODELS_EXTENSION,type ConnectionProtocol,type CredentialInfo,type ModelConfiguration} from '../../runtime/src/model-protocol';

export interface SelectionPreferences {get(key:string):string|null;set(key:string,value:string):void}
export type UiState={status:ApplicationStatus;conversations:ConversationSummary[];activeId?:string;conversation?:ConversationSnapshot;history:HistoryMessage[];next?:string;loading:boolean;pending:boolean;error?:string;page:'conversation'|'models';models?:ModelConfiguration;modelsLoading:boolean;modelsPending:boolean;modelsError?:string;modelsNotice?:string};
export type ConnectionInput={name:string;protocol:ConnectionProtocol;endpoint:string;modelId?:string};
export type ModelReference={provider:string;modelId:string};
const mergeMessages=(older:HistoryMessage[],current:HistoryMessage[])=>[...new Map([...older,...current].map(message=>[message.id,message])).values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));

export class ConversationController {
  private state:UiState={status:{phase:'opening',extensions:[]},conversations:[],history:[],loading:false,pending:false,page:'conversation',modelsLoading:false,modelsPending:false};
  private listeners=new Set<()=>void>();
  private client?:ApplicationClient;
  private subscription?:{unsubscribe:()=>void};
  private epoch=0;
  private opening=0;
  private creationId?:string;
  private checking?:Promise<void>;
  private connectionCreation?:{fingerprint:string;id:string};
  constructor(private readonly connectClient:()=>ApplicationClient,private readonly preferences?:SelectionPreferences) {}
  snapshot=()=>this.state;
  observe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<UiState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  async connect() {
    ++this.epoch;this.subscription?.unsubscribe();this.subscription=undefined;this.client?.dispose();this.checking=undefined;
    const client=this.connectClient();this.client=client;
    this.publish({status:{phase:'opening',extensions:[]},pending:false,modelsPending:false,modelsLoading:false,error:undefined});
    await this.refresh();
  }
  async refresh() {
    if(this.checking)return this.checking;
    const client=this.client,epoch=this.epoch;
    if(!client)return;
    const check=this.checkStatus(client,epoch);this.checking=check;
    try{await check;}finally{if(this.checking===check)this.checking=undefined;}
  }
  private async checkStatus(client:ApplicationClient,epoch:number) {
    try {
      const status=await client.request<ApplicationStatus>('status');
      if(epoch!==this.epoch)return;
      this.publish({status});
      if(status.phase!=='ready')return;
      const {conversations}=await client.request<{conversations:ConversationSummary[]}>('list');
      if(epoch!==this.epoch)return;
      this.publish({conversations});
      if(status.extensions.includes(MODELS_EXTENSION.id))await this.loadModels();
      const selected=this.state.activeId??this.preferences?.get('selectedConversation');
      if(selected&&conversations.some(conversation=>conversation.id===selected))await this.open(selected);
    }catch(error){if(epoch===this.epoch)this.publish({status:{phase:'failed',reason:this.reason(error),extensions:[]},error:this.reason(error)});}
  }
  async create() {
    if(this.state.pending||this.state.status.phase!=='ready'||!this.client)return;
    const epoch=this.epoch;
    this.creationId??=this.preferences?.get('pendingCreation')||crypto.randomUUID();
    this.preferences?.set('pendingCreation',this.creationId);
    this.publish({pending:true,error:undefined});
    try {
      const {conversation}=await this.client.request<{conversation:ConversationSummary;storedSeq:number}>('create',{creationId:this.creationId});
      if(epoch!==this.epoch)return;
      this.creationId=undefined;this.preferences?.set('pendingCreation','');
      this.publish({conversations:[conversation,...this.state.conversations.filter(item=>item.id!==conversation.id)]});
      await this.open(conversation.id);
    }catch(error){if(epoch===this.epoch)this.publish({error:this.reason(error)});}
    finally{if(epoch===this.epoch)this.publish({pending:false});}
  }
  async open(id:string) {
    if(!this.client||this.state.status.phase!=='ready')return;
    const epoch=this.epoch,opening=++this.opening;const client=this.client;
    this.subscription?.unsubscribe();this.subscription=undefined;
    this.preferences?.set('selectedConversation',id);
    this.publish({page:'conversation',activeId:id,conversation:undefined,history:[],next:undefined,loading:true,error:undefined});
    const current=()=>epoch===this.epoch&&opening===this.opening;
    try {
      const [conversation,page]=await Promise.all([client.request<ConversationSnapshot>('open',{id}),client.request<HistoryPage>('history',{id,limit:30})]);
      if(!current())return;
      this.publish({conversation,history:mergeMessages(page.items,conversation.entries),next:page.next});
      const subscription=await client.subscribe(id,snapshot=>{
        if(!current())return;
        this.publish({conversation:snapshot,history:mergeMessages(this.state.history,snapshot.entries),conversations:this.state.conversations.map(item=>item.id===id?snapshot.conversation:item)});
      });
      if(current())this.subscription=subscription;else subscription.unsubscribe();
    }catch(error){if(current())this.publish({error:this.reason(error)});}
    finally{if(current())this.publish({loading:false});}
  }
  home() {
    this.opening++;this.subscription?.unsubscribe();this.subscription=undefined;
    this.preferences?.set('selectedConversation','');
    this.publish({page:'conversation',activeId:undefined,conversation:undefined,history:[],next:undefined,loading:false,error:undefined});
  }
  async send(text:string) {
    if(!text.trim()||!this.client||!this.state.activeId||this.state.status.phase!=='ready'||this.state.pending)return false;
    const epoch=this.epoch,id=this.state.activeId;this.publish({pending:true,error:undefined});
    try {await this.client.request('send',{id,text,actionId:crypto.randomUUID()});return epoch===this.epoch;}
    catch(error){if(epoch===this.epoch)this.publish({error:this.reason(error)});return false;}
    finally{if(epoch===this.epoch)this.publish({pending:false});}
  }
  async loadOlder() {
    const client=this.client,id=this.state.activeId,cursor=this.state.next;
    if(!client||!id||!cursor||this.state.loading)return;
    const epoch=this.epoch,opening=this.opening;
    const current=()=>epoch===this.epoch&&opening===this.opening;
    this.publish({loading:true,error:undefined});
    try {
      const page=await client.request<HistoryPage>('history',{id,cursor,limit:30});
      if(current())this.publish({history:mergeMessages(page.items,this.state.history),next:page.next});
    }catch(error){if(current())this.publish({error:this.reason(error)});}
    finally{if(current())this.publish({loading:false});}
  }
  async stop() {
    const client=this.client,id=this.state.activeId;
    if(!client||!id||this.state.pending||this.state.status.phase!=='ready')return;
    const epoch=this.epoch;this.publish({pending:true,error:undefined});
    try{await client.request('stop',{id,actionId:crypto.randomUUID()});}
    catch(error){if(epoch===this.epoch)this.publish({error:this.reason(error)});}
    finally{if(epoch===this.epoch)this.publish({pending:false});}
  }
  async openModels(){this.publish({page:'models',modelsNotice:undefined});await this.loadModels();}
  leaveModels(){this.publish({page:'conversation',modelsError:undefined,modelsNotice:undefined});}
  async loadModels() {
    const client=this.client,epoch=this.epoch;
    if(!client||this.state.modelsLoading||this.state.modelsPending||this.state.status.phase!=='ready'||!this.state.status.extensions.includes(MODELS_EXTENSION.id))return;
    this.publish({modelsLoading:true,modelsError:undefined});
    try{const models=await client.request<ModelConfiguration>('models.get');if(epoch===this.epoch)this.publish({models});}
    catch(error){if(epoch===this.epoch)this.publish({modelsError:this.reason(error)});}
    finally{if(epoch===this.epoch)this.publish({modelsLoading:false});}
  }
  async createConnection(input:ConnectionInput) {
    const fingerprint=JSON.stringify([input.name,input.protocol,input.endpoint,input.modelId??'']);
    if(this.connectionCreation?.fingerprint!==fingerprint)this.connectionCreation={fingerprint,id:crypto.randomUUID()};
    const ok=await this.changeModels('models.create',{creationId:this.connectionCreation.id,name:input.name,protocol:input.protocol,endpoint:input.endpoint,...(input.protocol==='openai-compatible'?{modelId:input.modelId}:{})},'连接已添加；请单独配置 API Key 和默认模型。');
    if(ok)this.connectionCreation=undefined;
    return ok;
  }
  setDefaultModel(selection:ModelReference){return this.changeModels('models.setDefault',{selection:{provider:selection.provider,modelId:selection.modelId}},'默认模型已更新，仅影响以后新建的会话。');}
  setConnectionEnabled(id:string,enabled:boolean){return this.changeModels('models.setEnabled',{id,enabled},enabled?'连接已启用。':'连接已停用；旧定义与会话选择仍保留。');}
  private async changeModels(method:'models.create'|'models.setDefault'|'models.setEnabled',payload:Record<string,unknown>,notice:string) {
    const client=this.client,epoch=this.epoch,models=this.state.models;
    if(!client||!models||this.state.modelsPending||this.state.modelsLoading||this.state.status.phase!=='ready')return false;
    this.publish({modelsPending:true,modelsError:undefined,modelsNotice:undefined});
    try{const next=await client.request<ModelConfiguration>(method,{...payload,expectedVersion:models.version});if(epoch!==this.epoch)return false;this.publish({models:next,modelsNotice:notice});return true;}
    catch(error){if(epoch===this.epoch)this.publish({modelsError:this.reason(error)});return false;}
    finally{if(epoch===this.epoch)this.publish({modelsPending:false});}
  }
  async writeModelCredential(id:string,operation:'save'|'remove',key?:string) {
    const client=this.client,epoch=this.epoch,connection=this.state.models?.connections.find(item=>item.id===id);
    if(!client||!connection||this.state.modelsPending||this.state.modelsLoading||this.state.status.phase!=='ready'||operation==='save'&&!key)return false;
    this.publish({modelsPending:true,modelsError:undefined,modelsNotice:undefined});
    try{
      const credential:CredentialInfo=await client.writeCredential(operation==='save'?{operation,target:id,expectedGeneration:connection.credential.generation,key:key!}:{operation,target:id,expectedGeneration:connection.credential.generation});
      if(epoch!==this.epoch)return false;
      const models=this.state.models!;
      this.publish({models:{...models,connections:models.connections.map(item=>item.id===id?{...item,credential}:item)},modelsNotice:operation==='save'?'API Key 已保存；已配置不代表云端验证成功。':'API Key 已移除；已发出的请求不会因此撤回。'});return true;
    }catch(error){
      if(epoch===this.epoch){
        const code=error instanceof ApplicationFailure?error.code:'';
        const message=code==='CREDENTIAL_WRITER_UNAVAILABLE'?'当前宿主无法安全保存凭据，请重新连接或更新应用。':code.includes('CONFLICT')?'凭据状态已变更，请刷新后重新输入。':'凭据写入未确认，请刷新状态后重试。';
        this.publish({modelsError:message});
      }
      return false;
    }finally{if(epoch===this.epoch)this.publish({modelsPending:false});}
  }
  async selectConversationModel(selection:ModelReference) {
    const client=this.client,epoch=this.epoch,id=this.state.activeId;
    if(!client||!id||this.state.modelsPending||this.state.modelsLoading||this.state.status.phase!=='ready')return false;
    this.publish({modelsPending:true,modelsError:undefined,modelsNotice:undefined});
    try{
      const conversation=await client.request<ConversationSnapshot>('models.select',{id,selection:{provider:selection.provider,modelId:selection.modelId}});
      if(epoch!==this.epoch)return false;
      const same=id===this.state.activeId;
      const newer=conversation.revision>=(this.state.conversation?.revision??-1);
      this.publish({...(same&&newer?{conversation,history:mergeMessages(this.state.history,conversation.entries)}:{}),conversations:this.state.conversations.map(item=>item.id===id?conversation.conversation:item),modelsNotice:'当前会话模型已更新；已发出的请求继续使用原选择。'});return true;
    }catch(error){if(epoch===this.epoch)this.publish({modelsError:this.reason(error)});return false;}
    finally{if(epoch===this.epoch)this.publish({modelsPending:false});}
  }
  private reason(error:unknown){return error instanceof ApplicationFailure||error instanceof Error?error.message:'操作未完成，请重新连接查看当前状态。';}
  disconnect(){this.epoch++;this.opening++;this.subscription?.unsubscribe();this.client?.dispose();this.subscription=undefined;}
  dispose(){this.disconnect();this.listeners.clear();}
}
