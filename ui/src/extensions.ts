import type {ComponentType} from 'react';
import {BUNDLED_EXTENSIONS,validateDescriptors,type ExtensionDescriptor} from '../../runtime/src/extension-protocol';
export type UiEntry={descriptor:ExtensionDescriptor;load:()=>Promise<{default:ComponentType<any>}>};
const entries:Record<string,UiEntry['load']>={conversation:()=>import('./extensions/conversation'),models:()=>import('./extensions/models'),projects:()=>import('./extensions/projects'),timeline:()=>import('./extensions/timeline')};
// The one data manifest links two independent build graphs. This table imports no Agent code.
export function assembleUiExtensions(descriptors:readonly ExtensionDescriptor[],loaders:typeof entries){
 validateDescriptors(descriptors);const result:Record<string,UiEntry>={};
 for(const descriptor of descriptors){if(!descriptor.ui)continue;const load=Object.hasOwn(loaders,descriptor.ui)?loaders[descriptor.ui]:undefined;if(!load)throw Error(`扩展 ${descriptor.id} 缺少界面入口`);Object.defineProperty(result,descriptor.id,{value:{descriptor,load},enumerable:true});}
 return result;
}
export const builtInUiExtensions=assembleUiExtensions(BUNDLED_EXTENSIONS,entries);
