import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {ManagedFiles} from '../dist/managed-files.js';

test('polling watch establishes a snapshot, reports reconnect overflow and stops callbacks before returning',async()=>{
 let revision='a'.repeat(64),epoch='server-one',disconnected=false,calls=0;const events=[];
 const files=new ManagedFiles({cwd:'/work',namespace:'termux:watch',channel:{request:async(method,payload)=>{assert.equal(method,'file.snapshot');assert.deepEqual(payload.targets,[{path:'/work/tree',recursive:true,exclude:{hidden:true,names:['ignored']}}]);calls++;if(disconnected)throw Error('connection lost');return {ok:true,value:{namespace:'termux:watch',epoch,snapshots:[{path:'/work/tree',revision}]}};}}});
 const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20));}};
 const opened=await files.watch([{path:'tree',recursive:true,exclude:{hidden:true,names:['ignored']}}],event=>events.push(event),context);assert.equal(opened.ok,true);assert.equal(opened.value.mode,'polling');assert.equal(calls,1);assert.deepEqual(events,[]);
 try{revision='b'.repeat(64);await until(()=>events.some(event=>event.kind==='paths'));assert.deepEqual(events.find(event=>event.kind==='paths').paths,['/work/tree']);disconnected=true;await until(()=>events.some(event=>event.kind==='overflow'));disconnected=false;epoch='server-two';await until(()=>events.filter(event=>event.kind==='overflow').length>=2);}
 finally{await opened.value.stop(context);}
 const stoppedCalls=calls,stoppedEvents=events.length;revision='c'.repeat(64);await new Promise(resolve=>setTimeout(resolve,650));assert.equal(calls,stoppedCalls);assert.equal(events.length,stoppedEvents);
});

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
 await reader.close(context);
 for(const result of [await reader.read(0,1,context),await reader.info(context),await reader.scanLines({startLine:0},context)]){assert.equal(result.ok,false);assert.equal(result.error.code,'invalid','explicit close is a known invalid handle, distinct from remote loss');}
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

test('text line readers preserve CR and report final LF termination while decoding split UTF-8 once',async()=>{
 const prefix='a'.repeat(32763),bytes=Buffer.concat([Buffer.from('\ufeff'+prefix+'甲\r\n尾'),Buffer.from([255])]),namespace='termux:fixture';
 const metadata={name:'lines.txt',path:'/work/lines.txt',kind:'file',size:bytes.length,mtimeMs:1};
 const channel={async request(method,payload){
  if(method==='file.open')return {ok:true,value:{handle:'text',epoch:'one',namespace,info:metadata}};
  if(method==='file.info')return {ok:true,value:metadata};
  if(method==='file.close')return {ok:true,value:null};
  if(method==='file.read')return {ok:true,value:{handle:'text',epoch:'one',namespace,offset:payload.offset,data:bytes.subarray(payload.offset,payload.offset+payload.length).toString('base64')}};
  throw Error('Unsupported test operation');
 }};
 const files=new ManagedFiles({channel,cwd:'/work',namespace}),opened=await files.openTextLineReader('lines.txt',context);assert.equal(opened.ok,true);
 try{
  assert.deepEqual(await opened.value.readLine(context),{ok:true,value:{text:prefix+'甲\r',terminated:true}});
  assert.deepEqual(await opened.value.readLine(context),{ok:true,value:{text:'尾�',terminated:false}});
  assert.deepEqual(await opened.value.readLine(context),{ok:true,value:undefined});
 }finally{await opened.value.close(context);}
 const closed=await opened.value.readLine(context);assert.equal(closed.ok,false);assert.equal(closed.error.code,'invalid');
 assert.deepEqual(await files.readTextLines('lines.txt',{maxLines:1},context),{ok:true,value:[prefix+'甲\r']});
});

test('whole-file binary and text reads keep source bytes and report their supported memory bound',async()=>{
 const bytes=Buffer.from([0xef,0xbb,0xbf,0xe7,0x94,0xb2,0xff]),namespace='termux:fixture';let oversized=false;
 const metadata=()=>({name:'source.bin',path:'/work/source.bin',kind:'file',size:oversized?16*1024*1024+1:bytes.length,mtimeMs:1});
 const channel={async request(method,payload){
  if(method==='file.open')return {ok:true,value:{handle:'whole',epoch:'one',namespace,info:metadata()}};
  if(method==='file.info')return {ok:true,value:metadata()};
  if(method==='file.close')return {ok:true,value:null};
  if(method==='file.read')return {ok:true,value:{handle:'whole',epoch:'one',namespace,offset:payload.offset,data:bytes.subarray(payload.offset,payload.offset+payload.length).toString('base64')}};
  throw Error('Unsupported test operation');
 }};
 const files=new ManagedFiles({channel,cwd:'/work',namespace});
 const binary=await files.readBinaryFile('source.bin',context);assert.equal(binary.ok,true);assert.deepEqual(Buffer.from(binary.value),bytes);
 assert.deepEqual(await files.readTextFile('source.bin',context),{ok:true,value:'\ufeff甲�'});
 oversized=true;const tooBig=await files.readBinaryFile('source.bin',context);assert.equal(tooBig.ok,false);assert.equal(tooBig.error.code,'not_supported');
});

test('SDK directory pages keep the authenticated handle and combine bounded transport pages without reopening',async()=>{
 const namespace='termux:fixture',entries=Array.from({length:150},(_,index)=>({name:`${index}.txt`,path:`/work/entries/${index}.txt`,kind:'file',size:4,mtimeMs:1}));let cursor=0,lost=false;
 const channel={async request(method,payload){
  if(method==='file.openDir'){cursor=0;return {ok:true,value:{handle:'directory',epoch:'one',namespace}};}
  if(method==='file.close')return {ok:true,value:null};
  if(method==='file.readDir'){if(lost)return {ok:false,error:{code:'unknown'}};assert.ok(payload.maxEntries<=128);const page=entries.slice(cursor,cursor+payload.maxEntries);cursor+=page.length;return {ok:true,value:{handle:'directory',epoch:'one',namespace,entries:page,done:cursor===entries.length}};}
  throw Error('Unexpected directory operation');
 }};
 const files=new ManagedFiles({channel,cwd:'/work',namespace}),opened=await files.openDirReader('entries',context);assert.equal(opened.ok,true);
 try{const first=await opened.value.next(140,context);assert.equal(first.ok,true);assert.equal(first.value.entries.length,140);assert.equal(first.value.done,false);assert.equal(first.value.entries[139].name,'139.txt');
  const end=await opened.value.next(140,context);assert.equal(end.ok,true);assert.equal(end.value.entries.length,10);assert.equal(end.value.done,true);
  lost=true;const stale=await opened.value.next(1,context);assert.equal(stale.ok,false);assert.equal(stale.error.code,'unknown');
 }finally{await opened.value.close(context);}
});
