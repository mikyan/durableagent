// Shared data only. Entrypoint keys resolve in separate build graphs, never across processes.
export type ExtensionDescriptor={readonly id:string;readonly title:string;readonly ui?:string;readonly agent?:string};
export const BUNDLED_EXTENSIONS:readonly ExtensionDescriptor[]=[
 {id:'conversation',title:'会话',ui:'conversation'},
 {id:'models',title:'模型与连接',ui:'models',agent:'models'},
 {id:'projects',title:'项目与工作区',ui:'projects'},
 {id:'timeline',title:'会话时间线',ui:'timeline'},
 {id:'routing',title:'明确跨会话转交',agent:'routing'},
];
export type ExtensionState={descriptor:ExtensionDescriptor;packaged:true;agent:{state:'not-provided'|'installed'|'unavailable';name?:string;selected?:boolean};ui:{state:'not-provided'|'packaged'}};
export type ExtensionCatalog={items:ExtensionState[];conversationId?:string};
export type ExtensionMethod='extensions.get';
export function validateDescriptors(descriptors:readonly ExtensionDescriptor[]){
 const ids=new Set<string>();
 for(const descriptor of descriptors){
  if(!descriptor.id||!descriptor.title||!descriptor.ui&&!descriptor.agent)throw Error('应用扩展描述缺少身份、名称或入口');
  if(ids.has(descriptor.id))throw Error(`重复应用扩展身份：${descriptor.id}`);ids.add(descriptor.id);
 }
}
