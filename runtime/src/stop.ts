import type {ConversationId,Harness} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {ExecutionBinding} from './project-bindings.js';

/** Application control ownership may include a fork outside SDK task ownership.
 * Keep admission closed until every currently inherited scope is actually idle.
 * The SDK remains responsible for abort markers, input withdrawal and task outcomes.
 */
export async function abortControlScope(harness:Harness,productId:string,root:ConversationId){
 const finished=new Set<number>();
 for(;;){
  const scope=await harness.commit(async tx=>{
   const ids=new Set<ConversationId>([root]);let cursor;
   do{const page=await tx.scanConversations({},50,cursor);for(const conversation of page.items){const binding=await tx.doc(ExecutionBinding,conversation.id);if(binding.controlProductId===productId)ids.add(conversation.id);}cursor=page.next;}while(cursor);
   const tasks=[];for(const id of ids){let next;do{const page=await tx.scanTasks({conversationId:id},50,next);for(const task of page.items)if(task.state.status!=='terminal')tasks.push(task.id);next=page.next;}while(next);}
   return {ids:[...ids],tasks};
  },context);
  const fresh=scope.ids.filter(id=>!finished.has(id));
  if(!fresh.length&&!scope.tasks.length)return;
  for(const id of fresh){const conversation=await harness.conversation(id,context);if(conversation)await conversation.abort(context,{background:true});finished.add(id);}
  // A later background task created by an abort hook is not covered by the earlier call.
  // Public abortTask waits for its actual terminal receipt; it does not fabricate an outcome.
  for(const id of scope.tasks){const task=await harness.getTask(id,context);if(task&&task.state.status!=='terminal')await harness.abortTask(id,context);}
 }
}
