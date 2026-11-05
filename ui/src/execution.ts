import {ApplicationClient,ApplicationFailure} from './client';

export type ExecutionState='queued'|'accepted_not_started'|'starting'|'running'|'stop_requested'|'stopped'|'not_started'|'completed'|'unknown';
export type TermuxDownloadSource='github'|'fdroid';
export type ExecutionRow={executionId:string;state:ExecutionState;sequence?:number;source?:'application';reason?:string;exitCode?:number|null;captureIncomplete?:boolean;scopeConfirmed?:boolean};
export type ExecutionView={rows:ExecutionRow[];conversationId?:string;nextCursor?:string;limited?:boolean;loading:boolean;connecting:boolean;copying:boolean;openingSource?:TermuxDownloadSource;pending:string[];connected:boolean;notice?:string;error?:string};
const states=new Set(['queued','accepted_not_started','starting','running','stop_requested','stopped','not_started','completed','unknown']);
function receipt(value:unknown):ExecutionRow {
  const row=value as ExecutionRow;
  if(!row||typeof row!=='object'||!/^[-A-Za-z0-9_]{1,128}$/.test(row.executionId)||!states.has(row.state)||row.sequence!==undefined&&(!Number.isSafeInteger(row.sequence)||row.sequence<0))throw Error('执行回执格式无法确认。');
  return {...row};
}
export class ExecutionCoordinator {
  private state:ExecutionView={rows:[],loading:false,connecting:false,copying:false,pending:[],connected:false};
  private generation=0;
  private reads=0;
  constructor(private readonly client:()=>ApplicationClient|undefined,private readonly changed:()=>void){}
  view=()=>this.state;
  private publish(patch:Partial<ExecutionView>){this.state={...this.state,...patch};this.changed();}
  reset(){++this.generation;++this.reads;this.publish({rows:[],conversationId:undefined,nextCursor:undefined,limited:false,loading:false,connecting:false,copying:false,openingSource:undefined,pending:[],connected:false,error:undefined,notice:undefined});}
  select(conversationId?:string){++this.reads;this.publish({rows:[],conversationId,nextCursor:undefined,limited:false,loading:false,pending:[],error:undefined});}
  private message(error:unknown){
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_FORCE_STOPPED')return 'Termux 已被系统强行停止。请手动打开 Termux 一次，再返回本应用；无需重新初始化。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_SOURCE_UNVERIFIED')return '当前 Termux 安装包的来源尚未确认。联网后点击“连接执行环境”核验官方发行记录；已有执行记录会保留。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_SOURCE_UNAVAILABLE')return '暂时无法获取官方发行记录，不能确认当前安装包来源。请联网后重试“连接执行环境”；无需重新初始化或卸载 Termux。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_SOURCE_UNSUPPORTED')return '暂不支持此 Termux 安装来源或打包形式。请保留现有 Termux 及其数据，查看“安装来源与兼容说明”；不要直接卸载或覆盖安装。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_CAPABILITY_UNSUPPORTED')return '当前 Termux 的外部命令接口不兼容，无法连接。请核对安装渠道与版本；已有环境和执行记录会保留。';
    if(error instanceof ApplicationFailure&&error.code==='BOOTSTRAP_PROTOCOL_MISMATCH')return '执行端握手协议或响应无法确认。请核对本应用与执行端是否为配套发布版本，再重试连接；保留现有配对和执行记录，不要重新初始化。';
    if(error instanceof ApplicationFailure&&error.code==='INSTANCE_MISMATCH')return '执行端响应与已配对记录不一致，无法确认执行端身份。请确认连接的是原有 Termux 执行环境，再重试连接；保留现有配对和执行记录，不要重新初始化。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_MISSING')return '尚未安装 Termux。请展开“安装来源与兼容说明”打开官方发布页，完成首次打开后，再执行初始化命令。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_PERMISSION_REQUIRED')return '尚未取得 Termux 命令执行授权。请点击“连接执行环境”，在系统提示中允许本应用运行 Termux 命令。';
    if(error instanceof ApplicationFailure&&error.code==='SETUP_REQUIRED')return '尚未完成执行环境初始化。请点击“复制初始化命令”，在 Termux 中粘贴并运行，再回来连接执行环境。';
    if(error instanceof ApplicationFailure&&error.code==='TERMUX_DOWNLOAD_UNAVAILABLE')return '未能打开浏览器。可手动访问 https://github.com/termux/termux-app/releases 或 https://f-droid.org/packages/com.termux/。';
    return error instanceof Error?error.message:'执行状态未确认。';
  }
  async copySetup(){
    const client=this.client(),generation=this.generation;if(!client||this.state.copying)return;
    this.publish({copying:true,error:undefined});
    try{const value=await client.request<{copied:boolean}>('execution.copySetup',{});if(value?.copied!==true)throw Error('初始化命令复制未确认。');if(generation===this.generation)this.publish({notice:'初始化命令已复制。在 Termux 中粘贴并运行一次，然后回来连接。'});}
    catch(error){if(generation===this.generation)this.publish({error:this.message(error)});}
    finally{if(generation===this.generation)this.publish({copying:false});}
  }
  async openDownload(source:TermuxDownloadSource){
    const client=this.client(),generation=this.generation;if(!client||this.state.openingSource)return;
    this.publish({openingSource:source,error:undefined,notice:undefined});
    try{const value=await client.request<{opened:boolean}>('execution.openDownload',{source});if(value?.opened!==true)throw new ApplicationFailure('TERMUX_DOWNLOAD_UNAVAILABLE','');if(generation===this.generation)this.publish({notice:'已请求在外部浏览器打开官方发布页；安装和更新由你确认。'});}
    catch(error){if(generation===this.generation)this.publish({error:this.message(error)});}
    finally{if(generation===this.generation)this.publish({openingSource:undefined});}
  }
  async connect(){
    const client=this.client(),generation=this.generation;if(!client||this.state.connecting)return;
    this.publish({connecting:true,error:undefined,notice:undefined});
    try{const value=await client.request<{protocol:number;executorId:string;ledgerEpoch:string}>('execution.connect',{},60000);if(value?.protocol!==1||!value.executorId||!value.ledgerEpoch)throw Error('执行环境身份未确认。');if(generation===this.generation)this.publish({connected:true,notice:'执行环境已连接；可核验已有执行。'});}
    catch(error){if(generation===this.generation)this.publish({connected:false,error:this.message(error)});}
    finally{if(generation===this.generation)this.publish({connecting:false});}
  }
  async loadMore(){if(this.state.conversationId&&this.state.nextCursor&&!this.state.loading&&!this.state.limited)await this.refresh(this.state.conversationId,this.state.nextCursor);}
  async refresh(conversationId:string,cursor?:string,preserve=false){
    const client=this.client(),generation=this.generation;++this.reads;if(!client)return;
    if(this.state.conversationId!==conversationId)this.select(conversationId);
    const currentRead=this.reads;
    this.publish({loading:true,error:undefined});
    try{
      const value=await client.request<{executions:unknown[];nextCursor?:string|null}>('execution.list',{id:conversationId,...(cursor?{cursor}:{})});
      if(!Array.isArray(value?.executions)||value.executions.length>20||value.nextCursor!=null&&(typeof value.nextCursor!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.nextCursor)||value.nextCursor===cursor))throw Error('执行列表未确认。');
      const incoming=value.executions.map(receipt);
      const rows=[...new Map([...(cursor||preserve?this.state.rows:[]),...incoming.map(row=>this.newer(row))].map(row=>[row.executionId,row])).values()];
      if(generation===this.generation&&currentRead===this.reads)this.publish({rows:rows.slice(0,1000),conversationId,nextCursor:preserve?this.state.nextCursor:value.nextCursor??undefined,limited:rows.length>=1000&&!!(preserve?this.state.nextCursor:value.nextCursor)});
    }catch(error){if(generation===this.generation&&currentRead===this.reads)this.publish({error:this.message(error)});}
    finally{if(generation===this.generation&&currentRead===this.reads)this.publish({loading:false});}
  }
  private newer(row:ExecutionRow){
    const previous=this.state.rows.find(item=>item.executionId===row.executionId);if(!previous)return row;
    // A later loss of contact is new information even without a new server event.
    // It cannot undo a confirmed terminal fact, but must qualify a past running receipt.
    if(row.source==='application')return previous.source!=='application'&&['completed','stopped','not_started'].includes(previous.state)?previous:row;
    return (previous.sequence??0)>(row.sequence??0)?previous:row;
  }
  query(executionId:string){return this.operate('execution.query',executionId);}
  cancel(executionId:string){return this.operate('execution.cancel',executionId);}
  private async operate(method:'execution.query'|'execution.cancel',executionId:string){
    const client=this.client(),generation=this.generation,conversationId=this.state.conversationId;
    if(!client||!this.state.rows.some(row=>row.executionId===executionId)||this.state.pending.includes(executionId))return;
    this.publish({pending:[...this.state.pending,executionId],error:undefined,notice:undefined});
    try{
      const row=receipt(await client.request(method,{executionId},12000));
      if(row.executionId!==executionId)throw Error('执行身份不一致。');
      if(generation===this.generation&&conversationId===this.state.conversationId)this.publish({rows:this.state.rows.map(item=>item.executionId===executionId?this.newer(row):item),notice:row.state==='stop_requested'?'取消已请求，等待确认执行范围已停止。':row.state==='unknown'?'执行结果未知，无法确认已停止；不会自动重发命令。':method==='execution.cancel'?'已收到本次执行的取消回执。':'执行状态已核验。'});
      if(generation===this.generation&&conversationId===this.state.conversationId&&conversationId)void this.refresh(conversationId,undefined,true);
    }catch(error){if(generation===this.generation&&conversationId===this.state.conversationId)this.publish({error:this.message(error),notice:'未收到可确认的回执，保留原状态；不会自动重发命令。'});}
    finally{if(generation===this.generation&&conversationId===this.state.conversationId)this.publish({pending:this.state.pending.filter(id=>id!==executionId)});}
  }
}
