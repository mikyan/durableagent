import {useEffect,useMemo,useState} from 'react';
import type {ConversationController,UiState} from '../controller';

/** Searches the currently loaded public history only; older pages remain explicit. */
export function HistoryNavigator({controller,state,onJump}:{controller:ConversationController;state:UiState;onJump:(id:string)=>void}){
 const [query,setQuery]=useState('');
 useEffect(()=>setQuery(''),[state.activeId]);
 const rows=[...state.conversations,...state.inputConversations.filter(row=>!state.conversations.some(item=>item.id===row.id))];
 const position=rows.findIndex(row=>row.id===state.activeId);
 const matches=useMemo(()=>query.trim()?state.history.filter(row=>row.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[],[query,state.history]);
 return <section className="history-navigation" aria-label="当前会话记录定位">
  <div className="detail-actions">
   <button className="secondary-button" disabled={position<=0} onClick={()=>void controller.open(rows[position-1].id)}>上一个会话</button>
   <button className="secondary-button" disabled={position<0||position>=rows.length-1} onClick={()=>void controller.open(rows[position+1].id)}>下一个会话</button>
  </div>
  <label className="conversation-search">搜索当前会话<input type="search" aria-label="搜索当前会话" value={query} maxLength={200} placeholder="查找已加载的消息…" onChange={event=>setQuery(event.target.value)}/></label>
  <p className="search-scope">已搜索当前加载的 {state.history.length} 条记录；{state.next?'还有更早记录未载入。':'历史已全部载入。'}</p>
  {state.next&&<button className="text-button" disabled={state.loading} onClick={()=>void controller.loadOlder()}>{state.loading?'正在读取更早记录…':'载入更早记录再搜索'}</button>}
  {query.trim()&&<><p className="search-count">{matches.length?String(matches.length)+' 条匹配记录':'当前已加载记录中没有匹配内容。'}</p><ul className="search-results">{matches.slice(0,50).map(row=><li key={row.id}><button onClick={()=>onJump(row.id)} aria-label={'定位消息 '+row.text.slice(0,100)}><span>{row.role==='user'?'你':row.role==='assistant'?'Agent':row.role==='tool'?'工具':'系统'}</span>{row.text.slice(0,120)}{row.text.length>120?'…':''}</button></li>)}</ul>{matches.length>50&&<p className="search-scope">仅显示前 50 条匹配，请缩小搜索范围。</p>}</>}
 </section>;
}
