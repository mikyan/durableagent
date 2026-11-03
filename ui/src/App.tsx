import {lazy,Suspense,useEffect,useSyncExternalStore} from 'react';
import type {ConversationController} from './controller';
import {builtInUiExtensions} from './extensions';
import {CONVERSATION_EXTENSION} from '../../runtime/src/application-protocol';

const ConversationPage=lazy(builtInUiExtensions[CONVERSATION_EXTENSION.id].load);

export function App({controller}:{controller:ConversationController}) {
  const state=useSyncExternalStore(controller.observe,controller.snapshot);
  useEffect(()=>{void controller.connect();return()=>controller.dispose();},[controller]);
  useEffect(()=>{
    if(state.status.phase!=='opening'&&state.status.phase!=='configuring')return;
    let attempts=0;
    const timer=setInterval(()=>{if(++attempts>30){clearInterval(timer);return;}void controller.refresh();},1000);
    return()=>clearInterval(timer);
  },[controller,state.status.phase]);
  return <Suspense fallback={<div className="startup" role="status">正在打开会话界面…</div>}>
    <ConversationPage controller={controller} state={state}/>
  </Suspense>;
}
