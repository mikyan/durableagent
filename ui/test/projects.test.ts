import {expect,it} from 'vitest';
import {projectWire} from './project-platform';

it('keeps refused project changes unapplied until a fresh explicit action after the blocking work ends',async()=>{
  const f=projectWire();try{
    await f.controller.connect();await f.controller.open('one');await f.controller.openProjects();
    expect(f.controller.snapshot().projects?.selection?.projectId).toBeNull();
    expect(await f.controller.createProject({name:'持续工作',workspaceId:'default'})).toBe(true);const project=f.catalog.projects[0];
    f.busy=true;expect(await f.controller.selectProject(project.id)).toBe(false);expect(f.controller.snapshot().projectsError).toContain('未结算输入');
    expect(f.catalog.selection?.projectId).toBeNull();const refused=f.requests.filter(item=>item.method==='projects.select')[0];
    f.busy=false;await f.controller.loadProjects();expect(f.catalog.selection?.projectId).toBeNull();expect(f.requests.filter(item=>item.method==='projects.select')).toHaveLength(1);
    expect(await f.controller.selectProject(project.id)).toBe(true);const applied=f.requests.filter(item=>item.method==='projects.select')[1];
    expect(applied.payload?.operationId).not.toBe(refused.payload?.operationId);expect(f.controller.snapshot().projects?.selection?.projectId).toBe(project.id);
    expect(await f.controller.renameProject(project.id,'当前项目名称')).toBe(true);expect(f.controller.snapshot().projects?.projects[0].name).toBe('当前项目名称');
  }finally{f.controller.dispose();}
});

it('keeps the exact operation and expected catalog version after a lost mutation receipt',async()=>{
  const f=projectWire();try{
    await f.controller.connect();await f.controller.openProjects();f.lose=true;
    expect(await f.controller.createWorkspace({name:'唯一工作区',path:'/work/one'})).toBe(false);expect(f.controller.snapshot().projectsUnconfirmed).toBe(true);
    expect(f.catalog.workspaces).toHaveLength(2);await f.controller.loadProjects();
    expect(await f.controller.createWorkspace({name:'不能暗中换成新操作',path:'/work/two'})).toBe(false);
    expect(await f.controller.retryProjectChange()).toBe(true);
    const changes=f.requests.filter(item=>item.method==='workspaces.create');expect(changes).toHaveLength(2);expect(changes[1].payload).toEqual(changes[0].payload);
    expect(f.catalog.workspaces).toHaveLength(2);expect(f.controller.snapshot().projectsUnconfirmed).toBe(false);
  }finally{f.controller.dispose();}
});

it('does not relabel a confirmed mutation as unknown or rejected when its follow-up view refresh fails',async()=>{
  const f=projectWire();try{
    await f.controller.connect();await f.controller.openProjects();f.failListing=true;
    expect(await f.controller.createProject({name:'已确认的项目',workspaceId:'default'})).toBe(true);
    expect(f.controller.snapshot().projects?.projects[0].name).toBe('已确认的项目');expect(f.controller.snapshot().projectsUnconfirmed).toBe(false);
    expect(f.controller.snapshot().projectsNotice).toContain('修改已保存');expect(f.requests.filter(item=>item.method==='projects.create')).toHaveLength(1);
  }finally{f.controller.dispose();}
});
