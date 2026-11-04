import {Component,lazy,Suspense,useEffect,useState,useMemo,useCallback,type ReactNode,type ComponentType} from 'react';
import type {ExtensionCatalog} from '../../runtime/src/extension-protocol';
import {builtInUiExtensions} from './extensions';
import type {TimelineClient} from './extensions/timeline';
import './extensions.css';
export class ExtensionBoundary extends Component<{id:string;children:ReactNode;onFailure?:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){this.props.onFailure?.();}
 render(){return this.state.failed?<p role="alert">扩展 {this.props.id} 的界面未能挂载。会话仍由运行宿主管理；请关闭页面后重试。</p>:this.props.children;}
}
function MountSignal({onMount,children}:{onMount:()=>void;children:ReactNode}){useEffect(onMount,[onMount]);return children;}
export function ExtensionPage({client,conversationId,timelineLoader=builtInUiExtensions.timeline.load}:{client?:TimelineClient;conversationId?:string;timelineLoader?:()=>Promise<{default:ComponentType<any>}>}){
 const [catalog,setCatalog]=useState<ExtensionCatalog>(),[error,setError]=useState<string>(),[timeline,setTimeline]=useState(false);
 const [mount,setMount]=useState<'loading'|'mounted'|'failed'>('loading');const Timeline=useMemo(()=>lazy(timelineLoader),[timelineLoader]);
 const mounted=useCallback(()=>{setMount('mounted');},[]),failed=useCallback(()=>{setMount('failed');},[]);
 useEffect(()=>{let active=true;setCatalog(undefined);setError(undefined);setTimeline(false);if(client)void client.request<ExtensionCatalog>('extensions.get',conversationId?{id:conversationId}:{}).then(value=>{if(active)setCatalog(value);},reason=>{if(active)setError(reason.message??'扩展状态暂不可用');});else setError('运行宿主连接已断开');return()=>{active=false;};},[client,conversationId]);
 return <div className="extension-page" data-testid="extension-page"><p>随包界面与 Agent 贡献分别加载。打开或关闭页面不会启停 Agent。</p>
  {conversationId&&<p>当前会话 ID：<code data-testid="extension-conversation-id">{conversationId}</code></p>}
  {error&&<p role="alert">{error}</p>}
  <div className="extension-catalog">{catalog?.items.map(item=><section key={item.descriptor.id} data-extension-id={item.descriptor.id}>
   <h2>{item.descriptor.title}</h2><p>已打包 · {item.descriptor.id}</p>
   <p>{item.agent.state==='not-provided'?'无需 Agent 贡献':item.agent.state==='unavailable'?'Agent 贡献不可用':`SDK 已安装：${item.agent.name}`}</p>
   {item.agent.state==='installed'&&<p>{item.agent.selected===undefined?'选择会话后可查看会话选择':item.agent.selected?'当前会话已选择':'当前会话未选择'}</p>}
   <p>{item.ui.state==='not-provided'?'无界面贡献':item.descriptor.id==='timeline'&&timeline?mount==='mounted'?'本页已挂载':mount==='failed'?'界面挂载失败':'界面正在加载':'界面已打包，本页未挂载'}</p>
   {item.descriptor.id==='timeline'&&item.ui.state==='packaged'&&<button data-testid="toggle-timeline" disabled={!conversationId||!client} onClick={()=>{setMount('loading');setTimeline(value=>!value);}}>{timeline?'关闭时间线':'打开时间线'}</button>}
  </section>)}</div>
  {timeline&&conversationId&&client&&<ExtensionBoundary key={conversationId} id="timeline" onFailure={failed}><Suspense fallback={<p role="status">正在挂载时间线…</p>}><MountSignal onMount={mounted}><Timeline client={client} conversationId={conversationId}/></MountSignal></Suspense></ExtensionBoundary>}
 </div>;
}
