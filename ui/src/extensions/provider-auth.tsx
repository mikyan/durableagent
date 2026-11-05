import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ProviderAuthSession} from '../../../runtime/src/model-protocol';
import type {ConversationController} from '../controller';
import type {ProviderAuthInput} from '../client';

const unfinished=(session:ProviderAuthSession)=>session.state==='running'||session.state==='waiting';

/** Answers go only through the native credential boundary, never the application request channel. */
export function ProviderLogin({controller,target,authType,onClose}:{controller:ConversationController;target:string;authType:'api_key'|'oauth';onClose:()=>void}) {
  const [session,setSession]=useState<ProviderAuthSession>(),[busy,setBusy]=useState(true),[error,setError]=useState<string>();
  const current=useRef<ProviderAuthSession|undefined>(undefined),alive=useRef(false),pending=useRef(false);
  const input=useRef<HTMLInputElement>(null),select=useRef<HTMLSelectElement>(null);
  const clear=()=>{if(input.current)input.current.value='';};
  const adopt=(value:ProviderAuthSession)=>{current.current=value;if(alive.current)setSession(value);};
  async function action(input:Omit<ProviderAuthInput,'target'|'sessionId'>){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError(undefined);
    try{
      const value=await controller.authenticateProvider({...input,target,sessionId:current.current?.id});
      adopt(value);
      if(value.state==='completed'&&alive.current)void controller.loadModels();
    }catch{if(alive.current)setError('登录步骤尚未确认。请刷新登录状态，或取消后重试。');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  useEffect(()=>{
    alive.current=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const cancel=(session:ProviderAuthSession)=>{if(unfinished(session))void controller.authenticateProvider({target,operation:'cancel',sessionId:session.id}).catch(()=>{});};
    const poll=async()=>{
      if(!alive.current)return;
      if(current.current&&unfinished(current.current)&&!pending.current)await action({operation:'status'});
      if(alive.current&&current.current&&unfinished(current.current))timer=setTimeout(poll,1000);
    };
    pending.current=true;
    void controller.authenticateProvider({target,operation:'start',authType}).then(value=>{
      if(!alive.current){cancel(value);return;}
      adopt(value);if(value.state==='completed')void controller.loadModels();
      if(unfinished(value))timer=setTimeout(poll,1000);
    },()=>{if(alive.current)setError('登录尚未开始。请返回后重试。');}).finally(()=>{pending.current=false;if(alive.current)setBusy(false);});
    const clearOnHide=()=>clear();window.addEventListener('pagehide',clearOnHide);
    return()=>{alive.current=false;clearTimeout(timer);clear();window.removeEventListener('pagehide',clearOnHide);if(current.current)cancel(current.current);};
  },[controller,target,authType]);
  const prompt=session?.prompt;
  useEffect(()=>clear(),[prompt?.id]);
  function answer(event:FormEvent){event.preventDefault();if(!prompt||busy)return;const value=prompt.type==='select'?select.current?.value:input.current?.value;clear();if(value!==undefined)void action({operation:'answer',promptId:prompt.id,answer:value});}
  return <section className="provider-login" aria-label={authType==='oauth'?'账号登录':'配置凭据'}>
    <div className="connection-heading"><h3>{authType==='oauth'?'登录账号':'配置凭据'}</h3><button className="text-button" onClick={onClose}>{session?.state==='completed'?'完成':'取消'}</button></div>
    {error&&<p className="settings-error" role="alert">{error}</p>}
    {session?.events.map((event,index)=><div className="auth-event" key={index}>
      {event.type==='auth_url'?<><p>{event.instructions??'在浏览器中完成登录，然后返回此处。'}</p><button className="secondary-button" disabled={busy||!unfinished(session)} onClick={()=>void action({operation:'openUrl',eventIndex:index})}>打开登录页面 ↗</button></>:event.type==='device_code'?<><p>在登录页面输入验证码</p><code className="auth-device-code">{event.userCode}</code><button className="secondary-button" disabled={busy||!unfinished(session)} onClick={()=>void action({operation:'openUrl',eventIndex:index})}>打开验证页面 ↗</button></>:<p>{event.message}</p>}
    </div>)}
    {prompt&&unfinished(session!)&&<form key={prompt.id} className="credential-form auth-prompt" onSubmit={answer} autoComplete="off"><label htmlFor={`auth-${prompt.id}`}>{prompt.message}</label>
      {prompt.type==='select'?<select ref={select} id={`auth-${prompt.id}`} disabled={busy}>{prompt.options.map(option=><option key={option.id} value={option.id}>{option.label}{option.description?` · ${option.description}`:''}</option>)}</select>:<input ref={input} id={`auth-${prompt.id}`} type={prompt.type==='text'?'text':'password'} placeholder={prompt.placeholder} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/>}
      <button className="secondary-button" type="submit" disabled={busy}>继续</button>
    </form>}
    {session?.state==='failed'&&<p className="settings-error" role="alert">{session.error?.message??'登录未完成，请重新开始。'}</p>}
    {session?.state==='completed'&&<p className="settings-notice" role="status">凭据已保存。可以返回选择模型。</p>}
    {session?.state==='cancelled'&&<p className="settings-hint">登录已取消。</p>}
    {(!session||unfinished(session))&&<div className="auth-progress" role="status"><span>{busy?'正在确认登录步骤…':prompt?'等待输入':'等待登录完成…'}</span>{session&&<button className="text-button" disabled={busy} onClick={()=>void action({operation:'status'})}>刷新登录状态</button>}</div>}
    <p className="settings-hint">凭据只保存在此设备的加密存储中。登录不会改变当前会话的模型选择。</p>
  </section>;
}
