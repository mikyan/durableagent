import {useEffect,useState,type RefObject} from 'react';
import type {HistoryMessage} from '../../../runtime/src/application-protocol';
export function QuestionAnchor({viewport,messages,onJump}:{viewport:RefObject<HTMLDivElement|null>;messages:HistoryMessage[];onJump:(id:string)=>void}){
 const message=[...messages].reverse().find(row=>row.role==='user');
 const [above,setAbove]=useState(false),[dismissed,setDismissed]=useState<string>();
 useEffect(()=>{
  const root=viewport.current;if(!root||!message){setAbove(false);return;}
  const measure=()=>{const target=Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(row=>row.dataset.messageId===message.id);if(!target){setAbove(false);return;}const bounds=root.getBoundingClientRect();setAbove(bounds.height>=100&&target.getBoundingClientRect().bottom<=bounds.top);};
  measure();root.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(root);if(root.firstElementChild)observer?.observe(root.firstElementChild);
  return()=>{root.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);observer?.disconnect();};
 },[viewport,message?.id,messages]);
 if(!message||!above||dismissed===message.id)return null;
 return <div className="question-anchor"><button className="question-jump" aria-label="回到本次输入" onClick={()=>{onJump(message.id);setAbove(false);}}><small>本次输入 ↑</small><span>{message.text.slice(0,100)||'图片附件'}</span></button><button className="question-dismiss" aria-label="关闭输入浮条" onClick={()=>setDismissed(message.id)}>×</button></div>;
}
