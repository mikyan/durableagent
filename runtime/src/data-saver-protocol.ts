// Fixed-core policy data. A tool/extension cannot declare itself to be a model request.
export type DataSaverMethod='dataSaver.get'|'dataSaver.configure'|'dataSaver.operations'|'dataSaver.grant';
export const DATA_SAVER_EXTENSION={id:'data-saver',actions:['dataSaver.get','dataSaver.configure','dataSaver.operations','dataSaver.grant']} as const;
export type NetworkFact={identity:string|null;known:boolean;metered:boolean;blocked:boolean};
export type DataSaverSettings={enabled:boolean;version:number;period:number;restricted:boolean;reason:'disabled'|'network-unknown'|'network-blocked'|'metered'|'unrestricted';network:NetworkFact};
export type ExecutionPolicyPhase='waiting'|'allowed'|'granted'|'result-unverified'|'terminal';
export type ExecutionPolicy={executionId:string;requestDigest:string;finalDigest?:string|null;productId:string;controlGeneration:number;namespace:string;classification:'unknown'|'non-model-network'|'controlled-local';summary:string;period:number;phase:ExecutionPolicyPhase;reason:string;grantPeriod:number|null;dispatched?:boolean;policyInterrupted?:boolean;state?:string;scopeConfirmed?:boolean;cancelReason?:string};
export type DataSaverGrant={executionId:string;requestDigest:string;finalDigest:string;period:number};
/** Platform persistence and fresh facts; only the fixed core can register immutable requests. */
export interface DataSaverAuthority{
 get():Promise<DataSaverSettings>;
 configure(enabled:boolean,expectedVersion:number):Promise<DataSaverSettings>;
 register(request:Record<string,unknown>):Promise<ExecutionPolicy>;
 prepared(executionId:string,requestDigest:string,finalDigest:string):Promise<ExecutionPolicy>;
 decision(executionId:string):Promise<ExecutionPolicy>;
 grant(request:DataSaverGrant):Promise<ExecutionPolicy>;
 operations(productId:string,cursor?:string):Promise<{operations:ExecutionPolicy[];nextCursor:string|null}>;
}
