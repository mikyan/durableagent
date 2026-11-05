import {createHash} from 'node:crypto';
import type {ImageContent,TextContent,Model,Api} from '@earendil-works/pi-ai';
import {INPUT_BUDGETS,type FrozenInputAccess,type InputCapability,type InputRepresentation} from './input-protocol.js';

export class InputError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new InputError(code,message);};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function frozenInputDigest(text:string,representations:InputRepresentation[]):string {
  const fields=[text,String(representations.length),...representations.flatMap(item=>[item.kind,item.mimeType,item.sha256,String(item.byteLength),item.range])];
  const hash=createHash('sha256').update('input-v1\n');
  for(const value of fields){const bytes=Buffer.from(value,'utf8');hash.update(String(bytes.length)+':').update(bytes);}
  return hash.digest('hex');
}
/** Catalog declaration only: preparing an attachment does not contact or authenticate a Provider. */
export function inputCapability(model:Model<Api>,source:InputCapability['source']):InputCapability {
  const image=model.inputLimits?.images,limits={maxRequestBytes:model.inputLimits?.maxRequestBytes,maxImages:Math.min(image?.maxPerMessage??Infinity,image?.maxPerRequest??Infinity),maxWidth:image?.resize?.maxWidth,maxHeight:image?.resize?.maxHeight,maxBase64Bytes:image?.resize?.maxBytes};
  if(!Number.isFinite(limits.maxImages))delete (limits as {maxImages?:number}).maxImages;
  const value={provider:model.provider,modelId:model.id,input:model.input.filter(value=>value==='text'||value==='image') as ('text'|'image')[],source,limits,applicationPolicy:INPUT_BUDGETS};
  return {...value,version:sha(JSON.stringify(value))};
}
/** Only immutable native objects are read here. The source URI is deliberately unavailable. */
export async function materializeFrozenInput(access:FrozenInputAccess,token:string,id:string,model:Pick<Model<Api>,'provider'|'id'|'input'|'inputLimits'>):Promise<(TextContent|ImageContent)[]> {
  const input=await access.readFrozen(token);
  if(input.token!==token||input.id!==id)fail('INPUT_TARGET_MISMATCH','固定输入不属于当前会话');
  if(!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.text!=='string'||input.text.length>INPUT_BUDGETS.draftCharacters||!Array.isArray(input.representations)||input.representations.length>INPUT_BUDGETS.attachments)fail('INPUT_INVALID','固定输入记录无效');
  if(frozenInputDigest(input.text,input.representations)!==input.digest)fail('INPUT_DIGEST_MISMATCH','固定输入摘要不匹配，请保留草稿并重新准备');
  const images=input.representations.filter(item=>item.kind==='image'),imageLimits=model.inputLimits?.images;
  if(images.length&&!model.input.includes('image'))fail('IMAGE_UNSUPPORTED','当前模型未声明支持图片，请改选模型或移除图片');
  if(images.length>Math.min(imageLimits?.maxPerMessage??Infinity,imageLimits?.maxPerRequest??Infinity))fail('INPUT_BUDGET_EXCEEDED','图片数量超过当前模型限制');
  let base64Total=0;const content:(TextContent|ImageContent)[]=[];
  if(input.text)content.push({type:'text',text:input.text});
  for(const item of input.representations){
    if(item.range!=='full'||!['image','text'].includes(item.kind)||!Number.isSafeInteger(item.byteLength)||item.byteLength<0||!/^[a-f0-9]{64}$/.test(item.sha256))fail('INPUT_INVALID','附件表示无效');
    const maximum=item.kind==='image'?INPUT_BUDGETS.imageBytes:INPUT_BUDGETS.textBytes;
    if(item.byteLength>maximum)fail('INPUT_BUDGET_EXCEEDED','附件表示超过应用预算，请明确缩小后重新准备');
    if(item.kind==='image'){
      const width=item.width??0,height=item.height??0;
      if(!['image/png','image/jpeg'].includes(item.mimeType)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)fail('INPUT_INVALID','图片表示缺少有效类型或尺寸');
      const encoded=4*Math.ceil(item.byteLength/3);base64Total+=encoded;
      if(encoded>(imageLimits?.resize?.maxBytes??Infinity)||width>Math.min(INPUT_BUDGETS.imageWidth,imageLimits?.resize?.maxWidth??Infinity)||height>Math.min(INPUT_BUDGETS.imageHeight,imageLimits?.resize?.maxHeight??Infinity)||base64Total>INPUT_BUDGETS.totalBase64Bytes)fail('INPUT_BUDGET_EXCEEDED','固定图片不符合当前模型预算，原版本已保留，请重新准备');
    }else if(item.mimeType!=='text/plain')fail('INPUT_INVALID','文本表示类型无效');
    const bytes=await access.readObject(token,item.objectId);
    if(bytes.byteLength!==item.byteLength||sha(bytes)!==item.sha256)fail('INPUT_OBJECT_CHANGED','已固定的附件内容缺失或损坏，请保留草稿并重新选择');
    if(item.kind==='image')content.push({type:'image',mimeType:item.mimeType,data:Buffer.from(bytes).toString('base64')});
    else {let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{return fail('INPUT_INVALID','附件不是完整有效的 UTF-8 文本');}content.push({type:'text',text});}
  }
  if(!content.length)fail('EMPTY_INPUT','请输入文字或准备附件');
  return content;
}

/** Guard the actual serialized body, including prior history and JSON/base64 expansion. */
export type ProviderInputEvidence={serializedBytes:number;images:{sha256:string;byteLength:number;mimeType:string}[];textParts:{sha256:string;byteLength:number}[]};
/** Conservative context ceiling before the SDK constructs another full serialized request. */
export function validateContextBudget(value:unknown):void {
  let bytes=0;const ancestors=new Set<object>();
  const charge=(count:number)=>{bytes+=count;if(bytes>INPUT_BUDGETS.requestBytes)fail('INPUT_CONTEXT_BUDGET','模型上下文在编码前已超过本地预算，请保留原会话并缩小输入或开启新会话');};
  const string=(value:string)=>{
    if(value.length>INPUT_BUDGETS.requestBytes-bytes)charge(value.length);
    charge(2);
    for(let i=0;i<value.length;i++){
      const code=value.charCodeAt(i);
      if(code===34||code===92)charge(2);
      else if(code<32)charge(6);
      else if(code<128)charge(1);
      else if(code<2048)charge(2);
      else if(code>=0xd800&&code<=0xdbff&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){charge(4);i++;}
      else charge(code>=0xd800&&code<=0xdfff?6:3);
    }
  };
  const walk=(item:unknown,depth:number)=>{
    if(depth>128)fail('INPUT_CONTEXT_BUDGET','模型上下文在编码前超过嵌套预算');
    if(typeof item==='string'){string(item);return;}
    if(item===null||typeof item==='boolean'||typeof item==='number'){charge(String(item).length);return;}
    if(typeof item!=='object')return;
    if(ancestors.has(item))fail('INPUT_INVALID','模型上下文包含循环引用');ancestors.add(item);charge(2);
    if(Array.isArray(item)){for(const value of item){charge(1);walk(value,depth+1);}}
    else for(const key in item)if(Object.hasOwn(item,key)){string(key);charge(2);walk((item as Record<string,unknown>)[key],depth+1);}
    ancestors.delete(item);
  };
  walk(value,0);
}
export async function validateProviderInput(request:Request,model:Model<Api>):Promise<ProviderInputEvidence> {
  const maximum=Math.min(INPUT_BUDGETS.requestBytes,model.inputLimits?.maxRequestBytes??Infinity);
  const reader=request.clone().body?.getReader();if(!reader)return {serializedBytes:0,images:[],textParts:[]}; // A deferred poll may have no new input body.
  const chunks:Uint8Array[]=[];let length=0;
  try {while(true){const item=await reader!.read();if(item.done)break;length+=item.value.length;if(length>maximum)fail('INPUT_BUDGET_EXCEEDED','完整模型请求超过应用或模型大小预算，请缩小输入或开启新会话');chunks.push(item.value);}}
  finally {void reader!.cancel().catch(()=>{});}
  let body:any;try{body=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));}catch{return fail('INPUT_INVALID','模型请求格式无效');}
  const limits=model.inputLimits?.images;let total=0;const evidence:ProviderInputEvidence={serializedBytes:length,images:[],textParts:[]};
  for(const message of body.messages??[]){
    const texts=typeof message.content==='string'?[message.content]:Array.isArray(message.content)?message.content.filter((part:any)=>part.type==='text'&&typeof part.text==='string').map((part:any)=>part.text):[];
    for(const text of texts){const bytes=Buffer.from(text,'utf8');evidence.textParts.push({sha256:sha(bytes),byteLength:bytes.length});}
    const images=Array.isArray(message.content)?message.content.filter((part:any)=>part.type==='image_url'):[];total+=images.length;
    if(images.length&&!model.input.includes('image'))fail('IMAGE_UNSUPPORTED','当前模型未声明支持图片，请更换模型或开启不含图片的新会话');
    if(images.length>(limits?.maxPerMessage??Infinity)||total>(limits?.maxPerRequest??Infinity))fail('INPUT_BUDGET_EXCEEDED','完整模型上下文中的图片数量超过所选模型限制');
    for(const image of images){
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(image.image_url?.url??'');
      if(!match||match[2].length%4)fail('INPUT_INVALID','图片必须是已准备的 PNG 或 JPEG 固定内容');
      const encoded=match![2],bytes=Buffer.from(encoded,'base64');
      if(bytes.toString('base64')!==encoded)fail('INPUT_INVALID','图片编码无效');
      if(bytes.length>INPUT_BUDGETS.imageBytes||encoded.length>(limits?.resize?.maxBytes??Infinity))fail('INPUT_BUDGET_EXCEEDED','模型上下文中的固定图片超过当前大小预算，请保留原会话并重新准备');
      const dimensions=imageDimensions(bytes,match![1]);
      if(!dimensions)return fail('INPUT_INVALID','模型上下文中的图片头无效');
      if(dimensions.width>Math.min(INPUT_BUDGETS.imageWidth,limits?.resize?.maxWidth??Infinity)||dimensions.height>Math.min(INPUT_BUDGETS.imageHeight,limits?.resize?.maxHeight??Infinity))fail('INPUT_BUDGET_EXCEEDED','模型上下文中的固定图片尺寸超过当前预算，请重新准备');
      evidence.images.push({sha256:sha(bytes),byteLength:bytes.length,mimeType:match![1]});
    }
  }
  return evidence;
}
function imageDimensions(bytes:Buffer,mimeType:string):{width:number;height:number}|undefined {
  if(mimeType==='image/png')return bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'?{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}:undefined;
  if(bytes[0]!==255||bytes[1]!==216)return;
  let offset=2;
  while(offset+4<=bytes.length){
    if(bytes[offset++]!==255)return;while(bytes[offset]===255)offset++;
    const marker=bytes[offset++];if(marker===217||marker===218)return;
    if(marker===1||marker>=208&&marker<=215)continue;
    if(offset+2>bytes.length)return;const length=bytes.readUInt16BE(offset);
    if(length<2||offset+length>bytes.length)return;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return length>=7?{height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)}:undefined;
    offset+=length;
  }
}
