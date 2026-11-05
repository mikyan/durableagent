import {defineExtension,defineTool} from '@earendil-works/pi-durable';
import {obj,str} from '@earendil-works/pi-schema';
import type {Routing} from '../routing.js';
const output=(value:unknown)=>({output:[{type:'text' as const,text:JSON.stringify(value)}]});
export function routingAgent(get:()=>Routing){return defineExtension({name:'app.routing',
 sections:[{key:'explicit_routing',render:()=> '处理当前会话的普通输入。只有用户明确要求查询、创建或转交其他会话时才使用 conversation_* 工具。目标必须使用稳定 id，同名标题不能代替 id。转交只包含用户明确指定的正文，不复制来源会话全部上下文。接纳不是执行完成。'}],
 tools:[
  defineTool({name:'conversation_list',description:'列出产品会话稳定 ID、标题和公开状态；不读取历史。同名时用 ID 区分。cursor 为空从第一页开始。',parameters:obj({cursor:str()}),replay:'safe',execute:async({cursor})=>output(await get().list(cursor||undefined))}),
  defineTool({name:'conversation_status',description:'按稳定产品会话 ID 查询另一会话的摘要、位置预期与控制状态，不读取其历史。',parameters:obj({id:str()}),replay:'safe',execute:async({id})=>output(await get().query(id))}),
  defineTool({name:'conversation_create',description:'仅在用户明确要求时创建产品会话，返回稳定会话身份。',parameters:obj({title:str()}),replay:'safe',execute:async({title},api,context)=>{
   const source=await get().origin(api,context);await api.commit(()=>{},context);return output(await get().create({source,creationId:`tool-create-${api.taskId}`,title}));
  }}),
  defineTool({name:'conversation_transfer',description:'将明确正文交给指定稳定产品会话 ID；不改变目标草稿。返回可靠接纳身份，不能据此声称对方已经完成。',parameters:obj({id:str(),text:str()}),replay:'safe',execute:async(args,api,context)=>{
   const routing=get(),source=await routing.origin(api,context);let request=await api.memo<any>('app.route-request',context);
   if(!request){const target=await routing.query(args.id);request=await api.memo('app.route-request',{actionId:`tool-route-${api.taskId}`,source,id:args.id,text:args.text,expectedContext:target.context,expectedControlVersion:target.control.version},context);}
   await api.commit(()=>{},context);return output(await routing.send(request));
  }}),
 ]});}
