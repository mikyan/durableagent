import type {ModelSelection} from './application-protocol.js';
// Public data only; credentials use the separate native write boundary below.
export const MODELS_EXTENSION={id:'models',actions:['models.get','models.create','models.setDefault','models.setEnabled','models.select','models.refresh']} as const;
export type ConnectionProtocol='mimo-cn'|'openai-compatible'|'sdk';
export type CredentialState='absent'|'configured'|'waiting-first-unlock'|'temporarily-unavailable'|'key-missing'|'permanently-invalidated'|'corrupt'|'incompatible';
export type CredentialInfo={connectionId:string;state:CredentialState;generation:number;configured:boolean;message?:string};
export type PublicModel={id:string;name:string;contextWindow:number;maxTokens:number};
export type ProviderView={id:string;name:string;models:PublicModel[];authMethods:{type:'api_key'|'oauth';label:string}[];defaultEndpoint?:string};
export type ConnectionDefinition={id:string;name:string;protocol:ConnectionProtocol;providerId?:string;endpoint:string;models:PublicModel[];enabled:boolean;createdAt:number};
export type ConnectionView=ConnectionDefinition&{credential:CredentialInfo};
export type ModelConfiguration={version:number;defaultModel:ModelSelection|null;connections:ConnectionView[];providers?:ProviderView[]};
type PublicPrompt<T>=T extends unknown?Omit<T,'signal'>&{id:string}:never;
export type AuthPrompt=PublicPrompt<import('@earendil-works/pi-ai').AuthPrompt>;
export type AuthEvent=import('@earendil-works/pi-ai').AuthEvent;
export type ProviderAuthSession={id:string;target:string;providerId:string;authType:'api_key'|'oauth';state:'running'|'waiting'|'completed'|'cancelled'|'failed';events:AuthEvent[];prompt?:AuthPrompt;error?:{code:string;message:string}};
export type ProviderAuthRequest={protocol:1;connectionId:string;requestId:string;target:string;operation:'start'|'status'|'answer'|'cancel'|'openUrl';authType?:'api_key'|'oauth';sessionId?:string;promptId?:string;answer?:string;eventIndex?:number};
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
