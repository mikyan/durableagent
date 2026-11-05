import type {LiveState} from '@earendil-works/pi-durable';
import type {ConversationActivity,ConversationPhase} from './application-protocol.js';

/** Presentation from the SDK's current live events, never inferred from a submitted message. */
export function conversationActivity(live:LiveState|undefined,phase:ConversationPhase):ConversationActivity|undefined {
 if(phase!=='running'||!live?.run)return;
 const running=[...(live.tools??[]),...(live.nestedTools??[])].filter(slot=>slot.status==='running'&&!(('unoffered' in slot)&&slot.unoffered));
 if(running.length){
  const names=[...new Set(running.map(slot=>slot.name).filter(name=>/^[A-Za-z0-9_.-]{1,80}$/.test(name)))];
  return {kind:'tool',...(names.length?{label:names.slice(0,3).join('、')+(names.length>3?` 等 ${names.length} 个工具`:'')}:{})};
 }
 if(!live.generation||live.generation.retry||live.generation.deferred)return;
 const content=live.generation.message?.content??[];
 const latest=content.findLast(block=>block.type==='thinking'?(block.redacted===true||block.thinking.length>0):block.type==='text'?block.text.length>0:true);
 // Report the provider's reasoning phase without exposing its reasoning text/signature.
 return {kind:latest?.type==='thinking'?'thinking':'model'};
}
