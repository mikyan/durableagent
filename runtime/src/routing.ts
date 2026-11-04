import type {Harness,ToolExecutionApi} from '@earendil-works/pi-durable';
import type {Context} from '@earendil-works/chord/context';
import {ExecutionBinding} from './project-bindings.js';
import type {RouteAuthority,RouteRequest,RouteSource} from './routing-protocol.js';
import type {SendAuthority} from './submission-protocol.js';
import {SubmissionError,type Submissions} from './submission.js';
import type {ConversationSummary} from './application-protocol.js';

export async function checkRouteSource(authority:SendAuthority,source:RouteSource){
 if(!source||typeof source.id!=='string'||!source.id||!Number.isSafeInteger(source.sdkConversationId)||!Number.isSafeInteger(source.controlGeneration)||source.controlGeneration<1||source.taskId!==undefined&&!Number.isSafeInteger(source.taskId))throw new SubmissionError('ROUTE_INVALID','转交来源身份无效');
 const control=await authority.readControl(source.id);
 if(control.pendingAbort||control.generation!==source.controlGeneration||control.stoppedThrough>=source.controlGeneration)throw new SubmissionError('SOURCE_STOPPED','来源操作已停止或控制代次已改变，未转交这次输入');
}
type Options={authority:SendAuthority;routes?:RouteAuthority;submissions:Submissions;harness:Harness;ids:()=>Promise<string[]>;summary:(id:string)=>Promise<ConversationSummary>;create:(id:string,title:string)=>Promise<unknown>;ready:()=>void};
export class Routing {
 constructor(private readonly options:Options){}
 async list(cursor?:string){const ids=(await this.options.ids()).sort().filter(id=>!cursor||id>cursor),page=ids.slice(0,30);return {items:await Promise.all(page.map(id=>this.query(id))),...(ids.length>30?{next:page.at(-1)}:{})};}
 async query(id:string){const summary=await this.options.summary(id),control=await this.options.authority.readControl(id);return {id:summary.id,title:summary.title,phase:summary.phase,context:summary.submissionContext!,control};}
 private async source(source:RouteSource){await checkRouteSource(this.options.authority,source);const summary=await this.options.summary(source.id);if(summary.submissionContext?.sdkConversationId!==source.sdkConversationId)throw new SubmissionError('SOURCE_MISMATCH','来源会话关联无法核验');}
 async create(payload:{source:RouteSource;creationId:string;title?:string}){
  return this.options.submissions.coordinate(async()=>{this.options.ready();await this.source(payload.source);return this.options.create(payload.creationId,payload.title??'新会话');});
 }
 async send(payload:RouteRequest){
  if(!this.options.routes)throw new SubmissionError('ROUTING_UNAVAILABLE','原生转交存储尚不可用');
  if(!payload||typeof payload.actionId!=='string'||!payload.actionId||payload.actionId.length>128||typeof payload.id!=='string'||!payload.id||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>100000||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(payload.text))throw new SubmissionError('ROUTE_INVALID','转交目标、稳定动作或正文无效');
  // The native operation is one durable transaction. The following SDK admission uses the SAME T07 path.
  const intent=await this.options.submissions.coordinate(async()=>{this.options.ready();return this.options.routes!.createRoute(payload);});
  const result=await this.options.submissions.send(intent.intentId);
  // This boundary may enter source tool history. Never serialize another author's ACK/draft.
  const {accepted,receipt,submission,waiting}=result;
  return {intent:result.intent,accepted,receipt,submission,waiting,acknowledged:result.intent.delivery==='acknowledged'};
 }
 async origin(api:ToolExecutionApi,callContext:Context):Promise<RouteSource>{
  const remembered=await api.memo<any>('app.route-source',callContext);if(remembered)return remembered;
  const binding=await api.snapshot(ExecutionBinding,api.conversationId,callContext);
  if(!binding?.controlProductId)throw new SubmissionError('SOURCE_MISMATCH','当前调用缺少可核验的产品控制归属');
  const product=await this.query(binding.controlProductId);
  const source={id:product.id,sdkConversationId:product.context.sdkConversationId,controlGeneration:product.control.generation,taskId:api.taskId};
  await this.source(source);
  return api.memo('app.route-source',source,callContext);
 }
 async guard(source:RouteSource){await this.source(source);}
}
