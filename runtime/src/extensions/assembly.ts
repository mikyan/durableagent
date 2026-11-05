import type {Extension,Registry} from '@earendil-works/pi-durable';
import {validateDescriptors,type ExtensionDescriptor} from '../extension-protocol.js';
export type AgentFactories=Readonly<Record<string,()=>Extension>>;
/** Validate application identities; all Agent composition/selection stays in the actual SDK registry. */
export function assembleAgentExtensions(descriptors:readonly ExtensionDescriptor[],factories:AgentFactories,registry:Registry){
 validateDescriptors(descriptors);
 const names=new Set(registry.snapshot().installed().map(item=>item.name)),installed=new Map<string,string>();
 const contributions:Extension[]=[];
 for(const descriptor of descriptors){
  if(!descriptor.agent)continue;
  const factory=Object.hasOwn(factories,descriptor.agent)?factories[descriptor.agent]:undefined;
  if(!factory)throw Error(`扩展 ${descriptor.id} 缺少 Agent 入口：${descriptor.agent}`);
  let contribution:Extension;
  try{contribution=factory();}catch(error){throw new Error(`扩展 ${descriptor.id} 初始化失败`,{cause:error});}
  if(!contribution?.name)throw Error(`扩展 ${descriptor.id} 缺少 SDK 身份`);
  if(names.has(contribution.name))throw Error(`重复 SDK 扩展身份：${contribution.name}`);
  names.add(contribution.name);installed.set(descriptor.id,contribution.name);contributions.push(contribution);
 }
 for(const contribution of contributions)registry.install(contribution);
 return installed;
}
