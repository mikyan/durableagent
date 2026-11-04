import { createModels, type Provider } from '@earendil-works/pi-ai/models';
import { xiaomiTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import type { ProbeState } from './probe.js';

// Explicit opt-in validation path. The key is applied only after validating the
// final HTTPS destination; no real credential enters serializable SDK options.
export function liveModels(secret:string, publish:(patch:Partial<ProbeState>)=>void,configuration:{forceEcho?:boolean;forceTool?:()=>string|undefined}={}) {
  if(secret.length<12)throw new Error('Live validation credential unavailable');
  const provider=xiaomiTokenPlanCnProvider();
  const model='mimo-v2.6-flash';
  let requests=0,textDeltas=0,toolDeltas=0;
  const checkedFetch:typeof fetch=async(input,init)=>{
    const request=new Request(input,init);
    if(request.url!=='https://token-plan-cn.xiaomimimo.com/v1/chat/completions'||request.method!=='POST')throw new Error('Live validation destination rejected');
    if(++requests>4)throw new Error('Live validation request budget exceeded');
    const requestId=requests;
    let abortCount=0;
    const current=(patch:Partial<ProbeState>)=>{if(requestId===requests)publish(patch);};
    current({transportRequests:requests,currentRequest:requestId,transportAborted:false,requestAbortCount:0,bodyReadPending:false,bodyReadError:'',bodyReadCancelled:false,providerFinished:false});
    const headers=new Headers(request.headers);
    headers.delete('authorization');headers.set('api-key',secret);
    request.signal.addEventListener('abort',()=>current({transportAborted:true,requestAbortCount:++abortCount}),{once:true});
    const response=await fetch(new Request(request,{headers,redirect:'error'}));
    if(!response.body)return response;
    const reader=response.body.getReader();
    let cancelled=false;
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        current({bodyReadPending:true});
        try {
          const result=await reader.read();
          current({bodyReadPending:false});
          if(cancelled)return;
          if(result.done)controller.close();else controller.enqueue(result.value);
        } catch(error) {current({bodyReadPending:false,bodyReadError:error instanceof Error?error.name:'Unknown'});if(!cancelled)controller.error(error);}
      },
      async cancel(reason) {cancelled=true;await reader.cancel(reason);current({bodyReadPending:false,bodyReadCancelled:true});}
    }),{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  let calls=0;
  const options=(original:any,modelContext:any)=>({
    ...original,fetch:checkedFetch,maxRetries:0,maxRetryDelayMs:0,timeoutMs:45000,maxTokens:1024,reasoning:'off',samplingParams:{thinking:{type:'disabled'}},
    toolChoice:configuration.forceTool?.()&&modelContext.messages.at(-1)?.role==='user'?{type:'function',function:{name:configuration.forceTool()}}:++calls===1&&configuration.forceEcho!==false?{type:'function',function:{name:'echo'}}:'none',
    onProviderStreamEvent(event:any) {
      for(const choice of event?.choices??[]) {
        if(choice.finish_reason)publish({providerFinished:true});
        if(choice.delta?.content)textDeltas++;
        for(const call of choice.delta?.tool_calls??[])if(call.function?.arguments)toolDeltas++;
      }
      publish({textDeltaEvents:textDeltas,toolDeltaEvents:toolDeltas});
    }
  });
  const models=createModels();
  const configured:Provider<'openai-completions'>={...provider,
    auth:{apiKey:{name:'Validation transport credential',resolve:async()=>({auth:{apiKey:'validation-transport-only'}})}},
    stream:(m,c,o)=>provider.stream(m,c,options(o,c)),streamSimple:(m,c,o)=>provider.streamSimple(m,c,options(o,c))
  };
  models.setProvider(configured);
  if(!models.getModel(provider.id,model))throw new Error('Pinned SDK model catalog missing MiMo validation model');
  return {models,provider:provider.id,model};
}
