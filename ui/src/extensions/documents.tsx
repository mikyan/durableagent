import {useEffect,useRef,useState} from 'react';
import type {OriginalResource,OriginalResourcePage} from '../../../runtime/src/document-protocol';
import type {TimelineClient} from './timeline';
import '../documents.css';

function resource(value:OriginalResource):OriginalResource {
 if(!value||value.protocol!==1||value.original!==true||value.source!=='saf'||!/^[a-f0-9]{64}$/.test(value.resourceId)||value.namespace!=='saf:'+value.resourceId||typeof value.uri!=='string'||!value.uri.startsWith('content://')||typeof value.displayName!=='string'||typeof value.mimeType!=='string'||!['available','permission_required','not_found','unavailable'].includes(value.availability)||!value.grant||[value.grant.read,value.grant.write,value.grant.persistedRead,value.grant.persistedWrite].some(flag=>typeof flag!=='boolean'))throw Error('原文件身份或当前授权尚未确认。');
 return value;
}
const access=(row:OriginalResource)=>row.availability!=='available'?(row.reason??'原文件当前不可用。'):row.grant.write?'当前可读写原件':'当前仅可读取原件';

/** Native selection/observation works independently from the model's event loop. */
export function DocumentsPanel({client}:{client?:TimelineClient}) {
 const [rows,setRows]=useState<OriginalResource[]>([]),[cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>();
 const epoch=useRef(0),active=useRef(false);
 useEffect(()=>{++epoch.current;active.current=false;setRows([]);setCursor(null);setLoaded(false);setBusy(false);setError(undefined);setNotice(undefined);return()=>{++epoch.current;};},[client]);
 async function load(more=false){
  if(!client||active.current||more&&!cursor)return;const generation=epoch.current;active.current=true;setBusy(true);setError(undefined);
  try{const page=await client.request<OriginalResourcePage>('document.list',more?{cursor}:{});
   if(!Array.isArray(page?.resources)||page.resources.length>20||page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!/^[a-f0-9]{64}$/.test(page.nextCursor)||more&&page.nextCursor===cursor))throw Error('原文件列表尚未确认。');
   const incoming=page.resources.map(resource);if(generation!==epoch.current)return;
   setRows(previous=>[...new Map([...(more?previous:[]),...incoming].map(row=>[row.resourceId,row])).values()].slice(0,200));setCursor(page.nextCursor);setLoaded(true);
  }catch(reason){if(generation===epoch.current)setError(reason instanceof Error?reason.message:'原文件列表暂不可用。');}
  finally{if(generation===epoch.current){active.current=false;setBusy(false);}}
 }
 async function select(){
  if(!client||active.current)return;const generation=epoch.current;active.current=true;setBusy(true);setError(undefined);setNotice(undefined);
  try{const selected=resource(await client.request<OriginalResource>('document.select',{},180000));if(generation!==epoch.current)return;
   setRows(previous=>[selected,...previous.filter(row=>row.resourceId!==selected.resourceId)].slice(0,200));setLoaded(true);setNotice('已选择原文件。可以在会话中说明要处理的文件名和内容。');
  }catch(reason){if(generation===epoch.current)setError(reason instanceof Error?reason.message:'原文件选择未确认，请刷新当前授权。');}
  finally{if(generation===epoch.current){active.current=false;setBusy(false);}}
 }
 return <details className="original-documents" onToggle={event=>{if(event.currentTarget.open&&!loaded)void load();}}>
  <summary>原文件{rows.length?` · ${rows.length} 项已显示`:''}</summary>
  <div className="original-document-body"><p>选择要处理的真实文件。后续修改会写回原件；文件内容在会话工具读取时才进入模型。</p>
   <div className="original-document-actions"><button type="button" data-testid="select-original-document" disabled={!client||busy} onClick={()=>void select()}>选择原文件</button><button type="button" disabled={!client||busy} onClick={()=>void load()}>刷新授权</button></div>
   {busy&&<p role="status">正在核验原件，或等待系统文件选择…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {loaded&&!rows.length&&!busy&&<p>尚未选择原文件。</p>}
   {rows.map(row=><article key={row.resourceId} data-testid="original-document"><strong>{row.displayName}</strong><span className="original-document-badge">原件</span><p>{access(row)}</p><code title="提供者中的真实位置">{row.uri}</code><small>{row.mimeType}{typeof row.byteLength==='number'?` · ${row.byteLength} 字节`:''}{row.grant.read&&!row.grant.persistedRead?' · 读取授权未长期保留，重开后可能需重新选择':''}{row.grant.write&&!row.grant.persistedWrite?' · 写入授权未长期保留':''}</small></article>)}
   {cursor&&rows.length<200&&<button type="button" disabled={busy} onClick={()=>void load(true)}>更多已选原件</button>}
   {cursor&&rows.length>=200&&<p>此处最多显示 200 项；记录和原件仍保留。</p>}
  </div>
 </details>;
}
