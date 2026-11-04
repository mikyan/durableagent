import type {ConversationController,UiState} from '../controller';
import type {ExecutionRow,ExecutionState} from '../execution';
import '../execution.css';

const labels:Record<ExecutionState,string>={accepted_not_started:'已接纳，尚未开始',starting:'正在开始',running:'正在执行',stop_requested:'取消已请求，等待停止确认',stopped:'已停止',not_started:'未开始',completed:'已结束',unknown:'结果未知，停止未确认'};
function label(row:ExecutionRow){return row.source==='application'?'未收到执行端确认':labels[row.state];}
export function ExecutionPanel({controller,state}:{controller:ConversationController;state:UiState}){
  const execution=state.execution??controller.execution.view();
  const rows=execution.conversationId===state.activeId?execution.rows:[];
  return <details className="execution-panel" open>
    <summary>本地执行 <span>{execution.connecting?'连接中…':execution.connected?'已连接':'按需连接'}</span></summary>
    <div className="execution-content">
      <p>首次使用：复制初始化命令，在 Termux 中粘贴并运行，再回来连接执行环境。</p>
      <div className="execution-actions">
        <button type="button" onClick={()=>void controller.execution.copySetup()} disabled={execution.copying}>复制初始化命令</button>
        <button type="button" onClick={()=>void controller.execution.connect()} disabled={execution.connecting}>{execution.connecting?'正在连接…':'连接执行环境'}</button>
        {state.activeId&&<button type="button" onClick={()=>void controller.execution.refresh(state.activeId!)} disabled={execution.loading||state.status.phase!=='ready'}>{execution.loading?'正在读取…':'查看本会话执行'}</button>}
      </div>
      {execution.notice&&<p className="execution-notice" role="status">{execution.notice}</p>}
      {execution.error&&<p className="execution-error" role="alert">{execution.error}</p>}
      {rows.length>0&&<ul className="execution-list" aria-label="本会话执行">
        {rows.map(row=><li key={row.executionId} data-testid="execution-row" data-state={row.state}>
          <div className="execution-row-title"><strong>{label(row)}</strong>{typeof row.exitCode==='number'&&<span>退出码 {row.exitCode}</span>}{row.captureIncomplete&&<span className="execution-warning">输出不完整</span>}</div>
          <code>{row.executionId}</code>
          <div className="execution-actions">
            <button type="button" disabled={execution.pending.includes(row.executionId)} onClick={()=>void controller.execution.query(row.executionId)}>核验状态</button>
            {!['completed','stopped','not_started'].includes(row.state)&&<button type="button" disabled={execution.pending.includes(row.executionId)} onClick={()=>void controller.execution.cancel(row.executionId)}>取消本次执行</button>}
          </div>
        </li>)}
      </ul>}
      {execution.nextCursor&&!execution.limited&&<button type="button" className="execution-more" disabled={execution.loading} onClick={()=>void controller.execution.loadMore()}>查看更多执行</button>}
      {execution.limited&&<p>已显示 1000 条执行，更多记录未在此页载入。</p>}
    </div>
  </details>;
}
