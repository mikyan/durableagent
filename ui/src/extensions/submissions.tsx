import type {ConversationController,UiState} from '../controller';
import type {SendView} from '../submissions';

function presentation(item:SendView,stoppedThrough:number,abortPending:boolean){
  const accepted=item.status?.accepted||!!item.intent?.receipt;
  if(item.durable==='saving')return {stage:'saving',label:'正在保存此次发送',detail:'尚未确认原生发送意图提交。'};
  if(item.durable==='failed')return {stage:'failed',label:'发送尚未保存',detail:'未凭此结果向 SDK 投递。请保留草稿并检查错误。'};
  if(item.durable==='unknown')return {stage:'unknown',label:'发送保存未确认',detail:'请核验同一次发送；不要把它当作未发送而重复创建。'};
  const progress=item.status?.submission;
  if(progress?.status==='done'||progress?.status==='unanswered')return {stage:'settled',label:progress.status==='done'?'输入已结算':'输入已结算 · 未获回答',detail:progress.reason?(({aborted:'会话已停止',reset:'上下文已重置',turn_limit:'达到本轮限制',no_model:'模型未配置',model_error:'模型请求失败',faulted:'执行异常',restart_limit:'达到恢复次数限制',interrupted:'执行中断',nothing_to_answer:'没有待回答内容'} as Record<string,string>)[progress.reason]??'未获回答')+'（'+progress.reason+'）':'不代表整个会话或外部操作全部结束。'};
  if(item.intent?.cancelled||item.intent&&item.intent.controlGeneration<=stoppedThrough){
    const interrupted=!!item.intent&&item.intent.controlGeneration<=stoppedThrough&&!abortPending;
    if(accepted&&!interrupted)return {stage:'stop-pending',label:'已接纳 · 已请求停止',detail:'停止请求已保存，等待会话中断核验。这次发送不会重新投递。'};
    return {stage:'stopped',label:accepted?'已接纳 · 会话中断已确认':'已停止投递',detail:'这次发送不会因界面恢复重新投递。继续工作需要明确的新发送。'};
  }
  if(!accepted&&item.intent?.sourceCancelled)return {stage:'stopped',label:'已停止投递',detail:'来源操作已停止；尚未接纳的转交不会因恢复重新投递。'};
  if(progress?.status==='placed')return {stage:'placed',label:'已放入消息记录',detail:'此状态不单独证明模型已经采用该输入。'};
  if(progress?.status==='queued')return {stage:'queued',label:'已接纳 · 排队中',detail:'排队不表示模型已读取；等待会话安排。'};
  if(accepted)return {stage:'accepted',label:'已接纳',detail:'接纳已确认，输入后续状态等待核验。'};
  if(item.intent?.delivery==='uncertain'||item.error||item.busy)return {stage:'unknown',label:'接纳未确认',detail:'只核验并重试这一次发送，固定内容保持不变。'};
  return {stage:'pending',label:'待投递',detail:item.status?.waiting?.message??'此次发送已保存在本机，等待接纳条件具备。'};
}

export function SubmissionStatus({item,controller,state}:{item:SendView;controller:ConversationController;state:UiState}){
  const sends=state.submissions;
  const view=presentation(item,sends?.control?.stoppedThrough??0,!!sends?.control?.pendingAbort),accepted=item.status?.accepted||!!item.intent?.receipt;
  const retry=accepted?item.intent?.delivery!=='acknowledged':view.stage!=='stopped';
  return <div className="message-delivery" data-testid="submission-item" data-intent-id={item.intentId} data-stage={view.stage}>
    <details><summary><span className="delivery-dot" aria-hidden="true"/>{view.label}</summary><div className="disclosure-content"><p>{view.detail}</p><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div></details>
    {item.status?.waiting&&<p>{item.status.waiting.message}</p>}{item.error&&<p className="send-error" role="status">{item.error}</p>}
    {retry&&<button type="button" className="text-button" data-testid="retry-submission" disabled={item.busy||sends?.stopping} onClick={()=>void controller.retrySubmission(item.intentId)}>{accepted?'补齐本机发送确认':'核验并重试此次发送'}</button>}
  </div>;
}

export function SubmissionMessages({controller,state}:{controller:ConversationController;state:UiState}){
  const sends=state.submissions;if(!sends)return null;
  // Associate by the SDK's entry identity, never by matching user text.
  const unmatched=sends.items.filter(item=>!(state.history??[]).some(message=>message.id===item.status?.submission?.entryId)).slice().reverse();
  return <>{unmatched.map(item=><article className="message role-user submission-message" key={item.intentId}>
    <div className="message-label">你<span className="saved-label">{item.status?.submission?.entryId?'对应消息尚未载入':'此次发送'}</span></div>
    <p className="message-text">{item.preview.text||'附件输入'}{item.preview.attachmentCount>0?` · ${item.preview.attachmentCount} 个附件`:''}</p>
    <SubmissionStatus item={item} controller={controller} state={state}/>
  </article>)}</>;
}

export function SubmissionControlStatus({controller,state}:{controller:ConversationController;state:UiState}){
  const sends=state.submissions;if(!sends)return null;
  const stoppedThrough=sends.control?.stoppedThrough??0;
  const status=sends.stopStatus?.control.version===sends.control?.version?sends.stopStatus:undefined;
  const showStop=sends.stopping||sends.stopError||sends.control?.pendingAbort||status&&status.externalPending>0||sends.control&&sends.control.generation<=stoppedThrough;
  const stopLabel=sends.stopping?'正在保存停止请求…':sends.control&&stoppedThrough>0?(sends.control.pendingAbort?'停止请求已保存 · 等待会话中断核验':status?.phase==='external-unconfirmed'?'停止已请求，外部结果待核验':status?.phase==='stopped'?'停止完成 · 相关受管操作已核验':'停止请求已保存 · 会话中断已确认'):'停止请求未确认';
  return <>
    {(showStop||sends.error)&&<article className="message role-system activity-message" role="status">
      {showStop&&<p data-testid="stop-status">{stopLabel}{sends.stopError&&<span className="send-error">{sends.stopError}</span>}</p>}
      {sends.error&&<p className="send-error">{sends.error}</p>}
    </article>}
    {(sends.items.length>0||sends.error||showStop)&&<div className="message-status-actions"><button className="text-button" data-testid="refresh-submissions" onClick={()=>void controller.refreshSubmissions()} disabled={sends.loading}>核验发送状态</button>{sends.next&&<button className="text-button" onClick={()=>void controller.refreshSubmissions(sends.next)} disabled={sends.loading}>更早的发送记录</button>}</div>}
  </>;
}

export function SendStates({controller,state}:{controller:ConversationController;state:UiState}){
  return <><SubmissionMessages controller={controller} state={state}/><SubmissionControlStatus controller={controller} state={state}/></>;
}
