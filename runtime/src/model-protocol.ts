import type {ModelSelection} from './application-protocol.js';
// Public data only; credentials use the separate native write boundary below.
export const MODELS_EXTENSION={id:'models',actions:['models.get','models.create','models.setDefault','models.setEnabled','models.select']} as const;
export type ConnectionProtocol='mimo-cn'|'openai-compatible';
export type CredentialState='absent'|'configured'|'waiting-first-unlock'|'temporarily-unavailable'|'key-missing'|'permanently-invalidated'|'corrupt'|'incompatible';
export type CredentialInfo={connectionId:string;state:CredentialState;generation:number;configured:boolean;message?:string};
export type PublicModel={id:string;name:string;contextWindow:number;maxTokens:number};
export type ConnectionDefinition={id:string;name:string;protocol:ConnectionProtocol;endpoint:string;models:PublicModel[];enabled:boolean;createdAt:number};
export type ConnectionView=ConnectionDefinition&{credential:CredentialInfo};
export type ModelConfiguration={version:number;defaultModel:ModelSelection|null;connections:ConnectionView[]};
export type ModelConfigurationMethod=typeof MODELS_EXTENSION.actions[number];
export type CredentialWriteRequest={protocol:1;connectionId:string;requestId:string;operation:'save'|'remove';target:string;expectedGeneration:number;key?:string};
/**
 * models.get {} -> ModelConfiguration (metadata only, no decrypt/checkAuth)
 * models.create {creationId,expectedVersion,name,protocol,endpoint,modelId?} -> ModelConfiguration
 *   A new immutable identity for every destination/protocol definition; MiMo uses its SDK catalog.
 * models.setDefault {expectedVersion,selection:{provider,modelId}} -> ModelConfiguration
 * models.setEnabled {expectedVersion,id,enabled} -> ModelConfiguration (old definitions retained)
 * models.select {id,selection:{provider,modelId}} -> ConversationSnapshot (current conversation only)
 * Native credential writes: DurableNative.writeCredential(JSON.stringify(CredentialWriteRequest)).
 * The normal __durableReceive response carries CredentialInfo or a safe error; never echoes key.
 * key is only valid for save; remove has no secret. Do not place this request in ordinary postMessage.
 */
