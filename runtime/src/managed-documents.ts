import {defineTool,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {obj,str} from '@earendil-works/pi-schema';
import {FileError} from '@earendil-works/pi-durable/env';
import type {Context} from '@earendil-works/chord/context';
import {createHash} from 'node:crypto';
import type {ExecutionChannel} from './execution-channel.js';
import type {DocumentWriteArguments} from './document-writes.js';

const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unknown=()=>new FileError('unknown','授权原件的读取结果尚未核验');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** SAF capabilities retain their URI identity. They are never converted to shell paths. */
export class ManagedDocuments {
 constructor(private readonly channel:ExecutionChannel){}
 writeTool(write:(args:DocumentWriteArguments,api:ToolExecutionApi,context:Context)=>Promise<Record<string,any>>){return defineTool({name:'document_write',description:'Replace the selected authorized original document only when it still matches expectedDigest from document_read. Uses the same durable writer queue as Bash. A missing or changed original is not silently replaced by a local copy.',parameters:obj({resourceId:str(),expectedDigest:str(),content:str()}),execute:async(args,api,context)=>{const receipt=await write(args,api,context);return {output:[{type:'text' as const,text:'原件写入已核验\n'+JSON.stringify({operationId:receipt.operationId,resourceId:receipt.resourceId,uri:receipt.uri,original:true,contentDigest:receipt.contentDigest,byteLength:receipt.byteLength})}]};}});}
 listTool(){return defineTool({name:'document_list',description:'List originals previously selected through the system document picker, including their real URI, resourceId and current access. This does not read document contents. Use an empty cursor for the first page.',parameters:obj({cursor:str()}),execute:async({cursor},_api,context)=>{
  if(cursor&&!digest(cursor))throw new FileError('invalid','原件列表读取位置无效');context.abortSignal?.throwIfAborted();const result=await this.channel.request('list',cursor?{cursor}:{});context.abortSignal?.throwIfAborted();
  if(!Array.isArray(result.resources)||result.resources.length>20||result.nextCursor!==null&&!digest(result.nextCursor)||result.nextCursor===cursor)throw unknown();
  for(const resource of result.resources)if(!digest(resource?.resourceId)||resource.namespace!=='saf:'+resource.resourceId||resource.original!==true||typeof resource.uri!=='string'||!resource.uri.startsWith('content://')||typeof resource.availability!=='string')throw unknown();
  return {output:[{type:'text' as const,text:JSON.stringify(result)}]};
 }});}
 readTool(){return defineTool({name:'document_read',description:'Read an original document selected through the system document picker. Use its resourceId; the result includes the original digest required for a later conditional document_write. A document URI is not a Bash path.',parameters:obj({resourceId:str({description:'Authorized original resourceId shown by the document picker'})}),execute:async(args,_api,context)=>{
  const result=await this.read(args.resourceId,context);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(result.bytes);}catch{throw new FileError('not_supported','此原件为二进制内容，不能作为 UTF-8 文本读取');}if(text.includes('\0'))throw new FileError('not_supported','此原件为二进制内容，不能作为文本读取');
  const content=Buffer.from(text),limited=content.length>32768,shown=limited?new TextDecoder().decode(content.subarray(0,32768),{stream:true}):text;
  return {output:[{type:'text' as const,text:JSON.stringify({resourceId:args.resourceId,uri:result.resource.uri,displayName:result.resource.displayName,original:true,contentDigest:result.contentDigest,byteLength:result.bytes.length,truncated:limited,text:shown})}]};
 }});}
 async read(resourceId:string,context:Context){
  if(!digest(resourceId))throw new FileError('invalid','原件资源身份无效');context.abortSignal?.throwIfAborted();
  const resource=await this.channel.request('describe',{resourceId});if(resource.resourceId!==resourceId||resource.namespace!=='saf:'+resourceId||resource.original!==true||typeof resource.uri!=='string'||!resource.uri.startsWith('content://')||resource.uri.length>4096||typeof resource.displayName!=='string')throw unknown();
  const opened=await this.channel.request('open',{resourceId});if(opened.resourceId!==resourceId||typeof opened.readerId!=='string'||!opened.readerId||opened.readerId.length>128||!digest(opened.contentDigest)||!Number.isSafeInteger(opened.byteLength)||Number(opened.byteLength)<0)throw unknown();
  const readerId=opened.readerId;let closed=false;
  try{if(Number(opened.byteLength)>16*1024*1024)throw new FileError('not_supported','原件整文件读取超过 16 MiB');const bytes=Buffer.alloc(Number(opened.byteLength));let offset=0;
   while(offset<bytes.length){context.abortSignal?.throwIfAborted();const maxBytes=Math.min(32768,bytes.length-offset),page=await this.channel.request('read',{readerId,offset,maxBytes});if(page.offset!==offset||typeof page.base64!=='string'||page.base64.length>45000||!Number.isSafeInteger(page.bytesRead)||Number(page.bytesRead)<1||Number(page.bytesRead)>maxBytes)throw unknown();const data=Buffer.from(page.base64,'base64');if(data.toString('base64')!==page.base64||data.length!==page.bytesRead||page.eof!==(offset+data.length===bytes.length))throw unknown();bytes.set(data,offset);offset+=data.length;}
   const final=await this.channel.request('closeRead',{readerId});closed=true;context.abortSignal?.throwIfAborted();if(final.unchanged!==true||final.currentDigest!==opened.contentDigest||final.byteLength!==bytes.length||sha(bytes)!==opened.contentDigest)throw unknown();return {resource,bytes,contentDigest:opened.contentDigest};
  }finally{if(!closed)await this.channel.request('closeRead',{readerId}).catch(()=>{});}
 }
}
