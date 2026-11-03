import type {InputSelection} from '../../../runtime/src/input-protocol';
import type {ConversationController,UiState} from '../controller';

const preparation:Record<InputSelection['preparation']['state'],string>={selected:'尚未准备',preparing:'正在本地准备',ready:'本地材料已准备','source-unavailable':'无法读取原件',unsupported:'不支持此格式','budget-exceeded':'超过输入预算',failed:'准备失败'};
const source={available:'原件可访问',unavailable:'原件不可用',unknown:'原件访问待核验'};
export const bytes=(value:number)=>value>=1024*1024?`${(value/1024/1024).toFixed(1)} MB`:value>=1024?`${(value/1024).toFixed(1)} KB`:`${value} B`;
export function DraftAttachments({controller,state}:{controller:ConversationController;state:UiState}){
  const draft=state.draft;if(!draft?.selections.length)return null;
  return <section className="draft-attachments" aria-label="附件草稿"><p className="attachment-disclosure">准备只在本地进行；点击发送后，采用的内容才会交给模型。</p><div className="attachment-list">{draft.selections.map(item=><article className="attachment-card" key={item.id} data-testid="draft-attachment" data-selection-id={item.id}>
    <div className="attachment-title"><strong>{item.source.name}</strong><button type="button" className="text-button" aria-label={`移除 ${item.source.name}`} disabled={draft.busy} onClick={()=>controller.removeAttachment(item.id)}>移除</button></div>
    <div className="attachment-meta">{item.source.mimeType}{item.source.byteLength!==undefined?` · ${bytes(item.source.byteLength)}`:''}</div>
    <div className="attachment-states"><span><span data-testid="attachment-source" data-state={item.source.access}>{source[item.source.access]}</span><small>（最近核验）</small></span><span data-testid="attachment-preparation" data-state={item.preparation.state}>{preparation[item.preparation.state]}</span></div>
    {draft.preparingIds.includes(item.id)&&item.preparation.state==='selected'&&<p role="status" data-testid="attachment-request">正在请求本地准备…</p>}
    {draft.preparationErrors[item.id]&&<p role="status">{draft.preparationErrors[item.id]}</p>}
    {draft.observingIds.includes(item.id)&&<div className="attachment-meta">正在检查本地准备状态；此检查不重新读取原件。</div>}
    {item.preparation.reason&&<p role="status">{item.preparation.reason}</p>}
    {item.preparation.representation?<div className="attachment-meta">采用范围：完整内容 · {bytes(item.preparation.representation.byteLength)}{item.preparation.representation.width?` · ${item.preparation.representation.width} × ${item.preparation.representation.height}`:''}{item.preparation.representation.transformation?` · ${item.preparation.representation.transformation}`:''}</div>:<div className="attachment-meta">尚无可发送正文；来源引用不等于模型已收到内容。</div>}
    {item.preparation.state!=='ready'&&item.preparation.state!=='preparing'&&<button type="button" className="text-button" disabled={draft.busy||draft.preparingIds.includes(item.id)} onClick={()=>void controller.prepareAttachment(item.id)}>本地准备</button>}
  </article>)}</div><button type="button" className="text-button" onClick={()=>void controller.refreshDraft()}>刷新附件状态</button></section>;
}
