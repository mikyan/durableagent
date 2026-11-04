import {useEffect,useState} from 'react';
import type {ConversationContext} from '../../../runtime/src/application-protocol';
import type {ConversationController,UiState} from '../controller';

export function useConversationContext(controller:ConversationController,state:UiState){
 const [value,setValue]=useState<ConversationContext>();
 const client=controller.extensionClient,id=state.activeId;
 const last=state.history.at(-1)?.id,phase=state.conversation?.phase,model=state.conversation?.conversation.model;
 useEffect(()=>{
  let active=true;setValue(undefined);
  if(client&&id&&state.status.phase==='ready')void client.request<ConversationContext>('context.get',{id}).then(result=>{
   if(active&&result.id===id&&['estimated','unavailable'].includes(result.state))setValue(result);
  },()=>{if(active)setValue({id,state:'unavailable',messages:0,scope:'committed-messages',note:'上下文统计暂不可用，可重新连接后查看。'});});
  return()=>{active=false;};
 },[client,id,last,phase,model?.provider,model?.modelId,state.status.phase]);
 return value?.id===id?value:undefined;
}
export function contextLabel(value?:ConversationContext){
 return value?.state==='estimated'&&value.tokens!==undefined?'上下文约 '+value.tokens.toLocaleString()+'+ token':'上下文不可用';
}
