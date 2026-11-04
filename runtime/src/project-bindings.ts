import {defineDoc,type ConversationRecord,type Tx,type EnvTarget} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {ExecutionEnv} from '@earendil-works/pi-durable/env';
import {Binding} from './submission.js';
import type {WorkspaceRecord,PositionState} from './project-protocol.js';
export type AdoptedBinding={id:string;location:WorkspaceRecord;projectId:string|null;sourceProductId:string;controlProductId:string;sdkConversationId:number;actualIdentity?:string};
export type LocationAdapter={inspect(workspace:WorkspaceRecord):Promise<PositionState>;environment?(binding:AdoptedBinding):Promise<ExecutionEnv>};
export const ExecutionBinding=defineDoc({kind:'app.execution-binding',version:1,scope:'conversation',history:'latest',fork:'current',initial:()=>({bindingId:null as string|null,inherited:false as boolean,controlProductId:null as string|null}),checkpointWhen:()=>false});
export async function inheritBinding(tx:Tx,record:ConversationRecord){
 const child=await tx.doc(ExecutionBinding,record.id);
 if(record.owner){const owner=await tx.doc(ExecutionBinding,record.owner.conversationId);if(!owner.bindingId||!owner.controlProductId)throw Error('内部会话缺少可继承的执行位置或控制归属');if(!record.parent||!child.bindingId)child.bindingId=owner.bindingId;child.controlProductId=owner.controlProductId;child.inherited=true;}
 else if(record.parent&&child.bindingId){if(!child.controlProductId)throw Error('分支会话控制归属缺失');child.inherited=true;}
}
export async function bindingEnvironment(target:EnvTarget,adapter?:LocationAdapter):Promise<ExecutionEnv>{
 const execution=await target.read.snapshot(ExecutionBinding,target.conversationId,context);
 if(!execution?.bindingId)throw Error('执行位置尚未绑定');const binding=await target.read.snapshot(Binding,execution.bindingId,context);
 if(!binding?.id||!binding.location||!binding.sourceProductId||!execution.controlProductId)throw Error('执行位置版本缺失，不能回退当前目录');
 if(!adapter?.environment)throw Error('执行环境尚未就绪，未访问任何目录');const current=await adapter.inspect(binding.location);
 if(current.state!=='available'||binding.actualIdentity&&current.identity!==binding.actualIdentity)throw Error(current.reason??'执行位置或授权已改变，保留原绑定');
 return adapter.environment({id:binding.id,location:binding.location,projectId:binding.projectId??null,sourceProductId:binding.sourceProductId,controlProductId:execution.controlProductId,sdkConversationId:target.conversationId,...(binding.actualIdentity?{actualIdentity:binding.actualIdentity}:{})});
}

/** For supported internal task conversations; never a product/user input bypass. */
export async function submitBoundInternal(tx:Tx,conversation:import('@earendil-works/pi-durable').ConversationHandle,draft:import('@earendil-works/pi-durable').InputSubmissionDraft){
 const execution=await tx.doc(ExecutionBinding,conversation.id);if(!execution.inherited||!execution.bindingId)throw Error('内部输入缺少继承位置');const binding=await tx.doc(Binding,execution.bindingId,null);if(!binding.context||!binding.location)throw Error('内部输入的执行位置版本无法核验');return conversation.submit(tx,draft);
}
