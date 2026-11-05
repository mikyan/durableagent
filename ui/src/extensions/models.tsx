import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {MODELS_EXTENSION,type ConnectionView,type CredentialState,type ProviderView} from '../../../runtime/src/model-protocol';
import type {ConversationController,ModelReference,UiState} from '../controller';
import {ProviderLogin} from './provider-auth';
import '../models.css';

const credentialLabels:Record<CredentialState,string>={absent:'未配置',configured:'已配置','waiting-first-unlock':'等待首次解锁','temporarily-unavailable':'凭据暂不可用','key-missing':'保护密钥丢失','permanently-invalidated':'保护密钥已失效',corrupt:'凭据密文损坏',incompatible:'凭据版本不兼容'};
const modelValue=(selection:ModelReference|null|undefined)=>selection?JSON.stringify([selection.provider,selection.modelId]):'';
const providerId=(connection:ConnectionView)=>connection.providerId??(connection.protocol==='mimo-cn'?'xiaomi-token-plan-cn':'openai-compatible');
const customProvider:ProviderView={id:'openai-compatible',name:'OpenAI 兼容 API',models:[],authMethods:[{type:'api_key',label:'API Key'}]};

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
  useEffect(()=>{window.addEventListener('pagehide',clear);return()=>{window.removeEventListener('pagehide',clear);if(password.current)password.current.value='';};},[]);
  function save(event:FormEvent){event.preventDefault();const key=password.current?.value??'';clear();if(key)void controller.writeModelCredential(connection.id,'save',key);}
  return <form className="credential-form" onSubmit={save} autoComplete="off"><label htmlFor={id}>API Key</label><input ref={password} id={id} data-testid="credential-input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={connection.credential.configured?'输入新 Key 以替换现有凭据':'输入此连接的 API Key'} onChange={event=>setHasKey(Boolean(event.target.value))} disabled={disabled}/><div className="credential-actions"><button className="secondary-button" data-testid="credential-save" type="submit" disabled={disabled||!hasKey}>保存 API Key</button></div></form>;
}

function ProviderSymbol({name}:{name:string}){return <span className="provider-symbol" aria-hidden="true">{name.replace(/[^a-zA-Z0-9]/g,'').slice(0,2)||'AI'}</span>;}

function ProviderDetail({provider,controller,state,disabled}:{provider:ProviderView;controller:ConversationController;state:UiState;disabled:boolean}) {
  const connections=state.models?.connections.filter(connection=>providerId(connection)===provider.id)??[];
  const custom=provider.id===customProvider.id;
  const [adding,setAdding]=useState(false),[name,setName]=useState(provider.name),[endpoint,setEndpoint]=useState(''),[modelId,setModelId]=useState('');
  const [login,setLogin]=useState<{target:string;authType:'api_key'|'oauth'}>();
  const [creating,setCreating]=useState(false);
  const create=async()=>{
    if(creating||disabled)return null;setCreating(true);
    try{return await controller.createConnection(custom?{name:name.trim(),protocol:'openai-compatible',endpoint:endpoint.trim(),modelId:modelId.trim()}:{name:name.trim()||provider.name,protocol:'sdk',providerId:provider.id,...(endpoint.trim()?{endpoint:endpoint.trim()}:{})});}
    finally{setCreating(false);}
  };
  async function authenticate(authType:'api_key'|'oauth',connection?:ConnectionView){
    const target=connection??await create();if(target){setAdding(false);setLogin({target:target.id,authType});}
  }
  async function addCustom(event:FormEvent){event.preventDefault();if(await create()){setAdding(false);setEndpoint('');setModelId('');}}
  const authButtons=(connection?:ConnectionView)=><div className="provider-auth-actions">{provider.authMethods.map(method=><button className={method.type==='oauth'?'secondary-button':'text-button'} key={method.type} disabled={disabled||creating||!!login} onClick={()=>void authenticate(method.type,connection)}>{method.label}{method.type==='oauth'?' ↗':''}</button>)}</div>;
  return <div className="provider-detail" key={provider.id}>
    <div className="provider-detail-heading"><ProviderSymbol name={provider.name}/><div><h2>{provider.name}</h2><p>{custom?'连接自己的模型服务':provider.id}</p></div></div>
    {provider.defaultEndpoint&&<p className="connection-endpoint">{provider.defaultEndpoint}</p>}
    <p className="settings-hint">配置账号后，返回模型列表选择当前会话或新会话的默认模型。</p>
    {login&&<ProviderLogin key={`${login.target}:${login.authType}`} controller={controller} target={login.target} authType={login.authType} onClose={()=>setLogin(undefined)}/>}
    {connections.map(connection=><article key={connection.id} className={`connection-card ${connection.enabled?'':'connection-disabled'}`} data-testid="connection-card" data-connection-id={connection.id}>
      <div className="connection-heading"><h3>{connection.name}</h3><span className="connection-state">{connection.enabled?'已启用':'已停用'}</span></div>
      {connection.endpoint&&<p className="connection-endpoint">{connection.endpoint}</p>}
      <div className="credential-status" data-testid="credential-status" data-state={connection.credential.state}><span className={`dot ${connection.credential.state==='configured'?'ready':''}`}/>{credentialLabels[connection.credential.state]}</div>
      {connection.credential.message&&<p className="settings-hint">{connection.credential.message}</p>}
      {['key-missing','permanently-invalidated','corrupt'].includes(connection.credential.state)&&<p className="settings-hint">请重新配置凭据。若保存仍被拒绝，请添加新账号后重新选择模型；会话历史会保留。</p>}
      {connection.credential.state==='incompatible'&&<p className="settings-hint">请保留此连接，添加新账号并重新配置凭据，再明确选择新连接的模型。</p>}
      {connection.protocol==='sdk'?authButtons(connection):<CredentialForm controller={controller} connection={connection} disabled={disabled||!!login}/>}
      <details className="model-catalog"><summary>模型 · {connection.models.length}</summary><div className="disclosure-content"><p className="settings-hint">目录来自模型服务；列出不代表此设备已验证可用。</p>{connection.protocol==='sdk'&&<button className="text-button" disabled={disabled||!!login} onClick={()=>void controller.refreshConnectionModels(connection.id)}>刷新模型</button>}<ul>{connection.models.map(model=><li key={model.id}><strong>{model.name}</strong><code>{model.id}</code></li>)}</ul></div></details>
      <div className="credential-actions"><button type="button" className="text-button" data-testid="connection-toggle" disabled={disabled||!!login} onClick={()=>void controller.setConnectionEnabled(connection.id,!connection.enabled)}>{connection.enabled?'停用连接':'启用连接'}</button><button className="text-button danger" data-testid="credential-remove" disabled={disabled||!!login||connection.credential.state==='absent'} onClick={()=>void controller.writeModelCredential(connection.id,'remove')}>移除凭据</button></div>
    </article>)}
    {!login&&(adding||!connections.length)&&<section className="settings-section new-provider-account"><h2>{connections.length?'添加账号':'连接 '+provider.name}</h2><label>账号名称<input value={name} data-testid="connection-name" onChange={event=>setName(event.target.value)} maxLength={100} disabled={disabled||creating} placeholder="用于区分账号"/></label>
      {custom?<form className="connection-form" onSubmit={event=>void addCustom(event)}><label>服务地址<input data-testid="connection-endpoint" type="url" value={endpoint} onChange={event=>setEndpoint(event.target.value)} required autoCapitalize="none" spellCheck={false} placeholder="https://…/v1" disabled={disabled||creating}/></label><label>模型 ID<input data-testid="connection-model-id" value={modelId} onChange={event=>setModelId(event.target.value)} required autoCapitalize="none" spellCheck={false} placeholder="服务提供的准确模型 ID" disabled={disabled||creating}/></label><button type="submit" className="secondary-button" data-testid="add-connection" disabled={disabled||creating||!name.trim()||!endpoint.trim()||!modelId.trim()}>添加连接</button></form>:<><label>服务地址{provider.id==='azure'?'（Azure 资源地址）':'（可选）'}<input type="url" value={endpoint} onChange={event=>setEndpoint(event.target.value)} autoCapitalize="none" spellCheck={false} placeholder={provider.defaultEndpoint??'https://…'} disabled={disabled||creating}/></label><p className="settings-hint">{provider.id==='azure'?'填写 Azure 资源 HTTPS 地址；部署名称需与所选模型 ID 一致。':'留空使用提供方默认地址。'}</p>{authButtons()}{!provider.authMethods.length&&<p className="settings-hint">该服务依赖环境凭据，当前没有可交互的登录方式。</p>}</>}
    </section>}
    {!!connections.length&&!adding&&!login&&<button className="text-button add-provider-account" onClick={()=>{setName(provider.name);setAdding(true);}}>＋ 添加另一个账号</button>}
    <p className="settings-hint">凭据加密保存在设备上。“已配置”不代表云端验证成功。连接的服务地址固定；切换目的地请添加新连接。移除凭据不会撤回已发出的请求。</p>
  </div>;
}

export default function ModelSettings({controller,state}:{controller:ConversationController;state:UiState}) {
  const [query,setQuery]=useState('');
  const configuration=state.models,supported=state.status.extensions.includes(MODELS_EXTENSION.id);
  const disabled=state.status.phase!=='ready'||!supported||!configuration||state.modelsPending||state.modelsLoading;
  const current=state.conversation?.conversation??state.conversations.find(conversation=>conversation.id===state.activeId);
  const providers=[...(configuration?.providers??[]),customProvider];
  const selected=providers.find(provider=>provider.id===state.modelProviderId);
  const currentSelection=current?.model??configuration?.defaultModel;
  const currentConnection=configuration?.connections.find(connection=>connection.id===currentSelection?.provider);
  const currentModel=currentConnection?.models.find(model=>model.id===currentSelection?.modelId);
  const shown=providers.filter(provider=>`${provider.name} ${provider.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <div className="settings-scroll" data-testid="model-settings"><div className="settings-content model-settings-content">
    <div className="settings-status">{state.modelsLoading&&<span role="status">正在读取模型配置…</span>}<button className="text-button" data-testid="refresh-models" disabled={state.modelsLoading||state.modelsPending||state.status.phase!=='ready'} onClick={()=>void controller.loadModels()}>刷新状态</button></div>
    {state.modelsError&&<p className="settings-error" role="alert">{state.modelsError}</p>}{state.modelsNotice&&<p className="settings-notice" role="status">{state.modelsNotice}</p>}
    {!supported&&<p className="settings-error">模型设置暂不可用，请重新连接。</p>}
    {selected?<ProviderDetail key={selected.id} provider={selected} controller={controller} state={state} disabled={disabled}/>:<>
      <section className="current-model-section"><span className="section-eyebrow">{current?'当前会话模型':'新会话默认模型'}</span><h2>{currentModel?.name??currentSelection?.modelId??'选择你的模型'}</h2><p>{currentConnection?.name??'先连接下方的模型服务，再选择模型。'}</p>
        <details className="model-selection-disclosure"><summary>切换模型 <span aria-hidden="true">⌄</span></summary><div className="disclosure-content"><ModelPicker label="新会话默认模型" button="设为默认" testId="default-model" current={configuration?.defaultModel} connections={configuration?.connections??[]} disabled={disabled} onApply={selection=>controller.setDefaultModel(selection)}/>{current&&<ModelPicker label="当前会话模型" button="应用到会话" testId="conversation-model" current={current.model} connections={configuration?.connections??[]} disabled={disabled} onApply={selection=>controller.selectConversationModel(selection)}/>}<p className="settings-hint">默认值仅用于新会话。切换模型不会重发已发出的请求。</p></div></details>
      </section>
      <section className="provider-section"><div className="provider-section-heading"><h2>模型服务</h2><span>{configuration?.providers?.length??0} 个 Provider</span></div><label className="provider-search"><span className="sr-only">搜索模型服务</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索 Provider…"/></label>
        <div className="provider-list">{shown.map(provider=>{const accounts=configuration?.connections.filter(connection=>providerId(connection)===provider.id)??[];const configured=accounts.filter(connection=>connection.credential.configured&&connection.enabled);const selectedModel=accounts.find(connection=>connection.id===currentSelection?.provider)?.models.find(model=>model.id===currentSelection?.modelId);return <button className="provider-row" key={provider.id} onClick={()=>controller.showModelProvider(provider.id)}><ProviderSymbol name={provider.name}/><span className="provider-row-copy"><strong>{provider.name}</strong><small>{selectedModel?`当前 · ${selectedModel.name}`:configured.length?`${configured.length} 个账号已配置`:provider.authMethods.map(method=>method.type==='oauth'?'账号登录':'API Key').join(' · ')||'环境凭据'}</small></span><span className={`provider-state ${configured.length?'configured':''}`}>{configured.length?'已配置':accounts.length?'待配置':'连接'}</span><span className="chevron" aria-hidden="true">›</span></button>;})}</div>
        {!shown.length&&<p className="settings-empty">没有匹配的模型服务。</p>}
      </section><p className="settings-hint model-privacy-note">聊天、附件和工具结果会发送给你选择的模型服务。</p>
    </>}
  </div></div>;
}
