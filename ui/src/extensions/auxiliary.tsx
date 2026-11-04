import {useEffect,useState} from 'react';
import type {ConversationController,UiState} from '../controller';
import {FileChangesPanel} from './file-changes';
import {ExecutionPanel} from './execution';
import {ExtensionPage} from '../extension-host';

export function useWideLayout(){
 const [wide,setWide]=useState(()=>window.matchMedia?.('(min-width: 900px)').matches??false);
 useEffect(()=>{const query=window.matchMedia?.('(min-width: 900px)');if(!query)return;const changed=()=>setWide(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
 return wide;
}
export function AuxiliaryPanel({controller,state,wide,onClose}:{controller:ConversationController;state:UiState;wide:boolean;onClose:()=>void}){
 const [tab,setTab]=useState<'files'|'execution'|'extensions'>('files');
 return <aside className="auxiliary-panel" role={wide?'complementary':'dialog'} aria-label="会话辅助区域"><div className="panel-heading"><h2>会话辅助区域</h2><button className="secondary-button" aria-label="关闭辅助区域" onClick={onClose}>关闭</button></div>
  <div className="auxiliary-tabs" aria-label="辅助内容">{(['files','execution','extensions'] as const).map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value==='files'?'文件变更':value==='execution'?'执行':'扩展'}</button>)}</div>
  <div className="auxiliary-scroll">{tab==='files'?<FileChangesPanel controller={controller} state={state}/>:tab==='execution'?<ExecutionPanel controller={controller} state={state}/>:<ExtensionPage client={controller.extensionClient} conversationId={state.activeId}/>}</div>
 </aside>;
}
