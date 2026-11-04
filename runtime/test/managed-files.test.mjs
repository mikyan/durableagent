import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {ManagedFiles} from '../dist/managed-files.js';

// Only the external authenticated file service is controlled here. Actual fd/UID proof is in Termux tests.
test('SDK binary reader assembles bounded remote pages and fails on a lost opened handle without reopening its path',async()=>{
 const bytes=Buffer.concat([Buffer.from('original-世界\n'),Buffer.alloc(100000,65)]),namespace='termux:fixture';let lost=false;
 const channel={async request(method,payload){
  if(method==='file.open')return {ok:true,value:{handle:'opened-file',epoch:'server-one',namespace,info:{name:'source.txt',path:'/work/source.txt',kind:'file',size:bytes.length,mtimeMs:1}}};
  if(method==='file.close')return {ok:true,value:null};
  if(lost)return {ok:false,error:{code:'unknown'}};
  if(method==='file.read'){
   if(payload.length>32768)return {ok:false,error:{code:'invalid'}};
   return {ok:true,value:{handle:payload.handle,epoch:'server-one',namespace,offset:payload.offset,data:bytes.subarray(payload.offset,payload.offset+payload.length).toString('base64')}};
  }
  throw Error('Unsupported test peer operation');
 }};
 const files=new ManagedFiles({channel,cwd:'/work',namespace}),opened=await files.openBinaryReader('source.txt',undefined,context);
 assert.equal(opened.ok,true);const reader=opened.value;
 try{const result=await reader.read(0,bytes.length,context);assert.equal(result.ok,true);assert.deepEqual(Buffer.from(result.value),bytes);lost=true;const stale=await reader.read(0,3,context);assert.equal(stale.ok,false);assert.equal(stale.error.code,'unknown');}
 finally{await reader.close(context);}
});

test('SDK line scanning counts decoded UTF-8 bytes while retaining raw file positions and the initial BOM rule',async()=>{
 const bytes=Buffer.from([0xef,0xbb,0xbf,0xe7,0x94,0xb2,10,66,255,10,116,97,105,108]),namespace='termux:fixture';
 const metadata={name:'source.txt',path:'/work/source.txt',kind:'file',size:14,mtimeMs:1};
 const channel={async request(method,payload){
  if(method==='file.open')return {ok:true,value:{handle:'lines',epoch:'one',namespace,info:metadata}};
  if(method==='file.info')return {ok:true,value:metadata};
  if(method==='file.close')return {ok:true,value:null};
  if(method==='file.read')return {ok:true,value:{handle:'lines',epoch:'one',namespace,offset:payload.offset,data:bytes.subarray(payload.offset,payload.offset+payload.length).toString('base64')}};
  throw Error('Unsupported test operation');
 }};
 const files=new ManagedFiles({channel,cwd:'/work',namespace}),opened=await files.openBinaryReader('source.txt',undefined,context);assert.equal(opened.ok,true);
 try{
  const scan=await opened.value.scanLines({startLine:1,endLine:2},context);assert.equal(scan.ok,true);
  assert.deepEqual(scan.value,{newlines:2,start:7,end:9,firstLineEnd:9,lastLineStart:7,selectedBytes:4,firstLineBytes:4});
  const full=await opened.value.scanLines({startLine:0},context);assert.equal(full.ok,true);assert.equal(full.value.selectedBytes,13);assert.equal(full.value.firstLineBytes,3);
 }finally{await opened.value.close(context);}
});
