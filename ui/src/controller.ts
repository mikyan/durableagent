import type {ApplicationStatus,ConversationSnapshot,ConversationSummary,HistoryMessage,HistoryPage} from '../../runtime/src/application-protocol';
import {ApplicationClient,ApplicationFailure} from './client';

export interface SelectionPreferences {get(key:string):string|null;set(key:string,value:string):void}
export type UiState={status:ApplicationStatus;conversations:ConversationSummary[];activeId?:string;conversation?:ConversationSnapshot;history:HistoryMessage[];next?:string;loading:boolean;pending:boolean;error?:string};
const mergeMessages=(older:HistoryMessage[],current:HistoryMessage[])=>[...new Map([...older,...current].map(message=>[message.id,message])).values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));

export class ConversationController {
  private state:UiState={status:{phase:'opening',extensions:[]},conversations:[],history:[],loading:false,pending:false};
  private listeners=new Set<()=>void>();
  private client?:ApplicationClient;
  private subscription?:{unsubscribe:()=>void};
  private epoch=0;
  private opening=0;
  private creationId?:string;
  private checking?:Promise<void>;
  constructor(private readonly connectClient:()=>ApplicationClient,private readonly preferences?:SelectionPreferences) {}
  snapshot=()=>this.state;
  observe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<UiState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  async connect() {
    ++this.epoch;this.subscription?.unsubscribe();this.subscription=undefined;this.client?.dispose();this.checking=undefined;
    const client=this.connectClient();this.client=client;
    this.publish({status:{phase:'opening',extensions:[]},pending:false,error:undefined});
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
    this.publish({activeId:id,conversation:undefined,history:[],next:undefined,loading:true,error:undefined});
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
    this.publish({activeId:undefined,conversation:undefined,history:[],next:undefined,loading:false,error:undefined});
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
  private reason(error:unknown){return error instanceof ApplicationFailure||error instanceof Error?error.message:'操作未完成，请重新连接查看当前状态。';}
  disconnect(){this.epoch++;this.opening++;this.subscription?.unsubscribe();this.client?.dispose();this.subscription=undefined;}
  dispose(){this.disconnect();this.listeners.clear();}
}
