import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {MODELS_EXTENSION,type ConnectionProtocol,type ConnectionView,type CredentialState} from '../../../runtime/src/model-protocol';
import type {ConversationController,ModelReference,UiState} from '../controller';
import '../models.css';

const credentialLabels:Record<CredentialState,string>={absent:'未配置',configured:'已配置','waiting-first-unlock':'等待首次解锁','temporarily-unavailable':'凭据暂不可用','key-missing':'保护密钥丢失','permanently-invalidated':'保护密钥已失效',corrupt:'凭据密文损坏',incompatible:'凭据版本不兼容'};
const modelValue=(selection:ModelReference|null|undefined)=>selection?JSON.stringify([selection.provider,selection.modelId]):'';

function ModelPicker({label,button,current,connections,disabled,onApply,testId}:{label:string;button:string;current:ModelReference|null|undefined;connections:ConnectionView[];disabled:boolean;onApply:(value:ModelReference)=>Promise<boolean>;testId:string}) {
  const id=useId(),value=modelValue(current);
  const [choice,setChoice]=useState(value);
  useEffect(()=>setChoice(value),[value]);
  const options=connections.flatMap(connection=>connection.models.map(model=>({value:modelValue({provider:connection.id,modelId:model.id}),selection:{provider:connection.id,modelId:model.id},label:`${connection.name} · ${model.name}${connection.enabled?'':' · 已停用'}`,disabled:!connection.enabled})));
  const selected=options.find(option=>option.value===choice&&!option.disabled);
  return <div className="model-picker"><label htmlFor={id}>{label}</label><div className="model-picker-row"><select id={id} data-testid={testId} value={choice} disabled={disabled} onChange={event=>setChoice(event.target.value)}><option value="">请选择模型</option>{value&&!options.some(option=>option.value===value)&&<option value={value} disabled>当前选择（连接不可用）</option>}{options.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select><button className="secondary-button" data-testid={`${testId}-apply`} type="button" disabled={disabled||!selected||choice===value} onClick={()=>{if(selected)void onApply(selected.selection);}}>{button}</button></div></div>;
}

function CredentialForm({connection,controller,disabled}:{connection:ConnectionView;controller:ConversationController;disabled:boolean}) {
  const password=useRef<HTMLInputElement>(null),id=useId();
  const [hasKey,setHasKey]=useState(false);
  const clear=()=>{if(password.current)password.current.value='';setHasKey(false);};
  useEffect(()=>{
    window.addEventListener('pagehide',clear);
    return()=>{window.removeEventListener('pagehide',clear);if(password.current)password.current.value='';};
  },[]);
  function save(event:FormEvent){event.preventDefault();const key=password.current?.value??'';clear();if(key)void controller.writeModelCredential(connection.id,'save',key);}
  return <form className="credential-form" onSubmit={save} autoComplete="off">
    <label htmlFor={id}>API Key</label><input ref={password} id={id} data-testid="credential-input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={connection.credential.configured?'输入新 Key 以替换现有凭据':'输入此连接的 API Key'} onChange={event=>setHasKey(Boolean(event.target.value))} disabled={disabled}/>
    <div className="credential-actions"><button className="secondary-button" data-testid="credential-save" type="submit" disabled={disabled||!hasKey}>保存 API Key</button><button className="text-button danger" data-testid="credential-remove" type="button" disabled={disabled||connection.credential.state==='absent'} onClick={()=>{clear();void controller.writeModelCredential(connection.id,'remove');}}>移除 API Key</button></div>
  </form>;
}

export default function ModelSettings({controller,state}:{controller:ConversationController;state:UiState}) {
  const [name,setName]=useState(''),[protocol,setProtocol]=useState<ConnectionProtocol>('mimo-cn'),[endpoint,setEndpoint]=useState('https://token-plan-cn.xiaomimimo.com/v1'),[modelId,setModelId]=useState('');
  const configuration=state.models;
  const supported=state.status.extensions.includes(MODELS_EXTENSION.id);
  const disabled=state.status.phase!=='ready'||!supported||!configuration||state.modelsPending||state.modelsLoading;
  const current=state.conversation?.conversation??state.conversations.find(conversation=>conversation.id===state.activeId);
  const changeProtocol=(next:ConnectionProtocol)=>{setProtocol(next);setEndpoint(next==='mimo-cn'?'https://token-plan-cn.xiaomimimo.com/v1':'');setModelId('');};
  async function add(event:FormEvent){event.preventDefault();if(await controller.createConnection({name:name.trim(),protocol,endpoint:endpoint.trim(),...(protocol==='openai-compatible'?{modelId:modelId.trim()}:{})})){setName('');setModelId('');}}
  return <div className="settings-scroll" data-testid="model-settings"><div className="settings-content">
    <p className="cloud-disclosure">聊天、附件及工具结果可能发送给所选云端模型。请确认服务地址与数据使用范围。</p>
    <div className="settings-status">{state.modelsLoading&&<span role="status">正在读取连接配置…</span>}<button className="text-button" data-testid="refresh-models" disabled={state.modelsLoading||state.modelsPending||state.status.phase!=='ready'} onClick={()=>void controller.loadModels()}>刷新状态</button></div>
    {state.modelsError&&<p className="settings-error" role="alert">{state.modelsError}</p>}
    {state.modelsNotice&&<p className="settings-notice" role="status">{state.modelsNotice}</p>}
    {!supported&&<p className="settings-error">当前运行宿主未提供模型设置。</p>}
    <section className="settings-section" data-testid="local-data-policy"><h2>本机数据</h2>
      <p className="settings-hint">在当前安装内，会话历史、草稿和仍需引用的输入材料不按时间自动过期。应用升级会保留这些记录；容量不足或版本不兼容时会报告失败并保留原数据。</p>
      <p className="settings-hint">私有工作数据不参加本应用支持的系统云备份和设备迁移。卸载、清除应用数据、丢失设备或换机后可能无法找回；不承诺系统自动恢复。此规则不控制 Termux、用户原文件或任意厂商搬家工具。</p>
      <p className="settings-hint">压缩模型上下文不会彻底删除会话历史。首版不提供单会话历史物理删除或安全擦除。</p>
    </section>
    <section className="settings-section"><h2>模型选择</h2><p className="settings-hint">默认值仅用于新会话；既有会话保留各自的选择。</p>
      <ModelPicker label="新会话默认模型" button="设为新会话默认模型" testId="default-model" current={configuration?.defaultModel} connections={configuration?.connections??[]} disabled={disabled} onApply={selection=>controller.setDefaultModel(selection)}/>
      {current&&<><ModelPicker label="当前会话模型" button="应用到当前会话" testId="conversation-model" current={current.model} connections={configuration?.connections??[]} disabled={disabled} onApply={selection=>controller.selectConversationModel(selection)}/><p className="settings-hint">当前会话：{current.title}。改变选择不会中断或重发已发出的请求。</p></>}
    </section>
    <section className="settings-section"><h2>连接</h2><p className="settings-hint">连接建立后固定服务地址与协议。要更换目的地，请添加新连接；新连接不会继承 API Key。</p>
      {!configuration?.connections.length&&<p className="settings-empty">还没有连接。在下方添加服务，再配置 API Key。</p>}
      {configuration?.connections.map(connection=><article key={connection.id} className={`connection-card ${connection.enabled?'':'connection-disabled'}`} data-testid="connection-card" data-connection-id={connection.id}>
        <div className="connection-heading"><h3>{connection.name}</h3><span className="connection-state">{connection.enabled?'已启用':'已停用'}</span></div>
        <p className="connection-protocol">{connection.protocol==='mimo-cn'?'MiMo 中国 Token Plan':'OpenAI 兼容 API'}</p><p className="connection-endpoint">{connection.endpoint}</p>
        <div className="credential-status" data-testid="credential-status" data-state={connection.credential.state}><span className={`dot ${connection.credential.state==='configured'?'ready':''}`}/>{credentialLabels[connection.credential.state]}</div>
        {connection.credential.message&&<p className="settings-hint">{connection.credential.message}</p>}
        {['key-missing','permanently-invalidated'].includes(connection.credential.state)&&<p className="settings-hint">需要重新配置 API Key；会话历史不会因此删除。</p>}
        {connection.credential.state==='incompatible'&&<p className="settings-hint">旧版本凭据记录不能直接覆盖。请保留此连接，添加新连接并配置 API Key，再为新会话或当前会话明确选择新连接的模型。会话历史会保留。</p>}
        {connection.credential.state==='corrupt'&&<p className="settings-hint">请重新配置 API Key。若保存仍被拒绝，请保留此连接，添加新连接并配置 Key，再明确选择新连接的模型。会话历史会保留。</p>}
        <CredentialForm connection={connection} controller={controller} disabled={disabled}/>
        <details className="model-catalog"><summary>可解析模型 · {connection.models.length}</summary><p className="settings-hint">来自 SDK 目录或你的模型定义；列出不代表已完成云端验证。</p><ul>{connection.models.map(model=><li key={model.id}><strong>{model.name}</strong><code>{model.id}</code></li>)}</ul></details>
        <button type="button" className="text-button" data-testid="connection-toggle" disabled={disabled} onClick={()=>void controller.setConnectionEnabled(connection.id,!connection.enabled)}>{connection.enabled?'停用连接':'启用连接'}</button>
      </article>)}
      <p className="settings-hint">凭据在设备私有存储中加密保存。“已配置”不代表云端认证成功。替换或移除 Key 无法撤回已发出的请求。</p>
    </section>
    <section className="settings-section"><h2>添加新连接</h2><form className="connection-form" onSubmit={event=>void add(event)}>
      <label>连接名称<input data-testid="connection-name" value={name} onChange={event=>setName(event.target.value)} required maxLength={100} placeholder="用于区分服务或账号" disabled={disabled}/></label>
      <label>连接协议<select data-testid="connection-protocol" value={protocol} onChange={event=>changeProtocol(event.target.value as ConnectionProtocol)} disabled={disabled}><option value="mimo-cn">MiMo 中国 Token Plan</option><option value="openai-compatible">OpenAI 兼容 API</option></select></label>
      <label>服务地址<input data-testid="connection-endpoint" type="url" value={endpoint} onChange={event=>setEndpoint(event.target.value)} required autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://…/v1" disabled={disabled}/></label>
      {protocol==='openai-compatible'&&<label>模型 ID<input data-testid="connection-model-id" value={modelId} onChange={event=>setModelId(event.target.value)} required autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="服务提供的准确模型 ID" disabled={disabled}/></label>}
      <button type="submit" className="secondary-button" data-testid="add-connection" disabled={disabled||!name.trim()||!endpoint.trim()||protocol==='openai-compatible'&&!modelId.trim()}>添加连接</button>
    </form></section>
  </div></div>;
}
