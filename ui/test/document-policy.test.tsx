// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {DocumentsPanel} from '../src/extensions/documents';
import {FileChangesPanel} from '../src/extensions/file-changes';

it('displays cached metadata and resumes only the fixed pending Provider observation',async()=>{
 const id='a'.repeat(64),calls:any[]=[];
 const waiting={protocol:1,resourceId:id,namespace:'saf:'+id,source:'saf',original:true,uri:'content://fixture/document/original',displayName:'原文件',mimeType:'application/octet-stream',providerFlags:0,networkAccess:'unknown',availability:'unavailable',freshness:'not-observed',reason:'省流等待',grant:{read:true,write:true,persistedRead:true,persistedWrite:true},observation:{executionId:'fixed-observation',requestDigest:'b'.repeat(64),period:7,phase:'waiting'}};
 const client:any={request:async(method:string,payload:any)=>{calls.push({method,payload});if(method==='document.list')return {resources:[waiting],nextCursor:null};if(method==='document.resumeObservation')return {...waiting,displayName:'observed.txt',availability:'available',freshness:'observed',observedAt:1,observation:{...waiting.observation,phase:'terminal'}};throw Error('Unexpected action');}};
 try{render(<DocumentsPanel client={client}/>);const panel=screen.getByText('原文件').closest('details')!;panel.open=true;fireEvent(panel,new Event('toggle'));
  await screen.findByText('省流等待');fireEvent.click(screen.getByRole('button',{name:'仅放行这次原文件观察'}));
  await screen.findByText('observed.txt');expect(calls).toEqual([{method:'document.list',payload:{}},{method:'document.resumeObservation',payload:{resourceId:id,operationId:'fixed-observation',requestDigest:'b'.repeat(64),period:7}}]);
  expect(screen.getByText(/上次观察/)).toBeTruthy();expect(screen.queryByRole('button',{name:'仅放行这次原文件观察'})).toBeNull();
 }finally{cleanup();}
});

it('keeps original scope unconfirmed while explicitly granting only its fixed verification observation',async()=>{
 const resourceId='a'.repeat(64),requestDigest='b'.repeat(64),calls:any[]=[];
 const row={operationId:'write',executionId:null,bindingId:'binding',path:'content://fixture/document/original',namespace:'saf:'+resourceId,resourceId,requestDigest,sequence:2,original:true,state:'unknown',scopeConfirmed:false,diff:{available:false,reason:'unconfirmed'}};
 const observation={executionId:'verify-once',requestDigest:'c'.repeat(64),period:9,phase:'waiting'};
 const client:any={request:async(method:string,payload:any)=>{calls.push({method,payload});if(method==='files.list')return {changes:[],nextCursor:null,documents:{changes:[row],limited:false},untrackedExecutions:[],untrackedLimited:false};
  return {...row,protocol:1,uri:row.path,verification:method==='document.verify'?{status:'waiting',reasonCode:'DATA_SAVER_WAIT',observation}:{status:'read',observedAt:123,currentDigest:'d'.repeat(64),byteLength:4,matchesExpected:false,matchesContent:true,observation:{...observation,phase:'terminal'}}};}};
 try{render(<FileChangesPanel controller={{extensionClient:client} as any} state={{activeId:'chat',status:{phase:'ready'}} as any}/>);fireEvent.click(screen.getByRole('button',{name:'查看文件变更'}));await screen.findByText('原件结果待核验');fireEvent.click(screen.getByRole('button',{name:'只读核验原件内容'}));
  fireEvent.click(await screen.findByRole('button',{name:'仅放行这次只读核验'}));await screen.findByText('本次观察的内容与本次写入相符；执行范围仍未确认。');expect(screen.queryByText('原件修改已核验')).toBeNull();
  expect(calls.at(-1)).toEqual({method:'document.resumeVerification',payload:{operationId:'write',observationId:'verify-once',requestDigest:'c'.repeat(64),period:9}});
 }finally{cleanup();}
});
