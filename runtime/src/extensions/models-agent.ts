import {defineExtension,defineTool} from '@earendil-works/pi-durable';
import {obj,str} from '@earendil-works/pi-schema';
import type {Routing} from '../routing.js';
const output=(value:unknown)=>({output:[{type:'text' as const,text:JSON.stringify(value)}]});
export function modelsAgent(request:(method:string,payload?:Record<string,unknown>)=>Promise<unknown>,routing:()=>Routing){return defineExtension({name:'app.models',sections:[{key:'model_configuration',render:()=> '模型设置工具只使用公开配置，不读取、索要或输出 API Key。只有用户明确要求时更改当前会话模型；默认模型与当前会话模型不同。'}],tools:[
 defineTool({name:'model_configuration',description:'查看公开模型连接、默认模型和凭据是否已配置；不返回 API Key。',parameters:obj({}),replay:'safe',execute:async()=>output(await request('models.get'))}),
 defineTool({name:'model_select_current',description:'按用户明确要求更改当前产品会话的模型，后续尝试生效。',parameters:obj({provider:str(),modelId:str()}),replay:'safe',execute:async(selection,api,context)=>{const source=await routing().origin(api,context);await routing().guard(source);await api.commit(()=>{},context);return output(await request('models.select',{id:source.id,selection}));}}),
 ]});}
