import type {DataSaverSettings,ExecutionPolicy} from '../../runtime/src/data-saver-protocol';
import type {ApplicationClient} from './client';
export type DataSaverView={settings?:DataSaverSettings;conversationId?:string;operations:ExecutionPolicy[];loading:boolean;pending:boolean;error?:string;notice?:string;nextCursor?:string};
export class DataSaverCoordinator {
 private state:DataSaverView={operations:[],loading:false,pending:false};
 private generation=0;
 private reads=0;
 constructor(private readonly client:()=>ApplicationClient|undefined,private readonly changed:()=>void){}
 view=()=>this.state;
 private publish(patch:Partial<DataSaverView>){this.state={...this.state,...patch};this.changed();}
 private settings(value:DataSaverSettings){if(!value||typeof value.enabled!=='boolean'||typeof value.restricted!=='boolean'||!Number.isSafeInteger(value.version)||value.version<0||!Number.isSafeInteger(value.period)||value.period<0||!value.network||typeof value.network.known!=='boolean')throw Error('当前省流设置与网络事实尚未确认。');return value;}
 async refresh(conversationId?:string,cursor?:string){
  const client=this.client(),generation=this.generation,read=++this.reads;if(!client)return;
  if(this.state.conversationId!==conversationId)this.publish({conversationId,operations:[],nextCursor:undefined,notice:undefined});
  this.publish({loading:true,error:undefined});
  try{
   const settings=this.settings(await client.request<DataSaverSettings>('dataSaver.get'));
   const page=conversationId?await client.request<{operations:ExecutionPolicy[];nextCursor:string|null}>('dataSaver.operations',{id:conversationId,...(cursor?{cursor}:{})}):{operations:[],nextCursor:null};
   if(!Array.isArray(page.operations)||page.operations.length>20||page.operations.some(value=>value.productId!==conversationId||!['waiting','allowed','granted','result-unverified','terminal'].includes(value.phase)))throw Error('本会话省流操作尚未确认。');
   if(generation===this.generation&&read===this.reads)this.publish({settings,operations:cursor?[...this.state.operations,...page.operations]:page.operations,nextCursor:page.nextCursor??undefined});
  }catch(error){if(generation===this.generation&&read===this.reads)this.publish({error:error instanceof Error?error.message:'省流状态未确认。'});}
  finally{if(generation===this.generation&&read===this.reads)this.publish({loading:false});}
 }
 async configure(enabled:boolean){
  const client=this.client(),settings=this.state.settings,generation=this.generation;if(!client||!settings||this.state.pending)return;
  ++this.reads;this.publish({pending:true,error:undefined,notice:undefined});
  try{const saved=this.settings(await client.request<DataSaverSettings>('dataSaver.configure',{enabled,expectedVersion:settings.version}));if(generation===this.generation){this.publish({settings:saved});await this.refresh(this.state.conversationId);}}
  catch(error){if(generation===this.generation)this.publish({error:error instanceof Error?error.message:'设置保存未确认。'});}
  finally{if(generation===this.generation)this.publish({pending:false});}
 }
 async grant(executionId:string){
  const client=this.client(),generation=this.generation,id=this.state.conversationId,row=this.state.operations.find(value=>value.executionId===executionId);
  if(!client||!id||!row||row.phase!=='waiting'||!row.finalDigest||this.state.pending)return;
  ++this.reads;this.publish({pending:true,error:undefined,notice:undefined});
  try{await client.request('dataSaver.grant',{id,executionId,requestDigest:row.requestDigest,finalDigest:row.finalDigest,period:row.period});
   if(generation===this.generation&&this.state.conversationId===id){this.publish({notice:'仅放行这一固定执行及本次受限网络期间；本操作未更改全局省流设置。'});await this.refresh(id);}
  }catch(error){if(generation===this.generation&&this.state.conversationId===id)this.publish({error:error instanceof Error?error.message:'临时放行未确认。'});}
  finally{if(generation===this.generation)this.publish({pending:false});}
 }
 reset(){++this.generation;++this.reads;this.publish({settings:undefined,operations:[],conversationId:undefined,nextCursor:undefined,loading:false,pending:false,error:undefined,notice:undefined});}
}
