/** Fixed-core native stop ownership. This boundary never accepts command or file contents. */
export type FileEffectIdentity={operationId:string;kind:'file';source:'termux'|'saf';productId:string;controlGeneration:number;sdkConversationId:number;namespace:string;requestDigest:string};
export type FileEffectEvidence={operationId:string;namespace:string;requestDigest:string;state:string;scopeConfirmed:boolean;sequence:number;reason?:string};
export interface FileEffectAuthority{
 register(identity:FileEffectIdentity):Promise<Record<string,any>>;
 adopt(identity:FileEffectIdentity):Promise<Record<string,any>>;
 require(operationId:string):Promise<Record<string,any>>;
 record(operationId:string,evidence:FileEffectEvidence):Promise<Record<string,any>>;
}
export type FileExecutionIdentity={executionId:string;requestDigest:string;context:{productId:string;controlGeneration:number;sdkConversationId:number}};
