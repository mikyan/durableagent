import {defineDoc,type Harness} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';

export type FilePosition={namespace:string;canonicalPath:string;objectId:string|null;ancestorObjectIds:string[];parentAnchor?:string;missingParents?:string[];writeRoot?:string};
export type WriteScope={domain:'device-files';kind:'environment'}|{domain:'device-files';kind:'paths';positions:FilePosition[]};
export type WriteClaim={operationId:string;requestDigest:string;namespace:string;source:'termux'|'saf';bindingId:string;productId:string;scope:WriteScope};
export type WriteEvidence={operationId:string;requestDigest:string;namespace:string;state:string;scopeConfirmed:boolean;sequence:number};
export type WriteReservation=WriteClaim&{state:'queued'|'granted'|'unknown'|'released'|'cancelled';order:number;sequence:number};
const Reservations=defineDoc({kind:'app.workspace-writes',version:1,scope:'session',initial:()=>({nextOrder:1,items:{} as Record<string,WriteReservation>}),checkpointWhen:()=>false});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const active=(value:WriteReservation)=>!['released','cancelled'].includes(value.state);
const stable=(value:any):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const request=(value:WriteReservation):WriteClaim=>{const {state,order,sequence,...claim}=value;return claim;};
function conflicts(a:WriteScope,b:WriteScope){
 if(a.domain!==b.domain)return false;if(a.kind==='environment'||b.kind==='environment')return true;
 const below=(child:string,parent:string)=>child===parent||child.startsWith(parent==='/'?'/':parent+'/');
 return a.positions.some(left=>b.positions.some(right=>left.namespace===right.namespace&&(
  below(left.writeRoot??left.canonicalPath,right.writeRoot??right.canonicalPath)||below(right.writeRoot??right.canonicalPath,left.writeRoot??left.canonicalPath)||
  left.objectId!==null&&(left.objectId===right.objectId||right.ancestorObjectIds.includes(left.objectId))||
  right.objectId!==null&&left.ancestorObjectIds.includes(right.objectId))));
}

/** One durable app-wide writer domain; the verifier supplies external facts, not task liveness. */
export class WorkspaceCoordinator{
 constructor(private readonly harness:Harness,private readonly verify:(claim:Readonly<WriteClaim>)=>Promise<WriteEvidence>){}
 async reserve(claim:WriteClaim):Promise<WriteReservation>{
  return this.harness.commit(async tx=>{
   const records=await tx.doc(Reservations);let own=records.items[claim.operationId];
   if(own&&stable(request(own))!==stable(claim))throw Error('WRITE_IDENTITY_CONFLICT');
   if(!own){records.items[claim.operationId]={...copy(claim),state:'queued',order:records.nextOrder++,sequence:0};own=records.items[claim.operationId];}
   if(own.state==='queued'&&!Object.values(records.items).some(other=>other.operationId!==own.operationId&&active(other)&&conflicts(own.scope,other.scope)&&(other.state!=='queued'||other.order<own.order)))own.state='granted';
   return copy(own);
  },BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
 }
 async refresh():Promise<void>{
  for(const previous of await this.list()){
   if(!['granted','unknown'].includes(previous.state))continue;
   let evidence:WriteEvidence|undefined;try{evidence=await this.verify(request(previous));}catch{/* No external fact means the write remains occupied. */}
   if(evidence&&(evidence.operationId!==previous.operationId||evidence.requestDigest!==previous.requestDigest||evidence.namespace!==previous.namespace||!Number.isSafeInteger(evidence.sequence)||evidence.sequence<0))throw Error('WRITE_EVIDENCE_MISMATCH');
   await this.harness.commit(async tx=>{const records=await tx.doc(Reservations),own=records.items[previous.operationId];if(!own||!['granted','unknown'].includes(own.state)||evidence&&evidence.sequence<own.sequence)return;
    if(evidence){own.sequence=evidence.sequence;own.state=['completed','stopped','not_started'].includes(evidence.state)&&evidence.scopeConfirmed===true?'released':['accepted_not_started','starting','running','stop_requested'].includes(evidence.state)?'granted':'unknown';}
    else own.state='unknown';
   },BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
  }
 }
 async list():Promise<WriteReservation[]>{return Object.values((await this.harness.snapshot(Reservations,BACKGROUND_CONTEXT))?.items??{}).map(copy).sort((a,b)=>a.order-b.order);}
 async cancelQueued(operationId:string):Promise<boolean>{return this.harness.commit(async tx=>{const records=await tx.doc(Reservations),own=records.items[operationId];if(!own||!['queued','cancelled'].includes(own.state))return false;own.state='cancelled';return true;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}
}
