import {defineDoc,InboxDoc,LiveDoc,type Harness,type Tx,type ConversationId} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createHash} from 'node:crypto';
import {Configuration,Products,type ProductRecord} from './application-records.js';
import type {ProjectCatalog,ProjectRecord,WorkspaceRecord,PositionState,LocationEditAuthority} from './project-protocol.js';
import {ExecutionBinding,type LocationAdapter} from './project-bindings.js';
export type {LocationAdapter} from './project-bindings.js';
import {Admission,Binding,CurrentBinding} from './submission.js';
import type {SendAuthority,SubmissionContext} from './submission-protocol.js';
export type ProjectBoundary='fenced'|'changed'|'committed'|'published';
export type EffectSnapshot={known:boolean;pendingBindingIds:string[];pendingControlProductIds?:string[]};
export type EffectAuthority={withSnapshot<T>(action:(snapshot:EffectSnapshot)=>Promise<T>):Promise<T>};
export class ProjectError extends Error {constructor(readonly code:string,message:string){super(message);}}
type Catalog={initialized:boolean;version:number;projects:Record<string,ProjectRecord>;workspaces:Record<string,WorkspaceRecord>;operations:Record<string,{fingerprint:string}>};
export const ProjectConfiguration=defineDoc({kind:'app.projects',version:1,scope:'session',initial:():Catalog=>({initialized:false,version:0,projects:{},workspaces:{},operations:{}}),checkpointWhen:()=>false});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const text=(value:unknown,label:string,max=128)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new ProjectError('INVALID_ARGUMENT',`${label} 无效`);return value;};
/** Shared metadata and cross-store edit policy. No deferred edits or file operations. */
export class Projects {
 private current!:Catalog;private positions=new Map<string,PositionState>();
 constructor(private readonly options:{harness:Harness;authority?:LocationEditAuthority;sends:SendAuthority;adapter?:LocationAdapter;boundary?:(stage:ProjectBoundary)=>void|Promise<void>;effects?:EffectAuthority;publish:()=>Promise<void>;guard?:(tx:Tx,workspaceIds:string[],productIds:string[])=>Promise<void>}){}
 async initialize(){this.current=await this.options.harness.commit(async tx=>{const d=await tx.doc(ProjectConfiguration),c=await tx.doc(Configuration);if(!d.initialized){d.workspaces.default={id:'default',name:'默认工作区',version:1,path:c.workspace.path,environment:'termux'};d.initialized=true;}return copy(d);},context);await this.options.harness.commit(async tx=>{const products=await tx.doc(Products);for(const p of Object.values(products.items)){const current=await tx.doc(CurrentBinding,p.id,null);if(!current.id)continue;const b=await tx.doc(Binding,current.id,null);if(b.id!==current.id||!b.context)continue;const expected=await this.resolve(tx,p.id);if(JSON.stringify(canonical(b.context))!==JSON.stringify(canonical(expected)))continue;const execution=await tx.doc(ExecutionBinding,p.sdkId as ConversationId);if(!b.location){const catalog=await tx.doc(ProjectConfiguration);b.location=copy(catalog.workspaces[p.workspaceId]);b.projectId=p.projectId??null;}if(!b.sourceProductId)b.sourceProductId=p.id;if(!execution.bindingId)execution.bindingId=current.id;if(!execution.controlProductId)execution.controlProductId=p.id;}},context);await this.refreshPositions();}
 async refresh(){const d=await this.options.harness.snapshot(ProjectConfiguration,context);if(d&&d.version>=this.current.version)this.current=copy(d as Catalog);await this.refreshPositions();}
 private async refreshPositions():Promise<void>{const catalog=this.current,positions=new Map<string,PositionState>();for(const w of Object.values(catalog.workspaces)){const position=this.options.adapter?await this.options.adapter.inspect(copy(w)):{state:'unverified' as const,reason:'执行环境尚未就绪，实际目录位置与访问能力未核验'};positions.set(w.id,position);}if(catalog.version!==this.current.version)return this.refreshPositions();this.positions=positions;}
 workspace(product:ProductRecord){const id=product.projectId?this.current.projects[product.projectId]?.workspaceId:product.workspaceId;const w=this.current.workspaces[id??'default'];if(!w)throw new ProjectError('LOCATION_MISMATCH','项目或工作区记录缺失');return w;}
 expectation(product:ProductRecord):SubmissionContext{const w=this.workspace(product);return {sdkConversationId:product.sdkId,associationVersion:product.associationVersion??1,location:{workspaceId:w.id,version:w.version,identity:createHash('sha256').update(JSON.stringify({id:w.id,path:w.path})).digest('hex')}};}
 async resolve(tx:Tx,id:string){const products=await tx.doc(Products),catalog=await tx.doc(ProjectConfiguration);const p=products.items[id];if(!p)throw new ProjectError('NOT_FOUND','会话不存在');const workspaceId=p.projectId?catalog.projects[p.projectId]?.workspaceId:p.workspaceId,w=catalog.workspaces[workspaceId??'default'];if(!w)throw new ProjectError('LOCATION_MISMATCH','项目或工作区记录缺失');return {sdkConversationId:p.sdkId,associationVersion:p.associationVersion??1,location:{workspaceId:w.id,version:w.version,identity:createHash('sha256').update(JSON.stringify({id:w.id,path:w.path})).digest('hex')}};}
 async view(id?:string):Promise<ProjectCatalog>{
  for(;;){
   await this.refresh();const catalog=copy(this.current),positions=new Map(this.positions);
   const p=id?(await this.options.harness.snapshot(Products,context))?.items[id]:undefined;
   const latest=await this.options.harness.snapshot(ProjectConfiguration,context);
   if(latest?.version!==catalog.version||this.current.version!==catalog.version)continue;
   const result:ProjectCatalog={version:catalog.version,projects:Object.values(catalog.projects),workspaces:Object.values(catalog.workspaces).map(w=>({...w,position:copy(positions.get(w.id)!)}))};
   if(id){if(!p)throw new ProjectError('NOT_FOUND','会话不存在');const workspaceId=p.projectId?catalog.projects[p.projectId]?.workspaceId:p.workspaceId,w=catalog.workspaces[workspaceId??'default'];if(!w)throw new ProjectError('LOCATION_MISMATCH','项目或工作区记录缺失');result.selection={id,projectId:p.projectId??null,workspaceId:w.id,associationVersion:p.associationVersion??1,position:copy(positions.get(w.id)!)};}
   return result;
  }
 }
 async adopt(tx:Tx,id:string,bindingId:string){const products=await tx.doc(Products),catalog=await tx.doc(ProjectConfiguration),p=products.items[id],w=catalog.workspaces[p.workspaceId];if(!w)throw new ProjectError('LOCATION_MISMATCH','工作区版本缺失');const binding=await tx.doc(Binding,bindingId,null),execution=await tx.doc(ExecutionBinding,p.sdkId as ConversationId);if(!binding.location){binding.location=copy(w);binding.projectId=p.projectId??null;binding.sourceProductId=id;const current=this.options.adapter?await this.options.adapter.inspect(copy(w)):undefined;binding.actualIdentity=current?.state==='available'?current.identity??null:null;}execution.bindingId=bindingId;execution.controlProductId=id;}
 async contexts(){const products=(await this.options.harness.snapshot(Products,context))?.items??{};return Object.values(products).map(p=>({id:p.id,context:this.expectation(p)}));}
 async recover(){const pending=await this.options.authority?.readLocationEdit();if(pending){await this.refresh();await this.options.publish();await this.options.authority!.finishLocationEdit(pending.operationId,await this.contexts());}}
 private async guard(tx:Tx,workspaceIds:string[],productIds:string[],effects:EffectSnapshot){
  if(!effects.known)throw new ProjectError('LOCATION_UNKNOWN','受管执行结果尚未核清，不能修改位置');
  const products=await tx.doc(Products),catalog=await tx.doc(ProjectConfiguration),ids=new Set(productIds);
  const positions=new Map<string,PositionState>();for(const w of Object.values(catalog.workspaces))positions.set(w.id,this.options.adapter?await this.options.adapter.inspect(copy(w)):{state:'unverified'});
  const targets=workspaceIds.map(id=>positions.get(id));
  const related=(workspaceId:string,identity?:string|null)=>workspaceIds.includes(workspaceId)||targets.some(target=>!target?.identity||!identity||target.identity===identity);
  for(const p of Object.values(products.items))if(related(p.workspaceId,positions.get(p.workspaceId)?.identity))ids.add(p.id);
  if(effects.pendingControlProductIds?.some(id=>ids.has(id)))throw new ProjectError('LOCATION_BUSY','仍有此控制归属下的未决受管执行，不能修改位置');
  let cursor:string|undefined;do{const page=await this.options.sends.listSends({cursor,limit:50});for(const intent of page.intents){if(intent.cancelled||!ids.has(intent.id))continue;const admission=await tx.doc(Admission,intent.intentId,null);if(!admission?.receipt)throw new ProjectError('LOCATION_BUSY','尚有可能投递的发送意图，不能修改位置');const record=await tx.submissionByRequest(intent.context.sdkConversationId as ConversationId,intent.intentId);if(!record||record.id!==admission.receipt.submissionId)throw new ProjectError('ADMISSION_INCONSISTENT','接纳关联无法核验，保留原位置');if(record.status==='queued'||record.status==='placed')throw new ProjectError('LOCATION_BUSY','已接纳的输入尚未结算，不能修改位置');}cursor=page.next;}while(cursor);
  for(const {id,control}of await this.options.sends.pendingStops())if(ids.has(id)&&control.pendingAbort)throw new ProjectError('LOCATION_BUSY','停止范围尚未核清，不能修改位置');
  // A ledger receipt outlives current pointers and even a retired conversation.
  for(const bindingId of effects.pendingBindingIds){const binding=await tx.doc(Binding,bindingId,null);if(!binding.id||!binding.context||!binding.location)throw new ProjectError('LOCATION_UNKNOWN','未决受管效果的位置绑定无法核验');if(ids.has(binding.sourceProductId??'')||related(binding.context.location.workspaceId,binding.actualIdentity))throw new ProjectError('LOCATION_BUSY','仍有未确认的受管效果，不能修改位置');}
  const sdkIds=new Set([...ids].map(id=>products.items[id]?.sdkId).filter((id):id is number=>id!==undefined));let conversations:any;
  do{const page=await tx.scanConversations({},50,conversations);for(const conversation of page.items){const execution=await tx.doc(ExecutionBinding,conversation.id);if(execution.bindingId){const binding=await tx.doc(Binding,execution.bindingId,null);if(!binding.context)throw new ProjectError('LOCATION_UNKNOWN','执行位置关联无法核验');if(ids.has(execution.controlProductId??'')||related(binding.context.location.workspaceId,binding.actualIdentity)){sdkIds.add(conversation.id);if(effects.pendingBindingIds.includes(execution.bindingId))throw new ProjectError('LOCATION_BUSY','仍有未确认的受管效果，不能修改位置');}}}conversations=page.next;}while(conversations);
  for(const id of sdkIds){const sdkId=id as ConversationId;const inbox=await tx.doc(InboxDoc,sdkId),live=await tx.doc(LiveDoc,sdkId);if(inbox.items.length||live.run)throw new ProjectError('LOCATION_BUSY','会话仍有排队输入或执行中的工作，不能修改位置');let next:any;do{const page=await tx.scanTasks({conversationId:sdkId},50,next);if(page.items.some(task=>task.state.status!=='terminal'))throw new ProjectError('LOCATION_BUSY','仍有可执行任务或后台后代，不能修改位置');next=page.next;}while(next);}
  await this.options.guard?.(tx,workspaceIds,productIds);
 }
 async change(method:string,payload:Record<string,unknown>){
  const operationId=text(payload.operationId,'operationId'),fingerprint=JSON.stringify(canonical({method,payload}));await this.refresh();const prior=Object.hasOwn(this.current.operations,operationId)?this.current.operations[operationId]:undefined;if(prior){if(prior.fingerprint!==fingerprint)throw new ProjectError('OPERATION_CONFLICT','此修改身份已用于不同操作');await this.recover();return this.view(method==='projects.select'?String(payload.id):undefined);}
  const changesLocation=method==='projects.select'||method==='workspaces.update'&&payload.path!==undefined;
  if(changesLocation&&!this.options.authority)throw new ProjectError('LOCATION_GATE_UNAVAILABLE','原生位置协调尚不可用');
  if(changesLocation)await this.options.authority!.beginLocationEdit(operationId);
  if(changesLocation)await this.options.boundary?.('fenced');
  let committed=false;
  try{
   const commit=(evidence:EffectSnapshot)=>this.options.harness.commit(async tx=>{const d=await tx.doc(ProjectConfiguration),products=await tx.doc(Products);if(Object.hasOwn(d.operations,operationId)){if(d.operations[operationId].fingerprint!==fingerprint)throw new ProjectError('OPERATION_CONFLICT','修改身份冲突');return copy(d);}if(!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion!==d.version)throw new ProjectError('CONFIG_CONFLICT','项目设置已更新，请刷新后重试');
    const id=text(payload.id,'id');
    if(method==='projects.create'){if(Object.hasOwn(d.projects,id))throw new ProjectError('ALREADY_EXISTS','项目身份已存在');const workspaceId=text(payload.workspaceId,'workspaceId');if(!Object.hasOwn(d.workspaces,workspaceId))throw new ProjectError('NOT_FOUND','工作区不存在');d.projects[id]={id,name:text(payload.name,'项目名称',120),workspaceId};}
    else if(method==='projects.rename'){if(!Object.hasOwn(d.projects,id))throw new ProjectError('NOT_FOUND','项目不存在');d.projects[id].name=text(payload.name,'项目名称',120);}
    else if(method==='projects.select'){const p=products.items[id];if(!p)throw new ProjectError('NOT_FOUND','会话不存在');const projectId=payload.projectId===null?null:text(payload.projectId,'projectId');if(projectId!==null&&!Object.hasOwn(d.projects,projectId))throw new ProjectError('NOT_FOUND','项目不存在');const next=projectId?d.projects[projectId].workspaceId:'default';if((p.projectId??null)!==projectId){const current=await tx.doc(CurrentBinding,id,null);await this.guard(tx,current.id?[p.workspaceId,next]:[],[id],evidence);current.id=null;(await tx.doc(ExecutionBinding,p.sdkId as ConversationId)).bindingId=null;p.projectId=projectId;p.workspaceId=next;p.associationVersion=(p.associationVersion??1)+1;}}
    else if(method==='workspaces.create'){if(Object.hasOwn(d.workspaces,id))throw new ProjectError('ALREADY_EXISTS','工作区身份已存在');const path=text(payload.path,'目录',2048);if(!path.startsWith('/')||path.includes('\u0000'))throw new ProjectError('INVALID_ARGUMENT','请输入绝对目录路径');d.workspaces[id]={id,name:text(payload.name,'工作区名称',120),path,environment:'termux',version:1};}
    else if(method==='workspaces.update'){const w=d.workspaces[id];if(!w)throw new ProjectError('NOT_FOUND','工作区不存在');if(payload.path!==undefined){const path=text(payload.path,'目录',2048);if(!path.startsWith('/')||path.includes('\u0000'))throw new ProjectError('INVALID_ARGUMENT','请输入绝对目录路径');if(path!==w.path){await this.guard(tx,[id],[],evidence);for(const p of Object.values(products.items))if(p.workspaceId===id){(await tx.doc(CurrentBinding,p.id,null)).id=null;(await tx.doc(ExecutionBinding,p.sdkId as ConversationId)).bindingId=null;}w.path=path;w.version++;}}if(payload.name!==undefined)w.name=text(payload.name,'工作区名称',120);}
    else throw new ProjectError('UNKNOWN_ACTION','未知项目操作');
    d.version++;d.operations[operationId]={fingerprint};await this.options.boundary?.('changed');return copy(d);
   },context);this.current=await (this.options.effects?this.options.effects.withSnapshot(commit):commit({known:true,pendingBindingIds:[]}));committed=true;await this.options.boundary?.('committed');await this.refreshPositions();await this.options.publish();if(changesLocation)await this.options.authority!.finishLocationEdit(operationId,await this.contexts());return this.view(method==='projects.select'?String(payload.id):undefined);
  }catch(error){if(changesLocation&&!committed&&error instanceof ProjectError){await this.refresh();await this.options.authority!.finishLocationEdit(operationId,await this.contexts());}throw error;}
 }
}
