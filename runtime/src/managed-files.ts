import type {Context} from '@earendil-works/chord';
import {posix} from 'node:path';
import {FileError,LineScanner,StreamDecoder,type BinaryReader,type DirReader,type TextLineReader,type FileInfo,type FileErrorCode,type Result,type WatchTarget,type FileChange,type FileWatcher} from '@earendil-works/pi-durable/env';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import type {ExecutionChannel} from './execution-channel.js';

const codes=new Set(['aborted','not_found','permission_denied','not_directory','is_directory','invalid','not_supported','unknown']);
const unknown=(path:string)=>new FileError('unknown','文件操作未取得完整、匹配的回执',path);
function info(value:any,path:string):FileInfo{
 if(!value||typeof value.name!=='string'||value.path!==path||!['file','directory','symlink'].includes(value.kind)||!Number.isSafeInteger(value.size)||value.size<0||!Number.isFinite(value.mtimeMs))throw unknown(path);
 return value;
}

/** File capabilities are executed by the identity that owns the files, never by local Node fs. */
export class ManagedFiles {
 constructor(private readonly options:{channel:ExecutionChannel;cwd:string;namespace:string}){}
 async watch(targets:readonly WatchTarget[],onChange:(change:FileChange)=>void,context:Context):Promise<Result<FileWatcher,FileError>>{
  return this.result(this.options.cwd,context,async()=>{
   if(!Array.isArray(targets)||!targets.length||targets.length>32)throw new FileError('invalid','监听目标数量无效');
   const normalized=targets.map(target=>({path:posix.resolve(this.options.cwd,target.path),recursive:target.recursive===true,exclude:{hidden:target.exclude?.hidden===true,names:[...target.exclude?.names??[]]}}));
   for(const target of normalized)if(target.path.includes('\0')||Buffer.byteLength(target.path)>4096||target.exclude.names.length>128||target.exclude.names.some(name=>typeof name!=='string'||!name||name.includes('/')||name.includes('\0')))throw new FileError('invalid','监听目标格式无效');
   const snapshot=async()=>{const reply=await this.call('file.snapshot',{targets:normalized},this.options.cwd,BACKGROUND_CONTEXT);if(reply?.namespace!==this.options.namespace||typeof reply.epoch!=='string'||!reply.epoch||!Array.isArray(reply.snapshots)||reply.snapshots.length!==normalized.length||reply.snapshots.some((entry:any,index:number)=>entry?.path!==normalized[index].path||typeof entry.revision!=='string'||!/^[a-f0-9]{64}$/.test(entry.revision)))throw unknown(this.options.cwd);return reply as {epoch:string;snapshots:{path:string;revision:string}[]};};
   let previous=await snapshot(),active=true,gap=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined;
   const deactivate=()=>{active=false;clearTimeout(timer);context.abortSignal?.removeEventListener('abort',abort);};
   const emit=(event:FileChange)=>{if(!active)return;try{onChange(event);}catch{deactivate();}};
   const poll=async()=>{try{const current=await snapshot();if(!active)return;if(gap||current.epoch!==previous.epoch)emit({kind:'overflow'});else{const paths=current.snapshots.filter((entry,index)=>entry.revision!==previous.snapshots[index].revision).map(entry=>entry.path);if(paths.length)emit({kind:'paths',paths});}previous=current;gap=false;}
    catch(error){if(!active)return;if(error instanceof FileError&&['invalid','not_supported'].includes(error.code)){emit({kind:'failed',error});deactivate();}else if(!gap){gap=true;emit({kind:'overflow'});}}
    finally{if(active)timer=setTimeout(()=>{inFlight=poll();},500);}};
   const stop=async()=>{deactivate();await inFlight;},abort=()=>{void stop();};
   context.abortSignal?.addEventListener('abort',abort,{once:true});if(context.abortSignal?.aborted)await stop();else timer=setTimeout(()=>{inFlight=poll();},500);
   return {mode:'polling',stop};
  });
 }
 async fileInfo(path:string,context:Context):Promise<Result<FileInfo,FileError>>{
  const absolute=posix.resolve(this.options.cwd,path);return this.result(absolute,context,async()=>info(await this.call('file.stat',{path:absolute},absolute,context),absolute));
 }
 async exists(path:string,context:Context):Promise<Result<boolean,FileError>>{
  const result=await this.fileInfo(path,context);return result.ok?{ok:true,value:true}:result.error.code==='not_found'?{ok:true,value:false}:result;
 }
 async canonicalPath(path:string,context:Context):Promise<Result<string,FileError>>{const absolute=posix.resolve(this.options.cwd,path);return this.result(absolute,context,async()=>{const actual=await this.call('file.canonical',{path:absolute},absolute,context);if(typeof actual!=='string'||!posix.isAbsolute(actual))throw unknown(absolute);return actual;});}
 async openDirReader(path:string,context:Context):Promise<Result<DirReader,FileError>>{
  const absolute=posix.resolve(this.options.cwd,path);return this.result(absolute,context,async()=>{
   const opened=await this.call('file.openDir',{path:absolute},absolute,context);
   if(opened?.namespace!==this.options.namespace||typeof opened.handle!=='string'||!opened.handle||typeof opened.epoch!=='string'||!opened.epoch)throw unknown(absolute);
   let closed=false;return {next:(maxEntries,current)=>this.result(absolute,current,async()=>{
    if(closed)throw new FileError('invalid','目录读取已关闭',absolute);if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>10000)throw new FileError('invalid','目录页大小无效',absolute);
    const entries:FileInfo[]=[];let done=false,bytes=0;
    while(entries.length<maxEntries&&!done){const count=Math.min(128,maxEntries-entries.length),page=await this.call('file.readDir',{handle:opened.handle,maxEntries:count},absolute,current);
     if(page?.namespace!==this.options.namespace||page.handle!==opened.handle||page.epoch!==opened.epoch||typeof page.done!=='boolean'||!Array.isArray(page.entries)||page.entries.length>count||!page.done&&!page.entries.length)throw unknown(absolute);
     for(const entry of page.entries){if(typeof entry?.name!=='string'||!entry.name||['.','..'].includes(entry.name)||entry.name.includes('/')||entry.name.includes('\0'))throw unknown(absolute);const metadata=info(entry,posix.join(absolute,entry.name));bytes+=Buffer.byteLength(JSON.stringify(metadata));if(bytes>4*1024*1024)throw new FileError('not_supported','目录页超过有界读取大小',absolute);entries.push(metadata);}done=page.done;
    }
    return {entries,done};
   }),close:async()=>{if(closed)return;closed=true;await this.call('file.close',{handle:opened.handle},absolute,BACKGROUND_CONTEXT).catch(()=>{});}};
  });
 }
 async listDir(path:string,context:Context):Promise<Result<FileInfo[],FileError>>{
  const opened=await this.openDirReader(path,context);if(!opened.ok)return opened;
  try{return await this.result(path,context,async()=>{const entries:FileInfo[]=[];let bytes=0;for(;;){const page=await opened.value.next(128,context);if(!page.ok)throw page.error;for(const entry of page.value.entries){bytes+=Buffer.byteLength(JSON.stringify(entry));if(entries.length>=10000||bytes>4*1024*1024)throw new FileError('not_supported','目录集合超过有界读取大小，请用目录分页',path);entries.push(entry);}if(page.value.done)return entries;}});}finally{await opened.value.close(BACKGROUND_CONTEXT);}
 }
 async readBinaryFile(path:string,context:Context):Promise<Result<Uint8Array,FileError>>{
  const opened=await this.openBinaryReader(path,undefined,context);if(!opened.ok)return opened;
  try{return await this.result(path,context,async()=>{const before=await opened.value.info(context);if(!before.ok)throw before.error;
   if(before.value.size>16*1024*1024)throw new FileError('not_supported','整文件读取超过 16 MiB；请使用分段 reader',path);
   const bytes=Buffer.alloc(before.value.size);let offset=0;
   while(offset<bytes.length){const part=await opened.value.read(offset,Math.min(32768,bytes.length-offset),context);if(!part.ok)throw part.error;if(!part.value.length)throw unknown(path);bytes.set(part.value,offset);offset+=part.value.length;}
   const after=await opened.value.info(context);if(!after.ok)throw after.error;if(after.value.size!==before.value.size||after.value.mtimeMs!==before.value.mtimeMs)throw unknown(path);
   return bytes;
  });}finally{await opened.value.close(BACKGROUND_CONTEXT);}
 }
 async readTextFile(path:string,context:Context):Promise<Result<string,FileError>>{const result=await this.readBinaryFile(path,context);return result.ok?{ok:true,value:Buffer.from(result.value).toString('utf8')}:result;}
 async openTextLineReader(path:string,context:Context):Promise<Result<TextLineReader,FileError>>{
  const opened=await this.openBinaryReader(path,undefined,context);if(!opened.ok)return opened;
  let closed=false,ended=false,offset=0,buffered='';const decoder=new StreamDecoder(),binary=opened.value;
  return {ok:true,value:{readLine:current=>this.result(path,current,async()=>{
   if(closed)throw new FileError('invalid','文本读取已关闭',path);
   for(;;){const newline=buffered.indexOf('\n');if(newline>=0){const text=buffered.slice(0,newline);buffered=buffered.slice(newline+1);return {text,terminated:true};}
    if(ended){if(!buffered)return undefined;const text=buffered;buffered='';return {text,terminated:false};}
    if(Buffer.byteLength(buffered)>4*1024*1024)throw new FileError('not_supported','单行文本超过有界读取大小',path);
    const page=await binary.read(offset,32768,current);if(!page.ok)throw page.error;offset+=page.value.length;
    if(!page.value.length){buffered+=decoder.decode();ended=true;}else buffered+=decoder.decode(page.value);
   }
  }),close:async()=>{if(closed)return;closed=true;buffered='';await binary.close(BACKGROUND_CONTEXT);}}};
 }
 async readTextLines(path:string,options:{maxLines?:number}|undefined,context:Context):Promise<Result<string[],FileError>>{
  if(options?.maxLines!==undefined&&options.maxLines<=0)return {ok:true,value:[]};
  const opened=await this.openTextLineReader(path,context);if(!opened.ok)return opened;
  try{return await this.result(path,context,async()=>{const lines:string[]=[];let bytes=0;while(options?.maxLines===undefined||lines.length<options.maxLines){const next=await opened.value.readLine(context);if(!next.ok)throw next.error;if(next.value===undefined)break;bytes+=Buffer.byteLength(next.value.text)+1;if(bytes>16*1024*1024||lines.length>=100000)throw new FileError('not_supported','文本集合超过有界读取大小',path);lines.push(next.value.text);}return lines;});}
  finally{await opened.value.close(BACKGROUND_CONTEXT);}
 }
 private async result<T>(path:string,context:Context,action:()=>Promise<T>):Promise<Result<T,FileError>>{
  try{context.abortSignal?.throwIfAborted();return {ok:true,value:await action()};}
  catch(error){return {ok:false,error:context.abortSignal?.aborted?new FileError('aborted','文件操作已取消',path):error instanceof FileError?error:unknown(path)};}
 }
 private async call(method:string,payload:Record<string,unknown>,path:string,context:Context):Promise<any>{
  context.abortSignal?.throwIfAborted();const reply=await this.options.channel.request(method,payload);context.abortSignal?.throwIfAborted();
  if(reply.ok===true&&Object.hasOwn(reply,'value'))return reply.value;
  const code=(reply.error as any)?.code;
  if(reply.ok===false&&codes.has(code))throw new FileError(code as FileErrorCode,`文件操作未完成（${code}）`,path);
  throw unknown(path);
 }
 async openBinaryReader(path:string,options:{noFollow?:boolean}|undefined,context:Context):Promise<Result<BinaryReader,FileError>>{
  const absolute=posix.resolve(this.options.cwd,path);
  return this.result(absolute,context,async()=>{
   const opened=await this.call('file.open',{path:absolute,noFollow:options?.noFollow??false},absolute,context);
   if(opened?.namespace!==this.options.namespace||typeof opened.handle!=='string'||!opened.handle||typeof opened.epoch!=='string'||!opened.epoch)throw unknown(absolute);
   info(opened.info,absolute);let closed=false;
   const ensure=()=>{if(closed)throw unknown(absolute);};
   const reader:BinaryReader={
    info:current=>this.result(absolute,current,async()=>{ensure();return info(await this.call('file.info',{handle:opened.handle},absolute,current),absolute);}),
    read:(offset,length,current)=>this.result(absolute,current,async()=>{
     ensure();if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>4*1024*1024||!Number.isSafeInteger(offset+length))throw new FileError('invalid','读取位置或单次读取大小超出支持范围',absolute);
     const bytes=Buffer.alloc(length);let taken=0;
     while(taken<length){const requested=Math.min(32768,length-taken),reply=await this.call('file.read',{handle:opened.handle,offset:offset+taken,length:requested},absolute,current);
      if(reply?.handle!==opened.handle||reply.epoch!==opened.epoch||reply.namespace!==this.options.namespace||reply.offset!==offset+taken||typeof reply.data!=='string')throw unknown(absolute);
      const chunk=Buffer.from(reply.data,'base64');if(chunk.length>requested||chunk.toString('base64')!==reply.data)throw unknown(absolute);
      bytes.set(chunk,taken);taken+=chunk.length;if(chunk.length<requested)break;
     }
     return bytes.subarray(0,taken);
    }),
    scanLines:(selection,current)=>this.result(absolute,current,async()=>{
     ensure();if(!Number.isSafeInteger(selection.startLine)||selection.startLine<0||selection.endLine!==undefined&&(!Number.isSafeInteger(selection.endLine)||selection.endLine<=selection.startLine))throw new FileError('invalid','行范围无效',absolute);
     const metadata=await reader.info(current);if(!metadata.ok)throw metadata.error;
     const scanner=new LineScanner(selection.startLine,selection.endLine);let offset=0;
     while(offset<metadata.value.size){const page=await reader.read(offset,Math.min(32768,metadata.value.size-offset),current);if(!page.ok)throw page.error;if(!page.value.length)break;scanner.push(page.value);offset+=page.value.length;}
     return scanner.finish();
    }),
    close:async()=>{if(closed)return;closed=true;await this.call('file.close',{handle:opened.handle},absolute,BACKGROUND_CONTEXT).catch(()=>{});}
   };
   return reader;
  });
 }
}
