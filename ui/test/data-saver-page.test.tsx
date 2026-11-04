// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {DataSaverPanel} from '../src/extensions/data-saver';
import {DataSaverCoordinator,type DataSaverView} from '../src/data-saver';
import type {ExecutionPolicy} from '../../runtime/src/data-saver-protocol';

it('distinguishes waiting, a scoped grant and an unverified network interruption without claiming a confirmed stop',()=>{
 const policy=new DataSaverCoordinator(()=>undefined,()=>{});
 const row:ExecutionPolicy={executionId:'waiting',requestDigest:'a'.repeat(64),finalDigest:'b'.repeat(64),productId:'conversation',controlGeneration:1,namespace:'termux:fixture',classification:'unknown',summary:'受管未知脚本',period:3,phase:'waiting',reason:'metered',grantPeriod:null};
 const view:DataSaverView={settings:{enabled:true,version:1,period:3,restricted:true,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}},conversationId:'conversation',operations:[row,{...row,executionId:'granted',phase:'granted',grantPeriod:3},{...row,executionId:'interrupted',phase:'result-unverified',policyInterrupted:true}],loading:false,pending:false};
 try{render(<DataSaverPanel policy={policy} view={view}/>);
  expect((screen.getByLabelText('省流模式') as HTMLInputElement).checked).toBe(true);expect(screen.getByText('省流等待')).toBeTruthy();expect(screen.getByText('临时放行中')).toBeTruthy();expect(screen.getByText('网络变化后结果待核验')).toBeTruthy();
  expect(screen.getByRole('button',{name:'仅放行这一次执行'})).toBeTruthy();expect(screen.queryByText('已停止')).toBeNull();expect(screen.queryByText(/操作审批/)).toBeNull();
 }finally{cleanup();policy.reset();}
});

it('a command that completed before cancellation confirmation is not labelled as stopped by the network policy',()=>{
 const policy=new DataSaverCoordinator(()=>undefined,()=>{});
 const row={executionId:'completed',requestDigest:'a'.repeat(64),finalDigest:'b'.repeat(64),productId:'conversation',controlGeneration:1,namespace:'termux:fixture',classification:'unknown',summary:'完成与网络变化并发',period:3,phase:'terminal',reason:'metered',grantPeriod:null,policyInterrupted:true,state:'completed',scopeConfirmed:true} as ExecutionPolicy;
 try{render(<DataSaverPanel policy={policy} view={{conversationId:'conversation',operations:[row],loading:false,pending:false}}/>);
  expect(screen.getByText('执行已结束')).toBeTruthy();expect(screen.queryByText('因网络变化已停止')).toBeNull();
 }finally{cleanup();policy.reset();}
});
