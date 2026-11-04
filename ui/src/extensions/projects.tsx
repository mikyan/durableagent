import {useEffect,useState,type FormEvent} from 'react';
import {PROJECTS_EXTENSION,type PositionState,type ProjectRecord,type WorkspaceView} from '../../../runtime/src/project-protocol';
import type {ConversationController,UiState} from '../controller';
import {positionLabels} from '../project-view';
import '../models.css';
import '../projects.css';

export function Position({position,testId}:{position:PositionState;testId?:string}){return <div className="project-position" data-testid={testId} data-state={position.state}><strong>{positionLabels[position.state]}</strong>{position.reason&&<span>{position.reason}</span>}</div>;}
function ProjectCard({project,workspace,disabled,controller}:{project:ProjectRecord;workspace?:WorkspaceView;disabled:boolean;controller:ConversationController}){
  const [name,setName]=useState(project.name);useEffect(()=>setName(project.name),[project.name]);
  return <article className="project-card" data-testid="project-card" data-project-id={project.id}><h3>{project.name}</h3><p>{workspace?.name??'工作区暂不可读'}</p><form onSubmit={event=>{event.preventDefault();void controller.renameProject(project.id,name.trim());}}><label>项目名称<input data-testid="project-rename" value={name} onChange={event=>setName(event.target.value)} required maxLength={100} disabled={disabled}/></label><button className="secondary-button" data-testid="project-rename-apply" disabled={disabled||!name.trim()||name.trim()===project.name}>保存名称</button></form></article>;
}
function WorkspaceCard({workspace,disabled,controller}:{workspace:WorkspaceView;disabled:boolean;controller:ConversationController}){
  const [name,setName]=useState(workspace.name),[path,setPath]=useState(workspace.path);
  useEffect(()=>{setName(workspace.name);setPath(workspace.path);},[workspace.name,workspace.path]);
  const changed=name.trim()!==workspace.name||path.trim()!==workspace.path;
  return <article className="project-card" data-testid="workspace-card" data-workspace-id={workspace.id}><h3>{workspace.name}</h3><p className="workspace-path">{workspace.path}</p><Position position={workspace.position}/><p className="settings-hint">执行环境：{workspace.environment} · 位置版本 {workspace.version}</p><details><summary>修改工作区</summary><form onSubmit={event=>{event.preventDefault();void controller.updateWorkspace(workspace.id,{...(name.trim()!==workspace.name?{name:name.trim()}:{}),...(path.trim()!==workspace.path?{path:path.trim()}:{})});}}><label>工作区名称<input data-testid="workspace-rename" value={name} onChange={event=>setName(event.target.value)} required maxLength={100} disabled={disabled}/></label><label>新的目录位置<input data-testid="workspace-path-edit" value={path} onChange={event=>setPath(event.target.value)} required autoCapitalize="none" spellCheck={false} disabled={disabled}/></label><p className="settings-hint">共享此工作区的会话会看到修改。仍有工作使用原位置时，目录修改会被拒绝。</p><button className="secondary-button" data-testid="workspace-update" disabled={disabled||!changed||!name.trim()||!path.trim()}>保存工作区修改</button></form></details></article>;
}
export default function ProjectSettings({controller,state}:{controller:ConversationController;state:UiState}){
  const catalog=state.projects,selection=catalog?.selection&&catalog.selection.id===state.activeId?catalog.selection:undefined;
  const [projectName,setProjectName]=useState(''),[workspaceId,setWorkspaceId]=useState('default'),[workspaceName,setWorkspaceName]=useState(''),[path,setPath]=useState('');
  const [choice,setChoice]=useState(selection?.projectId??'');useEffect(()=>setChoice(selection?.projectId??''),[state.activeId,selection?.projectId]);
  const supported=state.status.extensions.includes(PROJECTS_EXTENSION.id),disabled=!supported||!catalog||state.status.phase!=='ready'||!!state.projectsPending||!!state.projectsLoading||!!state.projectsUnconfirmed;
  const currentProject=catalog?.projects.find(item=>item.id===selection?.projectId),currentWorkspace=catalog?.workspaces.find(item=>item.id===selection?.workspaceId);
  async function addProject(event:FormEvent){event.preventDefault();if(await controller.createProject({name:projectName.trim(),workspaceId}))setProjectName('');}
  async function addWorkspace(event:FormEvent){event.preventDefault();if(await controller.createWorkspace({name:workspaceName.trim(),path:path.trim()})){setWorkspaceName('');setPath('');}}
  return <div className="settings-scroll" data-testid="project-settings"><div className="settings-content">
    <p className="cloud-disclosure">项目组织持续工作；工作区指向实际目录。共享目录的会话使用同一批文件，工作区不是文件安全隔离。</p>
    <div className="settings-status">{state.projectsLoading&&<span role="status">正在读取项目与位置…</span>}<button className="text-button" data-testid="refresh-projects" disabled={!!state.projectsLoading||!!state.projectsPending||state.status.phase!=='ready'} onClick={()=>void controller.loadProjects()}>刷新项目状态</button></div>
    {state.projectsError&&<p className="settings-error" role="alert">{state.projectsError}</p>}{state.projectsNotice&&<p className="settings-notice" role="status">{state.projectsNotice}</p>}
    {state.projectsUnconfirmed&&<p className="settings-hint">这次修改结果未确认。<button className="secondary-button" data-testid="retry-project-change" disabled={!!state.projectsPending||state.status.phase!=='ready'} onClick={()=>void controller.retryProjectChange()}>核验这次修改</button></p>}
    {!supported&&<p className="settings-error">当前运行宿主未提供项目管理。</p>}
    <section className="settings-section"><h2>当前会话</h2>{state.activeId?<>
      <p data-testid="current-project">项目：{selection?(currentProject?.name??'未关联项目'):'正在读取'}</p><p data-testid="current-workspace">工作区：{currentWorkspace?.name??'正在读取'}</p>
      {currentWorkspace&&<p className="workspace-path" data-testid="current-workspace-path">{currentWorkspace.path}</p>}{selection&&<Position position={selection.position} testId="current-position"/>}
      <form className="project-selection" onSubmit={event=>{event.preventDefault();void controller.selectProject(choice||null);}}><label>当前会话项目<select data-testid="conversation-project" value={choice} onChange={event=>setChoice(event.target.value)} disabled={disabled||!selection}><option value="">未关联项目 · 默认工作区</option>{catalog?.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="secondary-button" data-testid="conversation-project-apply" disabled={disabled||!selection||choice===(selection.projectId??'')}>应用到当前会话</button></form>
      <p className="settings-hint">修改被拒绝时不会排队或稍后自动生效；等待相关工作结束后，可以重新明确修改。</p>
    </>:<p className="settings-hint">打开会话后可为它选择项目。新会话无需先建项目，共同使用默认工作区。</p>}</section>
    <section className="settings-section"><h2>项目</h2>{!catalog?.projects.length&&<p className="settings-empty">还没有项目，可以直接使用默认工作区聊天。</p>}{catalog?.projects.map(project=><ProjectCard key={project.id} project={project} workspace={catalog.workspaces.find(item=>item.id===project.workspaceId)} disabled={disabled} controller={controller}/>)}
      <form className="connection-form" onSubmit={event=>void addProject(event)}><label>新项目名称<input data-testid="project-name" value={projectName} onChange={event=>setProjectName(event.target.value)} maxLength={100} required disabled={disabled}/></label><label>项目工作区<select data-testid="project-workspace" value={workspaceId} onChange={event=>setWorkspaceId(event.target.value)} disabled={disabled}>{catalog?.workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="primary-button" data-testid="project-create" disabled={disabled||!projectName.trim()||!catalog?.workspaces.some(item=>item.id===workspaceId)}>添加项目</button></form>
    </section>
    <section className="settings-section"><h2>工作区</h2><p className="settings-hint">填写目录不会创建目录或授予访问权限。位置未核验时聊天仍可使用，文件与命令执行须等待实际环境就绪。</p>{catalog?.workspaces.map(workspace=><WorkspaceCard key={workspace.id} workspace={workspace} disabled={disabled} controller={controller}/>)}
      <form className="connection-form" onSubmit={event=>void addWorkspace(event)}><label>新工作区名称<input data-testid="workspace-name" value={workspaceName} onChange={event=>setWorkspaceName(event.target.value)} maxLength={100} required disabled={disabled}/></label><label>工作区目录<input data-testid="workspace-path" value={path} onChange={event=>setPath(event.target.value)} placeholder="执行环境中的绝对目录" autoCapitalize="none" spellCheck={false} required disabled={disabled}/></label><button className="primary-button" data-testid="workspace-create" disabled={disabled||!workspaceName.trim()||!path.trim()}>添加工作区</button></form>
    </section>
  </div></div>;
}
