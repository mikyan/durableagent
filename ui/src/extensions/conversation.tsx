import {lazy,memo,Suspense,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {CONVERSATION_EXTENSION,type ConversationPhase} from '../../../runtime/src/application-protocol';
import type {ConversationController,UiState} from '../controller';
import {MODELS_EXTENSION} from '../../../runtime/src/model-protocol';
import {builtInUiExtensions} from '../extensions';

const ModelSettings=lazy(builtInUiExtensions[MODELS_EXTENSION.id].load);

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
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const scroll=useRef<HTMLDivElement>(null),follow=useRef(true),input=useRef<HTMLTextAreaElement>(null);
  const active=state.conversation?.conversation??state.conversations.find(item=>item.id===state.activeId);
  const draft=state.activeId?drafts[state.activeId]??'':'';
  const ready=state.status.phase==='ready'&&state.status.extensions.includes(CONVERSATION_EXTENSION.id);
  const phase=state.conversation?.phase??active?.phase??'idle';
  const running=phase==='running'||phase==='waiting';
  const modelsPage=state.page==='models';
  const hasModels=state.status.extensions.includes(MODELS_EXTENSION.id);
  const startupReason=state.status.reason??(state.status.phase==='opening'?'正在连接运行宿主…':state.status.phase==='configuring'?'正在装载配置，请稍候。':state.status.phase==='closed'?'运行宿主已关闭，请重新连接。':state.status.phase==='failed'?'连接未完成，请重新连接。':!ready?'当前运行宿主未提供会话功能。':undefined);
  const reason=state.error??startupReason;
  useEffect(()=>{follow.current=true;setDetails(false);},[state.activeId]);
  useEffect(()=>{
    const element=scroll.current;
    if(element&&follow.current)element.scrollTop=element.scrollHeight;
  },[state.activeId,state.history,state.conversation?.progress?.text]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDetails(false);setNavigation(false);}};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[]);
  const open=(id:string)=>{setNavigation(false);void controller.open(id);};
  const create=()=>{setNavigation(false);void controller.create();};
  const home=()=>{setNavigation(false);controller.home();};
  const reconnect=()=>{setDetails(false);void controller.connect();};
  const models=()=>{setNavigation(false);setDetails(false);void controller.openModels();};
  async function send(event:FormEvent) {
    event.preventDefault();const id=state.activeId,text=draft;
    if(!id)return;
    if(await controller.send(text))setDrafts(current=>current[id]===text?{...current,[id]:''}:current);
  }
  async function older(){
    const element=scroll.current,before=element?.scrollHeight??0;
    follow.current=false;await controller.loadOlder();
    requestAnimationFrame(()=>{if(element)element.scrollTop+=element.scrollHeight-before;});
  }
  const setDraft=(value:string)=>{if(state.activeId)setDrafts(current=>({...current,[state.activeId!]:value}));};
  return <div className="application" data-testid="application" data-status={state.status.phase}>
    {navigation&&<button className="nav-scrim" aria-label="关闭会话列表" onClick={()=>setNavigation(false)}/>}
    <aside className={`navigation ${navigation?'is-open':''}`} aria-label="会话导航">
      <button className="brand" onClick={home} aria-label="返回首页"><span className="brand-mark">π</span><span>Durable Agent<small>你的本地会话空间</small></span></button>
      <button className={`nav-item ${!state.activeId&&!modelsPage?'selected':''}`} onClick={home}><Icon name="home"/>首页</button>
      <button className="nav-item" onClick={create} disabled={!ready||state.pending}><Icon name="plus"/>新建</button>
      {hasModels&&<button className={`nav-item ${modelsPage?'selected':''}`} data-testid="open-model-settings" onClick={models}><Icon name="grid"/>模型与连接</button>}
      <div className="section-caption">会话</div>
      <div className="conversation-list">
        {state.conversations.map(conversation=><button className={`nav-item ${state.activeId===conversation.id?'selected':''}`} key={conversation.id} onClick={()=>open(conversation.id)} disabled={!ready}><Icon name="chat"/><span>{conversation.title}</span></button>)}
        {!state.conversations.length&&<p className="nav-empty">还没有会话</p>}
      </div>
      <div className="nav-foot"><span className={`dot ${ready?'ready':''}`}/>{ready?'运行宿主已连接':'等待运行宿主'}</div>
    </aside>
    <main className={`main ${modelsPage?'models-page':state.activeId?'chat-page':'home-page'}`}>
      <header className="topbar">
        <button className="round-button menu-button" aria-label="打开会话列表" aria-expanded={navigation} onClick={()=>setNavigation(!navigation)}><Icon name="menu"/></button>
        {modelsPage?<><div className="title-pill"><h1>模型与连接</h1></div><button className="round-button" aria-label="返回会话" onClick={()=>controller.leaveModels()}><Icon name="close"/></button></>:state.activeId?<><div className="title-pill"><span className={`dot phase-${phase}`}/><h1>{active?.title??'正在打开会话'}</h1></div><button className="round-button" data-testid="create-conversation" aria-label="新建会话" disabled={!ready||state.pending} onClick={create}><Icon name="plus"/></button></>:<span className="topbar-label">本地 · 会话</span>}
      </header>
      {reason&&<div className="connection-notice" role={state.error?'alert':'status'}><span>{reason}</span><button onClick={reconnect}>重新连接</button></div>}
      {modelsPage?<Suspense fallback={<p className="empty-state">正在打开模型设置…</p>}><ModelSettings controller={controller} state={state}/></Suspense>:!state.activeId?<div className="home-content">
        <div className="home-brand">π</div><p className="eyebrow">DURABLE AGENT</p><h1>从一个问题开始</h1><p className="home-description">独立的会话，同一个工作空间。</p>
        <button className="primary-button" data-testid="create-conversation" onClick={create} disabled={!ready||state.pending}><Icon name="plus"/>{state.pending?'正在创建…':'新建会话'}</button>
        {hasModels&&state.models&&!state.models.defaultModel&&<p className="setup-model-hint">尚未选择默认模型。<button className="text-button" onClick={models}>设置模型与连接</button></p>}
        <section className="recent"><div className="section-caption">最近会话 <span>{state.conversations.length}</span></div>
          {state.conversations.length?state.conversations.map(conversation=><button className="recent-row" data-testid="conversation-item" data-conversation-id={conversation.id} key={conversation.id} onClick={()=>open(conversation.id)} disabled={!ready}><span className="recent-icon"><Icon name="chat"/></span><span className="recent-copy"><strong>{conversation.title}</strong><small>{conversation.model.name} · {phases[conversation.phase]}</small></span><span className="chevron" aria-hidden="true">›</span></button>):<p className="empty-state">新建会话后，已保存的记录会出现在这里。</p>}
        </section>
      </div>:<>
        <div className="thread-scroll" ref={scroll} onScroll={()=>{const element=scroll.current;if(element)follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}}>
          <div className="thread" aria-label="会话消息">
            {state.next&&<button className="history-button" onClick={()=>void older()} disabled={state.loading}>{state.loading?'正在读取…':'查看更早的消息'}</button>}
            {state.loading&&!state.conversation&&<p className="empty-state" role="status">正在读取已保存的会话…</p>}
            {!state.loading&&!state.history.length&&!state.conversation?.progress&&<div className="chat-empty"><span>π</span><h2>有什么想一起解决？</h2><p>发送第一条消息，开始这次会话。</p></div>}
            {state.history.map(message=><article key={message.id} className={`message role-${message.role}`} data-testid="history-message" data-message-id={message.id}>
              <div className="message-label">{message.role==='user'?'你':message.role==='assistant'?<><span>π</span> Agent</>:message.role==='tool'?'工具':'系统'}<span className="saved-label">已保存</span></div>
              <PersistedMessageText text={message.text}/>
            </article>)}
            {state.conversation?.progress&&<article className="message role-assistant progress-message" aria-label="未保存的回复进度"><div className="message-label"><span>π</span> Agent<span className="progress-label">生成中 · 尚未保存</span></div><div className="message-text">{state.conversation.progress.text}<span className="stream-cursor" aria-hidden="true"/></div></article>}
            <div className={`turn-status phase-${phase}`} data-testid="conversation-status" data-phase={phase} role="status">{state.conversation?.reason??(phase==='done'?'回复已保存':phase==='running'&&!state.conversation?.progress?'正在等待回复…':phases[phase])}</div>
          </div>
        </div>
        <div className="composer-area">
          {details&&<section className="details-panel" role="dialog" aria-label="会话详情"><div className="panel-heading"><h2>会话详情</h2><button className="plain-icon" aria-label="关闭详情" onClick={()=>setDetails(false)}><Icon name="close"/></button></div><dl><div><dt>模型</dt><dd>{active?.model.name??'正在读取'}</dd></div><div><dt>工作区</dt><dd>{active?.workspaceId==='default'?'默认工作区':active?.workspaceId??'正在读取'}</dd></div><div><dt>状态</dt><dd>{phases[phase]}</dd></div><div><dt>历史</dt><dd>标记为“已保存”的消息已提交到存储。</dd></div></dl><button className="secondary-button" onClick={reconnect}>重新连接</button></section>}
          <form className="composer" onSubmit={event=>void send(event)}>
            <button type="button" className="plain-icon detail-button" aria-label="会话详情" aria-expanded={details} onClick={()=>setDetails(!details)}><Icon name="grid"/></button>
            <textarea ref={input} data-testid="message-input" aria-label="消息" value={draft} placeholder="发送消息…" rows={1} onChange={event=>setDraft(event.target.value)} disabled={!ready||!state.conversation} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!running)void send(event);}}}/>
            {running?<button type="button" className="send-button" data-testid="stop-generation" aria-label="停止生成" onClick={()=>void controller.stop()} disabled={!ready||state.pending}><Icon name="stop"/></button>:<button type="submit" className="send-button" data-testid="send-message" aria-label="发送消息" disabled={!ready||!state.conversation||state.pending||!draft.trim()}><Icon name="send"/></button>}
          </form>
          <div className="context-pill"><span>{active?.model.name??'正在读取模型'}</span><i/><span className={`phase-${phase}`}>{phases[phase]}</span><i/><span>{active?.workspaceId==='default'?'默认工作区':active?.workspaceId??'工作区'}</span></div>
        </div>
      </>}
    </main>
  </div>;
}
