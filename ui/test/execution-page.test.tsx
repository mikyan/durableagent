// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {ExecutionPanel} from '../src/extensions/execution';
import {ConversationController,type UiState} from '../src/controller';
import {ApplicationClient} from '../src/client';

it('keeps application uncertainty and a pending cancel distinct from a confirmed stop',()=>{
  const controller=new ConversationController(()=>new ApplicationClient(undefined));
  const state:UiState={...controller.snapshot(),activeId:'one',execution:{rows:[{executionId:'lost',state:'unknown',source:'application',reason:'CLIENT_CONFIRMATION_LOST'},{executionId:'pending',state:'stop_requested'},{executionId:'incomplete',state:'completed',exitCode:0,captureIncomplete:true}],conversationId:'one',loading:false,connecting:false,copying:false,pending:[],connected:false}};
  try{
    render(<ExecutionPanel controller={controller} state={state}/>);
    expect(screen.getByText('未收到执行端确认')).toBeTruthy();
    expect(screen.getByText('取消已请求，等待停止确认')).toBeTruthy();
    expect(screen.queryByText('已停止')).toBeNull();
    expect(screen.getByText('输出不完整')).toBeTruthy();
    expect(screen.getByText('退出码 0')).toBeTruthy();
    expect(screen.getByRole('button',{name:'复制初始化命令'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'连接执行环境'})).toBeTruthy();
  }finally{cleanup();controller.dispose();}
});
