import {lazy,memo,Suspense,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {CONVERSATION_EXTENSION,type ConversationPhase} from '../../../runtime/src/application-protocol';
import type {ConversationController,UiState} from '../controller';
import {MODELS_EXTENSION} from '../../../runtime/src/model-protocol';
import {PROJECTS_EXTENSION} from '../../../runtime/src/project-protocol';
import {builtInUiExtensions} from '../extensions';
import {INPUT_BUDGETS} from '../../../runtime/src/input-protocol';
import {DraftAttachments,bytes} from './attachments';
import {SendStates} from './submissions';
import {ExtensionPage} from '../extension-host';
import {positionLabels} from '../project-view';
import {ExecutionPanel} from './execution';

const ModelSettings=lazy(builtInUiExtensions[MODELS_EXTENSION.id].load);
const ProjectSettings=lazy(builtInUiExtensions[PROJECTS_EXTENSION.id].load);

const phases:Record<ConversationPhase,string>={idle:'准备就绪',running:'正在处理',waiting:'等待中',failed:'处理失败',done:'已完成',stopped:'已停止'};
const PersistedMessageText=memo(function PersistedMessageText({text}:{text:string}) {
  const [expanded,setExpanded]=useState(false);
  const textId=useId();
  const long=text.length>4000;
  // The bounded preview never mounts the full source in a hidden DOM node.
  let prefix=long?text.slice(0,1000):text;
  if(long&&/[\uD800-\uDBFF]$/.test(prefix))prefix=prefix.slice(0,-1);
  const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
  const markedControls=long&&!expanded&&controls.test(prefix);
  const preview=long?prefix.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,character=>{
    const code=character.charCodeAt(0);return code<32?String.fromCharCode(0x2400+code):code===127?'␡':'�';
  }):text;
  return <>
    <div id={textId} className={`message-text ${long&&expanded?'expanded-long':''}`} data-testid="message-text">{long&&!expanded?preview:text}</div>
    {long&&<div className="long-message-control"><span>{expanded?'完整消息':'长消息已折叠，仅显示开头。'}{markedControls?' 控制字符以符号标示。':''}</span><button type="button" data-testid="toggle-long-message" aria-expanded={expanded} aria-controls={textId} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起长消息':'展开完整消息'}</button></div>}
  </>;
});
function Icon({name}:{name:'menu'|'plus'|'grid'|'send'|'close'|'home'|'chat'|'stop'}) {
  const paths={menu:<><path d="M5 7h14M5 12h14M5 17h14"/></>,plus:<path d="M12 5v14M5 12h14"/>,grid:<><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,send:<path d="M12 19V5m-6 6 6-6 6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,home:<><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/></>,chat:<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/>,stop:<rect className="stop-icon" x="7" y="7" width="10" height="10" rx="2"/>};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function ConversationPage({controller,state}:{controller:ConversationController;state:UiState}) {
  const [navigation,setNavigation]=useState(false);
  const [details,setDetails]=useState(false);
  const [attachments,setAttachments]=useState(false);
  const scroll=useRef<HTMLDivElement>(null),follow=useRef(true),input=useRef<HTMLTextAreaElement>(null);
  const conversations=[...state.conversations,...state.inputConversations.filter(item=>!state.conversations.some(existing=>existing.id===item.id)).map(item=>({...item,phase:undefined,workspaceId:undefined}))];
  const active=state.conversation?.conversation??conversations.find(item=>item.id===state.activeId);
  const draft=state.draft?.text??'';
  const draftReady=!!state.draft;
  const ready=state.status.phase==='ready'&&state.status.extensions.includes(CONVERSATION_EXTENSION.id);
  const phase=state.conversation?.phase??active?.phase??'idle';
  const location=state.projects?.selection&&state.projects.selection.id===state.activeId?state.projects.selection:undefined;
  const workspaceRecord=state.projects?.workspaces.find(item=>item.id===(location?.workspaceId??active?.workspaceId));
  const project=state.projects?.projects.find(item=>item.id===location?.projectId);
  const workspace=workspaceRecord?.name??(active?.workspaceId?(active.workspaceId==='default'?'默认工作区':active.workspaceId):'工作区待读取');
  const running=phase==='running'||phase==='waiting';
  const stoppable=running||state.pending||state.submissions?.items.some(item=>!item.intent?.cancelled&&item.status?.submission?.status!=='done'&&item.status?.submission?.status!=='unanswered')||!!state.submissions?.control?.pendingAbort;
  const sendContext=state.draft?.submissionContext??active?.submissionContext;
  const modelsPage=state.page==='models';
  const projectsPage=state.page==='projects',extensionsPage=state.page==='extensions',settingsPage=modelsPage||projectsPage||extensionsPage;
  const hasModels=state.status.extensions.includes(MODELS_EXTENSION.id);
  const hasProjects=state.status.extensions.includes(PROJECTS_EXTENSION.id);
  const startupReason=state.status.reason??(state.status.phase==='opening'?'正在连接运行宿主…':state.status.phase==='configuring'?'正在装载配置，请稍候。':state.status.phase==='closed'?'运行宿主已关闭，请重新连接。':state.status.phase==='failed'?'连接未完成，请重新连接。':!ready?'当前运行宿主未提供会话功能。':undefined);
  const reason=state.error??startupReason;
  useEffect(()=>{follow.current=true;setDetails(false);setAttachments(false);},[state.activeId]);
  useEffect(()=>{
    const element=scroll.current;
    if(element&&follow.current)element.scrollTop=element.scrollHeight;
  },[state.activeId,state.history,state.conversation?.progress?.text]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDetails(false);setNavigation(false);setAttachments(false);}};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[]);
  const open=(id:string)=>{setNavigation(false);void controller.open(id);};
  const create=()=>{setNavigation(false);void controller.create();};
  const home=()=>{setNavigation(false);void controller.home();};
  const reconnect=()=>{setDetails(false);void controller.connect();};
  const models=()=>{setNavigation(false);setDetails(false);void controller.openModels();};
  const projects=()=>{setNavigation(false);setDetails(false);void controller.openProjects();};
  async function send(event:FormEvent) {
    event.preventDefault();if(state.activeId)await controller.send();
  }
  async function older(){
    const element=scroll.current,before=element?.scrollHeight??0;
    follow.current=false;await controller.loadOlder();
    requestAnimationFrame(()=>{if(element)element.scrollTop+=element.scrollHeight-before;});
  }
  const choose=(kind:'image'|'file')=>{setAttachments(false);void controller.selectAttachment(kind);};
  return <div className="application" data-testid="application" data-status={state.status.phase}>
    {navigation&&<button className="nav-scrim" aria-label="关闭会话列表" onClick={()=>setNavigation(false)}/>}
    <aside className={`navigation ${navigation?'is-open':''}`} aria-label="会话导航">
      <button className="brand" onClick={home} aria-label="返回首页"><span className="brand-mark">π</span><span>Durable Agent<small>你的本地会话空间</small></span></button>
      <button className={`nav-item ${!state.activeId&&!settingsPage?'selected':''}`} onClick={home}><Icon name="home"/>首页</button>
      <button className="nav-item" onClick={create} disabled={!ready||state.pending}><Icon name="plus"/>新建</button>
      {hasModels&&<button className={`nav-item ${modelsPage?'selected':''}`} data-testid="open-model-settings" onClick={models}><Icon name="grid"/>模型与连接</button>}
      {hasProjects&&<button className={`nav-item ${projectsPage?'selected':''}`} data-testid="open-project-settings" onClick={projects}><Icon name="grid"/>项目与工作区</button>}
      <button className={`nav-item ${extensionsPage?'selected':''}`} data-testid="open-extensions" onClick={()=>{setNavigation(false);setDetails(false);controller.openExtensions();}}><Icon name="grid"/>扩展与时间线</button>
      <div className="section-caption">会话</div>
      <div className="conversation-list">
        {conversations.map(conversation=><button className={`nav-item ${state.activeId===conversation.id?'selected':''}`} key={conversation.id} onClick={()=>open(conversation.id)} disabled={!ready&&!state.inputReady}><Icon name="chat"/><span>{conversation.title}</span></button>)}
        {!conversations.length&&<p className="nav-empty">还没有会话</p>}
      </div>
      <div className="nav-foot"><span className={`dot ${ready?'ready':''}`}/>{ready?'运行宿主已连接':'等待运行宿主'}</div>
    </aside>
    <main className={`main ${settingsPage?'models-page':state.activeId?'chat-page':'home-page'}`}>
      <header className="topbar">
        <button className="round-button menu-button" aria-label="打开会话列表" aria-expanded={navigation} onClick={()=>setNavigation(!navigation)}><Icon name="menu"/></button>
        {settingsPage?<><div className="title-pill"><h1>{modelsPage?'模型与连接':projectsPage?'项目与工作区':'扩展与时间线'}</h1></div><button className="round-button" aria-label="返回会话" onClick={()=>modelsPage?controller.leaveModels():projectsPage?controller.leaveProjects():controller.leaveExtensions()}><Icon name="close"/></button></>:state.activeId?<><div className="title-pill"><span className={`dot phase-${phase}`}/><h1>{active?.title??'正在打开会话'}</h1></div><button className="round-button" data-testid="create-conversation" aria-label="新建会话" disabled={!ready||state.pending} onClick={create}><Icon name="plus"/></button></>:<span className="topbar-label">本地 · 会话</span>}
      </header>
      {reason&&<div className="connection-notice" role={state.error?'alert':'status'}><span>{reason}</span><button onClick={reconnect}>重新连接</button></div>}
      {!settingsPage&&<ExecutionPanel controller={controller} state={state}/>}
      {extensionsPage?<ExtensionPage client={controller.extensionClient} conversationId={state.activeId}/>:projectsPage?<Suspense fallback={<p className="empty-state">正在打开项目设置…</p>}><ProjectSettings controller={controller} state={state}/></Suspense>:modelsPage?<Suspense fallback={<p className="empty-state">正在打开模型设置…</p>}><ModelSettings controller={controller} state={state}/></Suspense>:!state.activeId?<div className="home-content">
        <div className="home-brand">π</div><p className="eyebrow">DURABLE AGENT</p><h1>从一个问题开始</h1><p className="home-description">独立的会话，同一个工作空间。</p>
        <button className="primary-button" data-testid="create-conversation" onClick={create} disabled={!ready||state.pending}><Icon name="plus"/>{state.pending?'正在创建…':'新建会话'}</button>
        {hasModels&&state.models&&!state.models.defaultModel&&<p className="setup-model-hint">尚未选择默认模型。<button className="text-button" onClick={models}>设置模型与连接</button></p>}
        <section className="recent"><div className="section-caption">最近会话 <span>{conversations.length}</span></div>
          {conversations.length?conversations.map(conversation=><button className="recent-row" data-testid="conversation-item" data-conversation-id={conversation.id} key={conversation.id} onClick={()=>open(conversation.id)} disabled={!ready&&!state.inputReady}><span className="recent-icon"><Icon name="chat"/></span><span className="recent-copy"><strong>{conversation.title}</strong><small>{conversation.model.name} · {conversation.phase?phases[conversation.phase]:'历史待连接'}</small></span><span className="chevron" aria-hidden="true">›</span></button>):<p className="empty-state">新建会话后，已保存的记录会出现在这里。</p>}
        </section>
      </div>:<>
        <div className="thread-scroll" ref={scroll} onScroll={()=>{const element=scroll.current;if(element)follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}}>
          <div className="thread" aria-label="会话消息">
            {!ready&&<p className="empty-state">草稿可在本地编辑保存。会话历史等待运行宿主连接。</p>}
            {state.next&&<button className="history-button" onClick={()=>void older()} disabled={state.loading}>{state.loading?'正在读取…':'查看更早的消息'}</button>}
            {state.loading&&!state.conversation&&<p className="empty-state" role="status">正在读取已保存的会话…</p>}
            {!state.loading&&state.conversation&&!state.history.length&&!state.conversation.progress&&<div className="chat-empty"><span>π</span><h2>有什么想一起解决？</h2><p>发送第一条消息，开始这次会话。</p></div>}
            {state.history.map(message=><article key={message.id} className={`message role-${message.role}`} data-testid="history-message" data-message-id={message.id}>
              <div className="message-label">{message.role==='user'?'你':message.role==='assistant'?<><span>π</span> Agent</>:message.role==='tool'?'工具':'系统'}<span className="saved-label">已保存</span></div>
              {message.text&&<PersistedMessageText text={message.text}/>}
              {message.attachments?.map((attachment,index)=><div className="history-attachment" data-testid="history-attachment" key={index}><strong>图片附件</strong><span>{attachment.mimeType} · {bytes(attachment.byteLength)}</span><details><summary>内容摘要</summary><code>{attachment.sha256}</code></details></div>)}
            </article>)}
            {state.conversation?.progress&&<article className="message role-assistant progress-message" aria-label="未保存的回复进度"><div className="message-label"><span>π</span> Agent<span className="progress-label">生成中 · 尚未保存</span></div><div className="message-text">{state.conversation.progress.text}<span className="stream-cursor" aria-hidden="true"/></div></article>}
            <div className={`turn-status phase-${phase}`} data-testid="conversation-status" data-phase={phase} role="status">{!state.conversation?'运行状态待连接':state.conversation.reason??(phase==='done'?'回复已保存':phase==='running'&&!state.conversation?.progress?'正在等待回复…':phases[phase])}</div>
          </div>
        </div>
        <div className="composer-area">
          <SendStates controller={controller} state={state}/>
          {details&&<section className="details-panel" role="dialog" aria-label="会话详情"><div className="panel-heading"><h2>会话详情</h2><button className="plain-icon" aria-label="关闭详情" onClick={()=>setDetails(false)}><Icon name="close"/></button></div><dl><div><dt>模型</dt><dd>{active?.model.name??'正在读取'}</dd></div><div><dt>项目</dt><dd data-testid="detail-project">{project?.name??(location?'未关联项目':'项目待读取')}</dd></div><div><dt>工作区</dt><dd>{workspace}{workspaceRecord&&<code className="workspace-path">{workspaceRecord.path}</code>}{location&&<span className="detail-location" data-testid="detail-position" data-state={location.position.state}>{location.position.reason??positionLabels[location.position.state]}</span>}</dd></div><div><dt>状态</dt><dd>{state.conversation?phases[phase]:'运行状态待连接'}</dd></div><div><dt>历史</dt><dd>标记为“已保存”的消息已提交到存储。</dd></div></dl><div className="detail-actions">{hasProjects&&<button className="secondary-button" data-testid="detail-project-settings" onClick={projects}>选择项目与工作区</button>}<button className="secondary-button" onClick={reconnect}>重新连接</button><button className="secondary-button" onClick={()=>void controller.stop()} disabled={!draftReady||state.submissions?.stopping}>停止此会话</button></div></section>}
          <DraftAttachments controller={controller} state={state}/>
          {(state.inputError||state.draft?.error)&&<div className="draft-error" role="alert"><span>{state.draft?.error??state.inputError}</span>{state.draft&&<div className="draft-recovery">{state.draft.status==='conflict'?<button type="button" onClick={()=>void controller.recoverDraft(true)}>保留本地内容并重试</button>:<button type="button" onClick={()=>void controller.retryDraft()}>重试保存</button>}<button type="button" onClick={()=>void controller.recoverDraft(false)}>恢复已保存版本</button></div>}</div>}
          {attachments&&<div className="attachment-menu" role="menu" aria-label="添加附件"><button type="button" role="menuitem" onClick={()=>choose('image')}>选择图片</button><button type="button" role="menuitem" onClick={()=>choose('file')}>选择文件</button><p>仅选择与本地准备，不会自动发送。</p></div>}
          <form className="composer" onSubmit={event=>void send(event)}>
            <button type="button" className="plain-icon detail-button" aria-label="会话详情" aria-expanded={details} onClick={()=>setDetails(!details)}><Icon name="grid"/></button>
            <button type="button" className="plain-icon attachment-button" data-testid="add-attachment" aria-label="添加附件" aria-expanded={attachments} onClick={()=>setAttachments(!attachments)} disabled={!draftReady||state.draft?.busy}><Icon name="plus"/></button>
            <textarea ref={input} data-testid="message-input" aria-label="消息" value={draft} placeholder="发送消息…" rows={1} onChange={event=>controller.editDraft(event.target.value)} disabled={!draftReady} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send(event);}}}/>
            {stoppable&&<button type="button" className="plain-icon stop-button" data-testid="stop-generation" aria-label="停止生成" onClick={()=>void controller.stop()} disabled={!draftReady||state.submissions?.stopping}><Icon name="stop"/></button>}
            <button type="submit" className="send-button" data-testid="send-message" aria-label="发送消息" disabled={!sendContext||state.pending||!draftReady||state.draft?.busy||state.submissions?.stopping||state.draft?.status==='conflict'||state.draft?.status==='failed'||(!draft.trim()&&!state.draft?.selections.length)||state.draft?.selections.some(item=>item.preparation.state!=='ready')}><Icon name="send"/></button>
          </form>
          <div className="draft-status" data-testid="draft-status" data-state={state.draft?.status??'loading'} role="status">{state.draft?(state.draft.status==='saved'?'草稿已保存':state.draft.status==='pending'?'草稿待保存…':state.draft.status==='conflict'?'草稿存在版本冲突':'草稿保存未确认'):'正在读取原生草稿…'}{state.pending?' · 正在确认操作':''}{draft.length>INPUT_BUDGETS.draftCharacters*.8?` · ${draft.length} / ${INPUT_BUDGETS.draftCharacters} 字符`:''}</div>
          <div className="context-pill"><span>{active?.model.name??'正在读取模型'}</span><i/><span className={`phase-${phase}`}>{state.conversation?phases[phase]:'历史待连接'}</span><i/><span data-testid="conversation-location">{project?`${project.name} · `:''}{workspace}</span>{location&&location.position.state!=='available'&&<span className="position-warning">{positionLabels[location.position.state]}</span>}</div>
        </div>
      </>}
    </main>
  </div>;
}
