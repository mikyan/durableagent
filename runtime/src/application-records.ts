import {defineDoc} from '@earendil-works/pi-durable';
import type {ModelSelection} from './application-protocol.js';
export type ProductRecord={id:string;sdkId:number;title:string;workspaceId:string;projectId?:string|null;associationVersion?:number;createdAt:number};
export const Configuration=defineDoc({kind:'app.configuration',version:1,scope:'session',initial:()=>({initialized:false as boolean,defaultModel:null as ModelSelection|null,workspace:{id:'default',path:''}}),checkpointWhen:()=>false});
export const Products=defineDoc({kind:'app.product-conversations',version:1,scope:'session',initial:()=>({items:{} as Record<string,ProductRecord>}),checkpointWhen:()=>false});
