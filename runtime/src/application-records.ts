import {defineDoc} from '@earendil-works/pi-durable';
import type {ModelSelection} from './application-protocol.js';
export type ProductRecord={id:string;sdkId:number;title:string;workspaceId:string;projectId?:string|null;associationVersion?:number;createdAt:number};
type StoredConfiguration={initialized:boolean;defaultModel:ModelSelection|null;workspace:{id:string;path:string};dataPolicy:'local-required-v1'};
export function validateConfiguration(value:StoredConfiguration):void {
  if(typeof value.initialized!=='boolean'||typeof value.workspace?.id!=='string'||typeof value.workspace?.path!=='string'||value.dataPolicy!=='local-required-v1'||value.defaultModel!==null&&(!value.defaultModel||typeof value.defaultModel.provider!=='string'||typeof value.defaultModel.modelId!=='string'||typeof value.defaultModel.name!=='string'))throw new Error('APP_MIGRATION_INVALID');
}
export const Configuration=defineDoc({kind:'app.configuration',version:2,scope:'session',initial:():StoredConfiguration=>({initialized:false,defaultModel:null,workspace:{id:'default',path:''},dataPolicy:'local-required-v1'}),migrate:(value,fromVersion):StoredConfiguration=>{
  const old=value as unknown as StoredConfiguration;
  if(fromVersion!==1||typeof old.initialized!=='boolean'||typeof old.workspace?.id!=='string'||typeof old.workspace?.path!=='string'||old.defaultModel!==null&&(!old.defaultModel||typeof old.defaultModel.provider!=='string'||typeof old.defaultModel.modelId!=='string'||typeof old.defaultModel.name!=='string'))throw new Error('APP_MIGRATION_INVALID');
  // A pure value migration; scope/history/fork stay fixed. No effects or input replay.
  return {...old,workspace:{...old.workspace},defaultModel:old.defaultModel?{...old.defaultModel}:null,dataPolicy:'local-required-v1'};
},checkpointWhen:()=>false});
export const Products=defineDoc({kind:'app.product-conversations',version:1,scope:'session',initial:()=>({items:{} as Record<string,ProductRecord>}),checkpointWhen:()=>false});
