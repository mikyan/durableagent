// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {App} from '../src/App';
import {projectWire} from './project-platform';

it('creates a shared workspace and project through the public UI and displays unverified position without claiming file access',async()=>{
  const f=projectWire();try{
    render(<App controller={f.controller}/>);
    fireEvent.click(await screen.findByRole('button',{name:'项目与工作区'}));
    const workspaceName=await screen.findByRole('textbox',{name:'新工作区名称'});await waitFor(()=>expect((workspaceName as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByText('执行环境尚未就绪')).toBeTruthy();
    fireEvent.change(workspaceName,{target:{value:'共享资料'}});fireEvent.change(screen.getByRole('textbox',{name:'工作区目录'}),{target:{value:'/data/data/com.termux/files/home/shared'}});
    fireEvent.click(screen.getByRole('button',{name:'添加工作区'}));
    await waitFor(()=>expect(f.catalog.workspaces).toHaveLength(2));const workspace=f.catalog.workspaces[1];
    fireEvent.change(screen.getByRole('textbox',{name:'新项目名称'}),{target:{value:'长期资料'}});fireEvent.change(screen.getByRole('combobox',{name:'项目工作区'}),{target:{value:workspace.id}});
    await waitFor(()=>expect((screen.getByRole('button',{name:'添加项目'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'添加项目'}));
    await waitFor(()=>expect(f.catalog.projects).toHaveLength(1));
    const card=await screen.findByTestId('project-card');expect(within(card).getByText('共享资料')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'返回会话'}));await f.controller.open('one');fireEvent.click(await screen.findByRole('button',{name:'会话详情'}));
    fireEvent.click(screen.getByRole('button',{name:'选择项目与工作区'}));
    const choice=await screen.findByRole('combobox',{name:'当前会话项目'});fireEvent.change(choice,{target:{value:f.catalog.projects[0].id}});fireEvent.click(screen.getByRole('button',{name:'应用到当前会话'}));
    await waitFor(()=>expect(f.catalog.selection?.projectId).toBe(f.catalog.projects[0].id));
    expect(await screen.findByTestId('current-position')).toHaveProperty('dataset.state','unverified');expect(screen.getAllByText('/data/data/com.termux/files/home/shared').length).toBeGreaterThan(0);
    expect(screen.getByText(/工作区不是文件安全隔离/)).toBeTruthy();
  }finally{cleanup();f.controller.dispose();}
});
