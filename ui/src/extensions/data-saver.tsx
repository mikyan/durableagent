import type {DataSaverCoordinator,DataSaverView} from '../data-saver';
import type {ExecutionPolicy} from '../../../runtime/src/data-saver-protocol';
import '../execution.css';
const reasons={disabled:'已关闭',unrestricted:'当前网络不受限',metered:'当前网络按流量计费','network-unknown':'当前网络条件未知，保守等待','network-blocked':'Android 当前限制网络访问'};
function label(row:ExecutionPolicy){return row.phase==='waiting'?'省流等待':row.phase==='granted'?'临时放行中':row.phase==='result-unverified'?(row.reason==='user-stopped'?'用户停止后结果待核验':'网络变化后结果待核验'):row.phase==='terminal'?(row.state==='stopped'&&row.scopeConfirmed&&row.cancelReason==='network_policy'?'因网络变化已停止':'执行已结束'):'当前条件允许执行';}
export function DataSaverPanel({policy,view}:{policy:DataSaverCoordinator;view:DataSaverView}){
 const settings=view.settings;
 return <details className="execution-panel data-saver-panel" open>
  <summary>省流 <span>{view.error?'状态待核验':settings?reasons[settings.reason]:'正在读取网络条件'}</span></summary>
  <div className="execution-content">
   <label><input type="checkbox" aria-label="省流模式" checked={settings?.enabled??false} disabled={!settings||view.pending||!!view.error} onChange={event=>void policy.configure(event.target.checked)}/>省流模式</label>
   <p>受限网络上保留模型通信与已核验的本地能力。其他联网或未知行为等待条件恢复，或仅放行所选执行。</p>
   <button type="button" disabled={view.loading} onClick={()=>void policy.refresh(view.conversationId)}>刷新省流状态</button>
   {view.error&&<p role="alert">{view.error} 当前网络与许可尚未确认，不能把旧状态当作放行依据。</p>}
   {view.notice&&<p role="status">{view.notice}</p>}
   {!!view.operations.length&&<ul className="execution-list" aria-label="本会话省流操作">
    {view.operations.map(row=><li key={row.executionId} data-testid="data-saver-operation" data-phase={row.phase}>
     <strong>{label(row)}</strong><p>{row.summary}</p><code>{row.executionId}</code>
     {row.phase==='waiting'&&<><p>仅这一次固定执行；重连沿用，停止或本次受限网络期间结束后失效。不会关闭全局省流。</p><button type="button" disabled={view.pending||!!view.error||!row.finalDigest} onClick={()=>void policy.grant(row.executionId)}>仅放行这一次执行</button></>}
     {(row.phase==='result-unverified'||row.policyInterrupted)&&<p>原操作不会因网络恢复而重跑。可用会话停止结束等待，再发送新的要求；未确认的外部结果仍保留核验。</p>}
    </li>)}
   </ul>}
   {view.nextCursor&&<button type="button" disabled={view.loading} onClick={()=>void policy.refresh(view.conversationId,view.nextCursor)}>查看更多省流操作</button>}
  </div>
 </details>;
}
