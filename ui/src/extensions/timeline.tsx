import {useEffect,useState,useRef} from 'react';
import type {ApplicationClient} from '../client';
import type {HistoryMessage,HistoryPage,ConversationSnapshot} from '../../../runtime/src/application-protocol';
export type TimelineClient=Pick<ApplicationClient,'request'|'subscribe'>;
const merge=(...pages:HistoryMessage[][])=>[...new Map(pages.flat().map(item=>[item.id,item])).values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
function RecordText({text}:{text:string}){const [expanded,setExpanded]=useState(false);const long=text.length>4000;let preview=text.slice(0,1000);if(/[\uD800-\uDBFF]$/.test(preview))preview=preview.slice(0,-1);return <><pre>{long&&!expanded?preview:text}</pre>{long&&<div><small>{expanded?'完整记录':'长记录已折叠，仅显示开头。'}</small><button onClick={()=>setExpanded(value=>!value)}>{expanded?'收起记录':'展开完整记录'}</button></div>}</>;}
/** A UI-only contribution: independent query/observation, no Agent code or execution switch. */
export default function Timeline({client,conversationId}:{client:TimelineClient;conversationId:string}){
 const generation=useRef(0);
 const [messages,setMessages]=useState<HistoryMessage[]>([]),[snapshot,setSnapshot]=useState<ConversationSnapshot>(),[cursor,setCursor]=useState<string>(),[busy,setBusy]=useState(true),[error,setError]=useState<string>(),[filter,setFilter]=useState('');
 useEffect(()=>{++generation.current;let active=true,subscription:{unsubscribe():void}|undefined;setMessages([]);setCursor(undefined);setSnapshot(undefined);setError(undefined);setBusy(true);
  const fail=(reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'订阅已断开，请重开时间线获取最新状态。');};
  void(async()=>{try{
   const page=await client.request<HistoryPage>('history',{id:conversationId,limit:30});if(!active)return;setMessages(page.items);setCursor(page.next);
   const pending=await client.subscribe(conversationId,value=>{if(active){setSnapshot(value);setMessages(previous=>merge(previous,value.entries));}},fail);
   if(active)subscription=pending;else pending.unsubscribe();
  }catch(reason){fail(reason);}finally{if(active)setBusy(false);}})();
  return()=>{active=false;++generation.current;subscription?.unsubscribe();};
 },[client,conversationId]);
 async function older(){if(!cursor||busy)return;const epoch=generation.current;setBusy(true);setError(undefined);try{const page=await client.request<HistoryPage>('history',{id:conversationId,cursor,limit:30});if(epoch!==generation.current)return;setMessages(previous=>merge(page.items,previous));setCursor(page.next);}catch(reason){if(epoch===generation.current)setError(reason instanceof Error?reason.message:'历史查询未完成');}finally{if(epoch===generation.current)setBusy(false);}}
 return <section className="timeline" data-testid="extension-timeline" aria-label="会话时间线">
  <p>按稳定记录展示当前会话。关闭时间线仅释放本页面订阅，会话继续运行。</p>
  <label>筛选已加载记录<input aria-label="筛选时间线" value={filter} onChange={event=>setFilter(event.target.value)}/></label>
  {error&&<p role="alert">观察暂不可用：{error}。这不表示会话已完成。</p>}
  {cursor&&<button onClick={()=>void older()} disabled={busy}>加载更早记录</button>}
  {busy&&<p role="status">正在读取时间线…</p>}
  <ol>{messages.filter(item=>item.text.includes(filter)).map(item=><li key={item.id} data-entry-id={item.id}><small>{item.role} · #{item.id} · 已保存</small><RecordText text={item.text}/>{item.attachments?.map(attachment=><p key={attachment.sha256}>图片 · {attachment.byteLength} 字节 · {attachment.mimeType}</p>)}</li>)}</ol>
  {snapshot?.progress&&<aside><small>生成中 · 尚未保存</small><p>{snapshot.progress.text}</p></aside>}
  {snapshot&&<p>当前会话状态：{snapshot.phase} · 已提交序号 {snapshot.storedSeq??'待读取'}</p>}
 </section>;
}
