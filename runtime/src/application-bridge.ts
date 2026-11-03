import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {Application} from './application.js';
import {validationConfiguration} from './application-validation.js';
import {liveModels} from './live-model.js';
import type {ApplicationEnvelope,ApplicationRequest} from './application-protocol.js';
const host=globalThis as any;
// The native owner chooses this mode before loading JS. It is not a UI action.
export async function install(mode:string) {
  let secret:string|undefined;
  const metrics:Record<string,unknown>={};
  let configuration={models:createModels(),workspacePath:join(host.__applicationRoot,'workspace')} as ReturnType<typeof validationConfiguration>;
  if(mode==='fixture'||mode==='hang')configuration=validationConfiguration({hang:mode==='hang',requested:()=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;}});
  else if(mode==='real'){
    secret=host.__validationKey;delete host.__validationKey;
    if(!secret)throw new Error('Encrypted validation credential unavailable');
    const live=liveModels(secret,patch=>Object.assign(metrics,patch),{forceEcho:false});
    configuration={models:live.models,workspacePath:configuration.workspacePath,initialModel:{provider:live.provider,modelId:live.model,name:'MiMo V2.6 Flash'}};
  }else if(mode!=='product')throw new Error('Unsupported native application mode');
  // Fixture workspace defaults are replaced by the same stable private domain.
  configuration.workspacePath=join(host.__applicationRoot,'workspace');
  const app=new Application({path:join(host.__applicationRoot,'application.sqlite'),...configuration,secret});
  const events:ApplicationEnvelope[]=[];
  const emit=(event:ApplicationEnvelope)=>events.push(event);
  host.__appRequest=(encoded:string)=>{const request=JSON.parse(encoded) as ApplicationRequest;void app.request(request,emit).then(emit);};
  host.__appDisconnect=(connectionId:string)=>{void app.disconnect(connectionId);};
  host.__takeAppEvents=()=>JSON.stringify(events.splice(0));
  host.__appStatus=()=>JSON.stringify({...app.status(),metrics});
  host.__appClose=()=>{void app.close().then(()=>{host.__appClosed=true;}).catch(error=>{host.__appFailure=String(error);});};
  await app.start();
}
