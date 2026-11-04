import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {defineTool} from '@earendil-works/pi-durable';
import {obj,str} from '@earendil-works/pi-schema';
import {getOrThrow} from '@earendil-works/pi-durable/env';
import type {ManagedExecution} from './managed-execution.js';

export const FILE_CONFORMANCE_NAMES=[
 'binary reader reads byte ranges of the opened file',
 'binary reader scans lines like decoding the whole file',
 'binary reader keeps reading the file it opened after a rename',
 'directory reader refuses missing paths and files',
] as const;
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');

/** Debug-only fixed tool; every file and command goes through the actual adopted ExecutionEnv. */
export function fileConformanceTool(execution:ManagedExecution){return execution.wrapTool(defineTool({
 name:'file_contract',description:'Validate fixed original-file operations in a dedicated T10 fixture directory',parameters:obj({run:str(),caseName:str()}),
 execute:async({run,caseName},api,context)=>{
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(run)||!api.env)throw Error('Invalid file fixture');
  const env=api.env,root=`.durableagent-t10-${run}`,path=`${root}/nested/original.bin`;
  if(caseName==='dependency'){
   const artifact='/data/data/com.termux/files/home/.local/share/durableagent-runtime-probe/t10-build-uthash-install02/lookup';
   const bytes=getOrThrow(await env.readBinaryFile(artifact,context));assert.equal(bytes.length,11656);assert.equal(sha(bytes),'e9b291013974011a54775a99e1eb1f7178425c12fd6919f44128abea08b1906b');
   const source=getOrThrow(await env.readBinaryFile(artifact.replace(/lookup$/,'main.c'),context));assert.equal(sha(source),'d5bb1eb860e50a4819f0709062ff1d083627fba44e8f58812d78ba8b999685a4');
   return {output:[{type:'text',text:'FILE-DEPENDENCY-PASS:'+JSON.stringify({path:artifact,bytes:bytes.length,sha256:sha(bytes),sourceSha256:sha(source)})}]};
  }
  if(caseName!=='roundtrip')throw Error('Unknown file fixture');
  const original=Buffer.from([0,255,10,65,0,66,128]),modified=Buffer.from([67,0,255,68,10]);
  getOrThrow(await env.writeFile(path,original,context));assert.deepEqual(Buffer.from(getOrThrow(await env.readBinaryFile(path,context))),original);
  const canonical=getOrThrow(await env.canonicalPath(path,context));let output='';
  const command=getOrThrow(await env.exec(['/data/data/com.termux/files/usr/bin/python','-c',
   "import pathlib,sys,hashlib; p=pathlib.Path(sys.argv[1]); assert p.read_bytes()==bytes([0,255,10,65,0,66,128]); p.write_bytes(bytes([67,0,255,68,10])); print(hashlib.sha256(p.read_bytes()).hexdigest())",canonical],{onOutput:text=>{output+=text;}},context));
  assert.equal(command.exitCode,0);assert.equal(output.trim(),sha(modified));assert.deepEqual(Buffer.from(getOrThrow(await env.readBinaryFile(path,context))),modified);
  getOrThrow(await env.appendFile(path,Buffer.from([88,0]),context));getOrThrow(await env.truncateFile(path,6,context));getOrThrow(await env.flushFile(path,context));
  const reader=getOrThrow(await env.openBinaryReader(path,undefined,context)),destination=`${root}/nested/renamed.bin`,expected=Buffer.from([67,0,255,68,10,88]);
  try{getOrThrow(await env.renameFile(path,destination,context));getOrThrow(await env.writeFile(path,'replacement',context));assert.deepEqual(Buffer.from(getOrThrow(await reader.read(0,100,context))),expected);}finally{await reader.close(context);}
  assert.deepEqual(Buffer.from(getOrThrow(await env.readBinaryFile(destination,context))),expected);
  const info=getOrThrow(await env.fileInfo(destination,context));assert.equal(info.size,expected.length);assert.equal(info.kind,'file');
  const names=getOrThrow(await env.listDir(`${root}/nested`,context)).map(value=>value.name).sort();assert.deepEqual(names,['original.bin','renamed.bin']);
  assert.equal((await env.openBinaryReader(`${root}/missing`,undefined,context)).ok,false);
  const diffPath=`${root}/change.txt`;getOrThrow(await env.writeFile(diffPath,'before\n',context));getOrThrow(await env.writeFile(diffPath,'真实修改-after\n',context));
  const observed:any[]=[];const watcher=getOrThrow(await env.watch([{path:destination,recursive:false}],change=>observed.push(change),context));
  try{getOrThrow(await env.appendFile(destination,'watch',context));const end=Date.now()+5000;while(!observed.some(change=>change.kind==='paths'||change.kind==='overflow')){assert.ok(Date.now()<end,'actual original change was not observed');await new Promise(resolve=>setTimeout(resolve,30));}}finally{await watcher.stop(context);}
  const final=getOrThrow(await env.readBinaryFile(destination,context));assert.deepEqual(Buffer.from(final),Buffer.concat([expected,Buffer.from('watch')]));
  return {output:[{type:'text',text:'FILE-ROUNDTRIP-PASS:'+JSON.stringify({root,canonical,renamed:getOrThrow(await env.canonicalPath(destination,context)),originalReadSha256:sha(original),bashWriteSha256:sha(modified),finalSha256:sha(final),finalBytes:final.length,watchMode:watcher.mode,diffPath,names})}]};
 },
}));}
