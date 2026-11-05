import type {ApplicationStatus,ConversationSnapshot,ConversationSummary,HistoryMessage,HistoryPage} from '../../runtime/src/application-protocol';
import {ApplicationClient,ApplicationFailure} from './client';
import {MODELS_EXTENSION,type ConnectionProtocol,type CredentialInfo,type ModelConfiguration} from '../../runtime/src/model-protocol';
import type {InputConversation} from '../../runtime/src/input-protocol';
import {DraftCoordinator,type DraftView} from './drafts';
import {SubmissionCoordinator} from './submissions';
import {PROJECTS_EXTENSION,type ProjectCatalog,type ProjectMethod} from '../../runtime/src/project-protocol';
import {ExecutionCoordinator,type ExecutionView} from './execution';
import {DataSaverCoordinator,type DataSaverView} from './data-saver';
import {DATA_SAVER_EXTENSION} from '../../runtime/src/data-saver-protocol';

export interface SelectionPreferences {get(key:string):string|null;set(key:string,value:string):void}
export type UiPage='conversation'|'conversations'|'models'|'projects'|'extensions'|'tools'|'settings';
export type UiState={dataSaver?:DataSaverView;execution?:ExecutionView;status:ApplicationStatus;conversations:ConversationSummary[];inputConversations:InputConversation[];inputReady:boolean;inputError?:string;draft?:DraftView;submissions?:ReturnType<SubmissionCoordinator['view']>;activeId?:string;conversation?:ConversationSnapshot;history:HistoryMessage[];next?:string;loading:boolean;pending:boolean;error?:string;page:UiPage;models?:ModelConfiguration;modelsLoading:boolean;modelsPending:boolean;modelsError?:string;modelsNotice?:string;projects?:ProjectCatalog;projectsLoading?:boolean;projectsPending?:boolean;projectsUnconfirmed?:boolean;projectsError?:string;projectsNotice?:string};
export type ConnectionInput={name:string;protocol:ConnectionProtocol;endpoint:string;modelId?:string};
export type ModelReference={provider:string;modelId:string};
const mergeMessages=(older:HistoryMessage[],current:HistoryMessage[])=>[...new Map([...older,...current].map(message=>[message.id,message])).values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));

export class ConversationController {
  private state:UiState={status:{phase:'opening',extensions:[]},conversations:[],inputConversations:[],inputReady:false,history:[],loading:false,pending:false,page:'conversation',modelsLoading:false,modelsPending:false};
  private listeners=new Set<()=>void>();
  private client?:ApplicationClient;
  private subscription?:{unsubscribe:()=>void};
  private epoch=0;
  private opening=0;
  private navigation=0;
  private targetConversation?:string;
  private creationId?:string;
  private checking?:Promise<void>;
  private connectionCreation?:{fingerprint:string;id:string};
  private projectRead=0;
  private projectOperation?:{method:Exclude<ProjectMethod,'projects.get'>;payload:Record<string,unknown>};
  private readonly drafts=new DraftCoordinator(()=>this.client,()=>this.publish({draft:this.state.activeId?this.drafts.view(this.state.activeId):undefined}));
  private readonly submissions=new SubmissionCoordinator(()=>this.client,()=>this.state.status.phase==='ready',()=>this.publish({submissions:this.state.activeId?this.submissions.view(this.state.activeId):undefined}),(ack,editEpoch)=>this.drafts.confirmAdmission(ack,editEpoch));
  readonly dataSaver=new DataSaverCoordinator(()=>this.client,()=>this.publish({dataSaver:this.dataSaver.view()}));
  readonly execution=new ExecutionCoordinator(()=>this.client,()=>this.publish({execution:this.execution.view()}));
  extensionClient?:import('./extensions/timeline').TimelineClient;
  showPage(page:UiPage){this.publish({page});}
  openExtensions(){this.publish({page:'extensions'});}
  leaveExtensions(){this.publish({page:'conversation'});}
  private sendPoll?:ReturnType<typeof setTimeout>;
  constructor(private readonly connectClient:()=>ApplicationClient,private readonly preferences?:SelectionPreferences) {}
  snapshot=()=>this.state;
  observe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<UiState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  connect(){return this.connectHost(false);}
  reconnect(){return this.connectHost(true);}
  private async connectHost(retryNative:boolean) {
    this.dataSaver.reset();this.execution.reset();++this.epoch;clearTimeout(this.sendPoll);this.submissions.disconnect();this.subscription?.unsubscribe();this.subscription=undefined;this.client?.dispose();this.checking=undefined;
    const client=this.connectClient();this.client=client;this.extensionClient={request:client.request.bind(client),subscribe:client.subscribe.bind(client)};
    this.publish({status:{phase:'opening',extensions:[]},pending:false,modelsPending:false,modelsLoading:false,projectsPending:false,projectsLoading:false,projectsUnconfirmed:!!this.projectOperation,error:undefined});
    const epoch=this.epoch;
    const refreshHost=async()=>{try{
      if(retryNative)await client.request('host.reconnect');
      if(epoch===this.epoch)await this.refresh();
    }catch(error){if(epoch===this.epoch)this.publish({status:{phase:'failed',reason:this.reason(error),extensions:[]},error:this.reason(error)});}};
    await Promise.all([refreshHost(),this.refreshInputs()]);
  }
  private async refreshInputs(){
    const client=this.client,epoch=this.epoch;if(!client)return;
    try{
      const result=await client.request<{conversations:InputConversation[]}>('input.list');
      if(epoch!==this.epoch)return;
      if(!Array.isArray(result?.conversations))throw Error('原生草稿目录不可用。');
      this.publish({inputConversations:result.conversations,inputReady:true,inputError:undefined});
      const selected=this.targetConversation??this.state.activeId??this.preferences?.get('selectedConversation');
      if(selected&&result.conversations.some(item=>item.id===selected)&&this.state.status.phase!=='ready')await this.open(selected);
    }catch(error){if(epoch===this.epoch)this.publish({inputReady:false,inputError:this.reason(error)});}
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
      if(status.phase!=='ready'&&!status.readOnly)return;
      const {conversations}=await client.request<{conversations:ConversationSummary[]}>('list');
      if(epoch!==this.epoch)return;
      this.publish({conversations});
      if(status.phase==='ready'&&status.extensions.includes(MODELS_EXTENSION.id))await this.loadModels();
      if(status.phase==='ready'&&status.extensions.includes(PROJECTS_EXTENSION.id))await this.loadProjects();
      if(status.phase==='ready'&&status.extensions.includes(DATA_SAVER_EXTENSION.id))await this.dataSaver.refresh(this.state.activeId);
      const selected=this.targetConversation??this.state.activeId??this.preferences?.get('selectedConversation');
      if(selected&&conversations.some(conversation=>conversation.id===selected)){this.targetConversation=undefined;await this.open(selected);}else this.targetConversation=undefined;
    }catch(error){if(epoch===this.epoch)this.publish({status:{phase:'failed',reason:this.reason(error),extensions:[]},error:this.reason(error)});}
  }
  async create() {
    if(this.state.pending||this.state.status.phase!=='ready'||!this.client)return;
    if(!await this.flushCurrent())return;
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
  async openTarget(id:string){
    if(!/^[-A-Za-z0-9_]{1,128}$/.test(id))return;
    this.targetConversation=id;
    if(this.state.conversations.some(row=>row.id===id)||this.state.inputConversations.some(row=>row.id===id)){this.targetConversation=undefined;await this.open(id);}
    else if(this.state.status.phase==='ready')await this.refresh();
  }
  async open(id:string) {
    if(!this.client||!this.state.conversations.some(item=>item.id===id)&&!this.state.inputConversations.some(item=>item.id===id))return;
    const navigation=++this.navigation;
    if(this.state.activeId!==id&&!await this.flushCurrent())return;
    if(navigation!==this.navigation)return;
    const epoch=this.epoch,opening=++this.opening;const client=this.client;
    this.subscription?.unsubscribe();this.subscription=undefined;
    this.preferences?.set('selectedConversation',id);
    this.execution.select(id);
    if(this.state.status.phase==='ready'&&this.state.status.extensions.includes(DATA_SAVER_EXTENSION.id))void this.dataSaver.refresh(id);
    this.publish({page:'conversation',activeId:id,draft:this.drafts.view(id),submissions:this.submissions.view(id),conversation:undefined,history:[],next:undefined,loading:true,error:undefined,inputError:undefined});
    const current=()=>epoch===this.epoch&&opening===this.opening;
    const draftRead=this.drafts.read(id).catch(error=>{if(current())this.publish({inputError:this.reason(error)});});
    void this.refreshSubmissions();
    void this.loadProjects();
    try {
      if(this.state.status.phase!=='ready'&&!this.state.status.readOnly){await draftRead;return;}
      const [conversation,page]=await Promise.all([client.request<ConversationSnapshot>('open',{id}),client.request<HistoryPage>('history',{id,limit:30})]);
      if(!current())return;
      this.publish({conversation,history:mergeMessages(page.items,conversation.entries),next:page.next});
      if(this.state.status.readOnly){await draftRead;return;}
      const subscription=await client.subscribe(id,snapshot=>{
        if(!current())return;
        this.publish({conversation:snapshot,history:mergeMessages(this.state.history,snapshot.entries),conversations:this.state.conversations.map(item=>item.id===id?snapshot.conversation:item)});
      },error=>{if(current())this.publish({error:'观察已断开，请重新连接：'+error.message});});
      if(current())this.subscription=subscription;else subscription.unsubscribe();
    }catch(error){if(current())this.publish({error:this.reason(error)});}
    finally{await draftRead;if(current())this.publish({loading:false});}
  }
  async home() {
    const navigation=++this.navigation;
    if(!await this.flushCurrent())return;
    if(navigation!==this.navigation)return;
    this.opening++;this.subscription?.unsubscribe();this.subscription=undefined;
    this.preferences?.set('selectedConversation','');
    this.execution.select();
    if(this.state.status.phase==='ready'&&this.state.status.extensions.includes(DATA_SAVER_EXTENSION.id))void this.dataSaver.refresh();
    clearTimeout(this.sendPoll);this.publish({page:'conversation',activeId:undefined,draft:undefined,submissions:undefined,conversation:undefined,history:[],next:undefined,loading:false,error:undefined});void this.loadProjects();
  }
  editDraft(text:string){if(this.state.activeId)this.drafts.edit(this.state.activeId,text);}
  removeAttachment(selectionId:string){if(this.state.activeId)this.drafts.remove(this.state.activeId,selectionId);}
  async selectAttachment(kind:'image'|'file'|'camera'){const id=this.state.activeId,epoch=this.epoch;if(!id)return;try{await this.drafts.select(id,kind);}catch(error){if(error instanceof ApplicationFailure&&error.code==='INPUT_PICKER_CANCELLED')return;if(epoch===this.epoch&&id===this.state.activeId)this.publish({inputError:this.reason(error)});}}
  async prepareAttachment(selectionId:string){if(this.state.activeId)await this.drafts.prepare(this.state.activeId,selectionId);}
  async refreshDraft(){const id=this.state.activeId,epoch=this.epoch;if(!id)return;try{await this.drafts.read(id);if(epoch===this.epoch&&id===this.state.activeId)this.publish({inputError:undefined});}catch(error){if(epoch===this.epoch&&id===this.state.activeId)this.publish({inputError:this.reason(error)});}}
  async flushDraft(){if(this.state.activeId)return this.drafts.flush(this.state.activeId);}
  async retryDraft(){try{await this.flushDraft();this.publish({inputError:undefined});}catch(error){this.publish({inputError:this.reason(error)});}}
  async recoverDraft(keepLocal:boolean){const id=this.state.activeId,epoch=this.epoch;if(!id)return;try{await this.drafts.recover(id,keepLocal);if(epoch===this.epoch&&id===this.state.activeId)this.publish({inputError:undefined});}catch(error){if(epoch===this.epoch&&id===this.state.activeId)this.publish({inputError:this.reason(error)});}}
  private async flushCurrent(){try{if(this.state.activeId&&this.drafts.view(this.state.activeId))await this.drafts.flush(this.state.activeId);return true;}catch(error){this.publish({inputError:this.reason(error)});return false;}}
  async send(text?:string) {
    if(!this.client||!this.state.activeId||this.state.pending||this.state.submissions?.stopping)return false;
    if(text!==undefined)this.editDraft(text);
    const draft=this.state.draft;if(!draft||!draft.text.trim()&&!draft.selections.length)return false;
    const epoch=this.epoch,id=this.state.activeId,actionVersion=this.submissions.actionVersion(id);
    const context=draft.submissionContext??this.state.conversation?.conversation.submissionContext??this.state.inputConversations.find(item=>item.id===id)?.submissionContext;
    if(!context){this.publish({error:'尚未取得可信的会话位置关联，请连接运行宿主后重试。'});return false;}
    this.publish({pending:true,error:undefined});
    try {
      const {frozen,editEpoch}=await this.drafts.freeze(id);
      if(epoch!==this.epoch)return false;
      const accepted=await this.submissions.create(frozen,editEpoch,context,actionVersion);
      if(epoch===this.epoch)this.pollSubmissions(id);
      return accepted;
    }
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
    if(!client||!id)return;
    await this.submissions.stop(id);this.pollSubmissions(id);
  }
  async enableStopNotification(){
    const client=this.client,id=this.state.activeId,epoch=this.epoch;if(!client||!id)return;
    try{const result=await client.request<{enabled:boolean;requested:boolean}>('input.stopNotification',{id});if(epoch===this.epoch)this.publish({error:result.enabled?undefined:'系统停止入口需要通知权限；请按系统提示开启后再次检查。'});}
    catch(error){if(epoch===this.epoch)this.publish({error:this.reason(error)});}
  }
  async refreshSubmissions(cursor?:string){const id=this.state.activeId;if(id)await this.submissions.refresh(id,cursor);}
  async retrySubmission(intentId:string){await this.submissions.retry(intentId);if(this.state.activeId)this.pollSubmissions(this.state.activeId);}
  private pollSubmissions(id:string){
    clearTimeout(this.sendPoll);const epoch=this.epoch,deadline=Date.now()+60000;
    const next=()=>{this.sendPoll=setTimeout(async()=>{
      if(epoch!==this.epoch||id!==this.state.activeId)return;
      await this.submissions.refresh(id);
      const pending=this.submissions.view(id).items.some(item=>!item.intent?.cancelled&&item.status?.submission?.status!=='done'&&item.status?.submission?.status!=='unanswered');
      if(pending&&epoch===this.epoch&&id===this.state.activeId&&Date.now()<deadline)next();
    },1000);};next();
  }
  async openModels(){this.publish({page:'models',modelsNotice:undefined});await this.loadModels();}
  leaveModels(){this.publish({page:'conversation',modelsError:undefined,modelsNotice:undefined});}
  async openProjects(){this.publish({page:'projects',projectsNotice:undefined});await this.loadProjects();}
  leaveProjects(){this.publish({page:'conversation',projectsNotice:undefined});}
  async loadProjects(){
    const client=this.client,epoch=this.epoch,id=this.state.activeId;
    if(!client||this.state.projectsPending||this.state.status.phase!=='ready'||!this.state.status.extensions.includes(PROJECTS_EXTENSION.id))return;
    const read=++this.projectRead;this.publish({projectsLoading:true});
    try{
      const projects=await client.request<ProjectCatalog>('projects.get',id?{id}:{});
      if(epoch!==this.epoch||read!==this.projectRead||id!==this.state.activeId)return;
      if(projects.version>=(this.state.projects?.version??-1))this.publish({projects});
    }catch(error){if(epoch===this.epoch&&read===this.projectRead)this.publish({projectsError:this.reason(error)});}
    finally{if(epoch===this.epoch&&read===this.projectRead)this.publish({projectsLoading:false});}
  }
  createProject(input:{name:string;workspaceId:string}){return this.changeProjects('projects.create',{id:crypto.randomUUID(),...input});}
  renameProject(id:string,name:string){return this.changeProjects('projects.rename',{id,name});}
  createWorkspace(input:{name:string;path:string}){return this.changeProjects('workspaces.create',{id:crypto.randomUUID(),...input});}
  updateWorkspace(id:string,input:{name?:string;path?:string}){return this.changeProjects('workspaces.update',{id,...input});}
  selectProject(projectId:string|null){const id=this.state.activeId;return id?this.changeProjects('projects.select',{id,projectId}):Promise.resolve(false);}
  private async changeProjects(method:Exclude<ProjectMethod,'projects.get'>,payload:Record<string,unknown>){
    if(!this.state.projects||this.state.projectsPending||this.state.projectsLoading||this.state.projectsUnconfirmed||this.state.status.phase!=='ready')return false;
    this.projectOperation={method,payload:{...payload,operationId:crypto.randomUUID(),expectedVersion:this.state.projects.version}};
    return this.runProjectOperation();
  }
  retryProjectChange(){return this.state.projectsUnconfirmed?this.runProjectOperation():Promise.resolve(false);}
  private async runProjectOperation(){
    const client=this.client,operation=this.projectOperation,epoch=this.epoch;
    if(!client||!operation||this.state.projectsPending||this.state.status.phase!=='ready')return false;
    ++this.projectRead;this.publish({projectsLoading:false,projectsPending:true,projectsError:undefined,projectsNotice:undefined});
    try{
      const projects=await client.request<ProjectCatalog>(operation.method,operation.payload);
      if(epoch!==this.epoch)return false;
      this.projectOperation=undefined;this.publish({projects,projectsUnconfirmed:false,projectsNotice:'修改已保存。现有执行仍遵守已采用的位置。'});
      // A confirmed mutation stays confirmed even if reacquiring its views fails.
      try{
        const id=this.state.activeId;
        const current=await client.request<ProjectCatalog>('projects.get',id?{id}:{});
        if(epoch===this.epoch&&id===this.state.activeId&&current.version>=projects.version)this.publish({projects:current});
        const listing=await client.request<{conversations:ConversationSummary[]}>('list');
        if(epoch===this.epoch)this.publish({conversations:listing.conversations});
        if(id){const snapshot=await client.request<ConversationSnapshot>('open',{id});if(epoch===this.epoch&&id===this.state.activeId&&snapshot.revision>=(this.state.conversation?.revision??-1))this.publish({conversation:snapshot,history:mergeMessages(this.state.history,snapshot.entries)});await this.refreshDraft();}
      }catch(error){if(epoch===this.epoch)this.publish({projectsError:'修改已保存，最新界面读取未完成：'+this.reason(error)});}
      return true;
    }catch(error){
      if(epoch===this.epoch){
        const unknown=!!this.projectOperation&&error instanceof ApplicationFailure&&['RESPONSE_TIMEOUT','CONNECTION_CLOSED','HOST_UNAVAILABLE'].includes(error.code);
        if(!unknown)this.projectOperation=undefined;
        this.publish({projectsUnconfirmed:unknown,projectsError:this.reason(error)+(unknown?' 请核验这次修改；不要另建相同操作。':'')});
      }
      return false;
    }finally{if(epoch===this.epoch)this.publish({projectsPending:false});}
  }
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
  disconnect(){this.dataSaver.reset();this.execution.reset();this.epoch++;this.opening++;this.navigation++;clearTimeout(this.sendPoll);this.submissions.disconnect();this.subscription?.unsubscribe();this.client?.dispose();this.subscription=undefined;}
  dispose(){this.drafts.dispose();this.submissions.dispose();this.disconnect();this.listeners.clear();}
}
