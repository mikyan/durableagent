import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool, type Conversation, type ConversationView, type ConversationWatch } from '@earendil-works/pi-durable';
import { obj, str, num } from '@earendil-works/pi-schema';
import { fixtureTransport, type FixtureOptions } from './transport.js';
import { capabilities } from './capabilities.js';
import { liveModels } from './live-model.js';
import {openOwnedStorage,auditStorageSecret} from './storage.js';

export type ProbeState = { sdk:string; status:string; text:string; revision:number; node:string; memory:number; peakMemory:number; startupMs?:number; closeMs?:number; cancelMs?:number; transportRequests:number; transportAborted:boolean; toolArguments:unknown[]; toolRejected:boolean; capabilities?:Awaited<ReturnType<typeof capabilities>>; model?:string; textDeltaEvents?:number; toolDeltaEvents?:number; bodyReadPending?:boolean; currentRequest?:number; requestAbortCount?:number; bodyReadError?:string; bodyReadCancelled?:boolean; providerFinished?:boolean; entryCount?:number; entryIds?:number[]; storage?:Awaited<ReturnType<typeof openOwnedStorage>>['configuration'] };
// Candidate validation seam only: MemoryStorage is deliberately non-durable.
export class RuntimeProbe {
  private harness?: Harness;
  private conversation?: Conversation;
  private watch?: ConversationWatch;
  private listeners = new Set<(state:ProbeState)=>void>();
  private state:ProbeState = {sdk:'1.5.0',status:'new',text:'',revision:0,node:process.version,memory:0,peakMemory:0,transportRequests:0,transportAborted:false,toolArguments:[],toolRejected:false};
  private starting?:Promise<void>;
  private closing?:Promise<void>;
  constructor(private options:FixtureOptions & {realKey?:string;storagePath?:string}={}) {}
  safeError(error:unknown) { const message=error instanceof Error?error.stack??error.message:String(error);return this.options.realKey?message.replaceAll(this.options.realKey,'[REDACTED]'):message; }
  snapshot() { return {...this.state}; }
  observe(listener:(state:ProbeState)=>void) { this.listeners.add(listener); listener(this.snapshot()); return () => {this.listeners.delete(listener);}; }
  private publish(patch:Partial<ProbeState>) { const memory=process.memoryUsage().rss;this.state={...this.state,...patch,revision:this.state.revision+1,memory,peakMemory:Math.max(memory,this.state.peakMemory)}; for(const listener of this.listeners) listener(this.snapshot()); }
  start():Promise<void> {
    if(this.closing)return this.closing.then(()=>this.start());
    if(this.starting)return this.starting;
    if(this.harness)return Promise.resolve();
    this.starting=this.open().catch(async error=>{await this.release();this.publish({status:'failed'});throw error;}).finally(()=>{this.starting=undefined;});
    return this.starting;
  }
  private async open() {
    const started=performance.now();
    this.publish({capabilities:await capabilities()});
    const api=openAICompletionsApi();
    const transport=fixtureTransport({...this.options,requested:()=>this.publish({transportRequests:this.state.transportRequests+1}),aborted:()=>this.publish({transportAborted:true})});
    let models=createModels();
    models.setProvider(createProvider({id:'fixture',baseUrl:'https://fixture.invalid/v1',auth:{apiKey:{name:'Fixture only',resolve:async()=>({auth:{apiKey:'fixture-not-a-secret'}})}},models:[{id:'probe',name:'Probe',api:'openai-completions',provider:'fixture',baseUrl:'https://fixture.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}],api:{stream:(m,c,o)=>api.stream(m,c,{...o,fetch:transport}),streamSimple:(m,c,o)=>api.streamSimple(m,c,{...o,fetch:transport})}}));
    let provider='fixture',modelId='probe';
    if(this.options.realKey) {
      const live=liveModels(this.options.realKey,patch=>this.publish(patch));
      models=live.models;provider=live.provider;modelId=live.model;
      this.publish({model:modelId});
    }
    const registry=createRegistry();
    registry.install(defineExtension({name:'fixture-tools',tools:[defineTool({name:'echo',description:'Validate test arguments',parameters:obj({city:str(),count:num()}),execute:async(args)=>{this.publish({toolArguments:[...this.state.toolArguments,args]});return {output:[{type:'text',text:JSON.stringify(args)}]};}})]}));
    const secret=this.options.realKey;
    class ProbeStorage extends MemoryStorage {
      override async commit(...args:Parameters<MemoryStorage['commit']>) {
        if(secret && JSON.stringify(args[0]).includes(secret))throw new Error('Credential persistence blocked');
        return super.commit(...args);
      }
    }
    const owned=this.options.storagePath?await openOwnedStorage(this.options.storagePath,secret):undefined;
    if(owned)this.publish({storage:owned.configuration});
    const storage=owned?.storage??new ProbeStorage();
    try {this.harness=await Harness.open(storage,{models,registry,settings:{progress:{partialIntervalMs:1,outputIntervalMs:1,persistWithinMs:1},retry:{enabled:false,maxRetries:0,baseDelayMs:1}}},context);}catch(error){await storage.close(context);throw error;}
    this.conversation=await this.harness.root(context,{agent:{model:{provider,modelId},maxTurns:3}});
    this.watch=await this.conversation.watch(context);
    this.project(this.watch.value);
    this.watch.start(async call=>{if(call.kind==='value')this.project(call.value);});
    this.publish({status:'ready',startupMs:performance.now()-started});
  }
  private project(view:ConversationView) {
    const live=view.docs['pi.live'] as any;
    const message=live?.generation?.message ?? [...view.entries].reverse().flatMap(e=>e.model??[]).find(m=>m.role==='assistant');
    const text=message?.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('')??'';
    const toolRejected=view.entries.flatMap(e=>e.model??[]).some(m=>m.role==='toolResult'&&m.isError);
    this.publish({text,toolRejected,entryCount:view.entries.length,entryIds:view.entries.map(entry=>entry.id)});
  }
  async send(text:string) {
    if(!this.conversation)throw new Error('Runtime is not ready');
    this.publish({status:'running'});
    const result=await (await this.conversation.submit({type:'input',content:text},context)).wait(context);
    this.publish({status:result.status});
    return result;
  }
  close():Promise<void> {
    if(this.closing)return this.closing;
    this.closing=(async()=>{const started=performance.now();await this.starting?.catch(()=>{});await this.release();this.publish({status:'closed',closeMs:performance.now()-started});})().finally(()=>{this.closing=undefined;});
    return this.closing;
  }
  private async release() {
    await this.watch?.stop();
    let auditError:unknown;
    try {if(this.options.storagePath&&this.options.realKey)await auditStorageSecret(this.options.storagePath,this.options.realKey);}catch(error){auditError=error;}
    await this.harness?.close(context);
    this.watch=undefined;this.harness=undefined;this.conversation=undefined;
    if(this.options.storagePath&&this.options.realKey)await auditStorageSecret(this.options.storagePath,this.options.realKey);
    if(auditError)throw auditError;
  }
  async stop() { const started=performance.now();await this.conversation?.abort(context); this.publish({status:'stopped',cancelMs:performance.now()-started}); }
}
