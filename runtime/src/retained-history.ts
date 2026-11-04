import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createHash} from 'node:crypto';
import type {Storage,ConversationId,EntryRecord,Cursor} from '@earendil-works/pi-durable';
import type {ProductRecord} from './application-records.js';
import type {ConversationSummary,HistoryMessage,HistoryPage,ConversationSnapshot} from './application-protocol.js';

/** Read-only fallback over supported public Storage records. No Harness or scheduling entry exists. */
export class RetainedHistory {
 private revision=0;
 private constructor(private readonly storage:Storage,private readonly products:Record<string,ProductRecord>){}
 static async open(storage:Storage):Promise<RetainedHistory|undefined>{
  try {
   const record=await storage.findDocument({kind:'app.product-conversations',scope:{kind:'session'}},'current',context);
   const stored=record&&await storage.document(record.id,'current',context);
   if(!stored||stored.version!==1||!stored.value.items||Array.isArray(stored.value.items)||typeof stored.value.items!=='object')return;
   const products=stored.value.items as unknown as Record<string,ProductRecord>;
   for(const [id,value] of Object.entries(products))if(!value||value.id!==id||!Number.isSafeInteger(value.sdkId)||typeof value.title!=='string'||typeof value.workspaceId!=='string'||!Number.isFinite(value.createdAt)||!await storage.conversation(value.sdkId as ConversationId,context))return;
   return new RetainedHistory(storage,products);
  }catch{return;}
 }
 private product(id:string){const value=this.products[id];if(!value)throw Error('只读记录中没有此会话');return value;}
 private summary(value:ProductRecord):ConversationSummary{return {...value,projectId:value.projectId??null,model:{provider:'',modelId:'',name:'保留记录（只读）'},phase:'waiting'};}
 list(){return {conversations:Object.values(this.products).map(value=>this.summary(value))};}
 private messages(entry:EntryRecord):HistoryMessage[]{return (entry.model??[]).flatMap((message:any,index:number)=>{
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter((item:any)=>item.type==='text').map((item:any)=>item.text).join(''):'';
  const attachments=Array.isArray(message.content)?message.content.filter((item:any)=>item.type==='image').map((item:any)=>{const bytes=Buffer.from(item.data,'base64');return {kind:'image' as const,mimeType:item.mimeType,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}):[];
  return text||attachments.length?[{id:String(entry.id)+(index?':'+index:''),role:message.role==='toolResult'?'tool':message.role,text,persisted:true as const,...(attachments.length?{attachments}:{})}]:[];
 });}
 async history(id:string,cursor?:unknown,limit?:unknown):Promise<HistoryPage>{
  const product=this.product(id);let position:Cursor|undefined;
  if(cursor!==undefined){const decoded=JSON.parse(Buffer.from(String(cursor),'base64url').toString());if(decoded.id!==id||decoded.readOnly!==true)throw Error('只读历史位置不属于此会话');position=decoded.cursor;}
  const size=typeof limit==='number'&&Number.isFinite(limit)?Math.max(1,Math.min(50,Math.floor(limit))):25;
  const page=await this.storage.scanEntries({conversationId:product.sdkId as ConversationId,order:'descending'},size,position,context);
  return {items:[...page.items].reverse().flatMap(entry=>this.messages(entry)),...(page.next?{next:Buffer.from(JSON.stringify({id,readOnly:true,cursor:page.next})).toString('base64url')}:{})};
 }
 async snapshot(id:string):Promise<ConversationSnapshot>{const page=await this.history(id,undefined,30);return {id,revision:++this.revision,conversation:this.summary(this.product(id)),entries:page.items,phase:'waiting',storedSeq:null,reason:'仅展示可核验的保留历史；版本不兼容，运行和新发送保持关闭。'};}
 close(){return this.storage.close(context);}
}
