import {defineDoc,type Harness} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';

const Deadlines=defineDoc({kind:'app.model-retry-after',version:1,scope:'session',initial:()=>({until:{} as Record<string,number>}),checkpointWhen:()=>false});
/** Eligibility metadata only: SDK retries, attempts and input identities remain untouched. */
export class ModelRetryAfter {
 private deadlines:Record<string,number>={};
 private readonly listeners=new Set<()=>void>();
 private readonly active=new Map<symbol,string>();
 constructor(private readonly harness:Harness,private readonly now:()=>number,private readonly changed:(wakeAt?:number)=>void){}
 async initialize(){this.deadlines=Object.assign(Object.create(null),(await this.harness.snapshot(Deadlines,context))?.until);for(const value of Object.values(this.deadlines))if(!Number.isSafeInteger(value)||value<0)throw Error('模型等待记录无法核验');}
 until(id:string){const at=this.deadlines[id];return at>this.now()?at:undefined;}
 private publish(){const times=[...this.active.values()].flatMap(id=>this.until(id)??[]);this.changed(times.length?Math.min(...times):undefined);}
 async record(id:string,value:string|null){
  if(value===null)return;const text=value.trim();let at:number;
  if(/^\d+$/.test(text))at=this.now()+Number(text)*1000;
  else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text))at=Date.parse(text);
  else return;
  if(!Number.isSafeInteger(at)||at<0||at>8640000000000000||at<=this.now())return;
  // Reserve immediately: a concurrent invocation must not pass while storage
  // is committing the already-observed server deadline. Commit failure does not
  // erase this conservative in-owner fence.
  this.deadlines[id]=Math.max(this.deadlines[id]??0,at);for(const wake of [...this.listeners])wake();this.publish();
  const stored=await this.harness.commit(async tx=>{const doc=await tx.doc(Deadlines);const previous=Object.hasOwn(doc.until,id)?doc.until[id]:0;const until=Math.max(previous,at);doc.until={...doc.until,[id]:until};return until;},context);
  this.deadlines[id]=Math.max(this.deadlines[id]??0,stored);for(const wake of [...this.listeners])wake();this.publish();
 }
 async wait(id:string,signal?:AbortSignal){
  const token=Symbol();this.active.set(token,id);
  try{for(;;){if(signal?.aborted)throw Error('模型等待已停止');const at=this.until(id);if(at===undefined)return;this.publish();
   await new Promise<void>((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>;const clean=()=>{clearTimeout(timer);this.listeners.delete(wake);signal?.removeEventListener('abort',abort);};const wake=()=>{clean();resolve();};const abort=()=>{clean();reject(Error('模型等待已停止'));};timer=setTimeout(wake,Math.max(1,Math.min(2147483647,at-this.now())));this.listeners.add(wake);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  }}finally{this.active.delete(token);this.publish();}
 }
}
