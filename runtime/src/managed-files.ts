import type {Context} from '@earendil-works/chord';
import {posix} from 'node:path';
import {FileError,LineScanner,type BinaryReader,type FileInfo,type FileErrorCode,type Result} from '@earendil-works/pi-durable/env';
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
 async fileInfo(path:string,context:Context):Promise<Result<FileInfo,FileError>>{
  const absolute=posix.resolve(this.options.cwd,path);return this.result(absolute,context,async()=>info(await this.call('file.stat',{path:absolute},absolute,context),absolute));
 }
 async exists(path:string,context:Context):Promise<Result<boolean,FileError>>{
  const result=await this.fileInfo(path,context);return result.ok?{ok:true,value:true}:result.error.code==='not_found'?{ok:true,value:false}:result;
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
    close:async current=>{if(closed)return;closed=true;await this.call('file.close',{handle:opened.handle},absolute,current).catch(()=>{});}
   };
   return reader;
  });
 }
}
