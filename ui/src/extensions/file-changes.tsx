import {useEffect,useRef,useState} from 'react';
import type {ConversationController,UiState} from '../controller';

type Change={operationId:string;executionId:string|null;bindingId:string;path:string;destination?:string;namespace:string;original:boolean;state:string;scopeConfirmed:boolean;diff:{available:boolean;text?:string;reason?:string}};
type UnknownChange={executionId:string;state:string;diff:{available:false;reason:'unknown_command_scope'}};
type Page={changes:Change[];nextCursor:string|null;documents?:{changes:Change[];limited:boolean};untrackedExecutions:UnknownChange[];untrackedLimited:boolean};
const id=(value:unknown)=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,128}$/.test(value);
const reasons:Record<string,string>={binary:'二进制内容不提供文本差异',too_large:'内容超过文本差异的显示范围',diff_too_large:'文本差异超过显示范围',before_image_unavailable_after_interruption:'中断前的内容不可得，已按原件核验结果',unconfirmed:'原件变化尚未核验'};
function page(value:any):Page{
 if(!value||!Array.isArray(value.changes)||value.changes.length>20||value.nextCursor!==null&&!id(value.nextCursor)||!Array.isArray(value.untrackedExecutions)||value.untrackedExecutions.length>20||typeof value.untrackedLimited!=='boolean')throw Error('文件变更列表格式无法确认。');
 if(value.documents!==undefined&&(!Array.isArray(value.documents.changes)||value.documents.changes.length>20||typeof value.documents.limited!=='boolean'))throw Error('文档原件变更列表格式无法确认。');
 for(const row of [...value.changes,...value.documents?.changes??[]]){if(!row||!id(row.operationId)||row.executionId!==null&&!id(row.executionId)||typeof row.bindingId!=='string'||typeof row.path!=='string'||row.path.length>4096||row.destination!==undefined&&(typeof row.destination!=='string'||row.destination.length>4096)||typeof row.namespace!=='string'||typeof row.original!=='boolean'||typeof row.scopeConfirmed!=='boolean'||!['pending','prepared','applying','queued','accepted_not_started','running','stop_requested','completed','stopped','not_started','unknown'].includes(row.state)||!row.diff||typeof row.diff.available!=='boolean'||row.diff.available&&(typeof row.diff.text!=='string'||new TextEncoder().encode(row.diff.text).length>16384))throw Error('原件变化记录格式无法确认。');}
 for(const row of value.untrackedExecutions)if(!id(row?.executionId)||row.diff?.available!==false||row.diff.reason!=='unknown_command_scope')throw Error('命令范围记录格式无法确认。');
 return value;
}
function stateLabel(row:Change){if(row.state==='queued')return '等待其他写入完成';if(row.state==='completed')return row.scopeConfirmed?'原件修改已核验':'原件结果已记录，执行范围待核验';if(row.state==='not_started'&&row.scopeConfirmed)return '确认未修改';return '原件结果待核验';}

/** Read-only original-file evidence. No editor or write dispatch is exposed to WebView. */
export function FileChangesPanel({controller,state}:{controller:ConversationController;state:UiState}){
 const [view,setView]=useState<{id?:string;page?:Page;loading:boolean;error?:string;limited?:boolean}>({loading:false});
 const epoch=useRef(0),selected=useRef(state.activeId);selected.current=state.activeId;
 useEffect(()=>{++epoch.current;setView({id:state.activeId,loading:false});return()=>{++epoch.current;};},[state.activeId,controller.extensionClient]);
 async function load(cursor?:string){const client=controller.extensionClient,conversation=state.activeId;if(!client||!conversation||view.loading)return;const request=++epoch.current;setView(previous=>({...previous,id:conversation,loading:true,error:undefined}));
  try{const incoming=page(await client.request('files.list',{id:conversation,...(cursor?{cursor}:{})}));if(incoming.nextCursor===cursor)throw Error('文件变更读取位置未前进。');if(request!==epoch.current||selected.current!==conversation)return;setView(previous=>{const changes=[...new Map([...(cursor?previous.page?.changes??[]:[]),...incoming.changes].map(row=>[row.operationId,row])).values()];return {id:conversation,loading:false,page:{...incoming,changes:changes.slice(0,200)},limited:changes.length>=200&&incoming.nextCursor!==null};});}
  catch(error){if(request===epoch.current&&selected.current===conversation)setView(previous=>({...previous,loading:false,error:error instanceof Error?error.message:'文件变化读取未确认。'}));}
 }
 const current=view.id===state.activeId?view.page:undefined;
 const changes=[...current?.changes??[],...current?.documents?.changes??[]];
 return <section className="file-changes" aria-label="文件变更">
  <div className="execution-actions"><strong>文件变更</strong><button type="button" onClick={()=>void load()} disabled={!state.activeId||state.status.phase!=='ready'||view.loading}>{view.loading?'正在核验文件…':'查看文件变更'}</button></div>
  {view.error&&<p role="alert" className="execution-error">{view.error}</p>}
  {current&&changes.length===0&&<p>本会话暂无已知的逐文件修改记录。</p>}
  {current&&<ul className="execution-list" aria-label="本会话文件变更">{changes.map(row=><li key={row.operationId}>
   <div className="execution-row-title"><strong>{stateLabel(row)}</strong><span>{row.original?'原件':'副本'}</span></div>
   <code>{row.path}</code>
   {row.destination&&<p>重命名目标：<code>{row.destination}</code></p>}
   <details><summary>查看操作关联</summary><code>文件操作：{row.operationId}</code><code>执行：{row.executionId??'尚未登记执行'}</code><code>位置关联：{row.bindingId}</code></details>
   {row.diff.available?<pre className="file-diff">{row.diff.text||'内容未变化'}</pre>:<p>{reasons[row.diff.reason??'']??'本次文本差异不可得'}</p>}
  </li>)}</ul>}
  {current?.nextCursor&&!view.limited&&<button type="button" disabled={view.loading} onClick={()=>void load(current.nextCursor!)}>查看更多文件变更</button>}
  {view.limited&&<p>本页已显示 200 条文件变更，后续记录尚未载入。</p>}
  {current?.documents?.limited&&<p>此处显示最近 20 条文档原件变更。</p>}
  {current&&current.untrackedExecutions.length>0&&<details><summary>命令的写入范围未知，无法提供逐文件差异</summary><p>这些命令可能修改任意已授权位置，文件变化未逐项追踪。</p><ul>{current.untrackedExecutions.map(row=><li key={row.executionId}><code>{row.executionId}</code></li>)}</ul>{current.untrackedLimited&&<p>此处仅列出最近 20 次命令；更早记录请查看会话执行列表。</p>}</details>}
 </section>;
}
