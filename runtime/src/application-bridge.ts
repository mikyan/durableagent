import {join} from 'node:path';
import {createModels,type Models} from '@earendil-works/pi-ai/models';
import {Application} from './application.js';
import {validationConfiguration} from './application-validation.js';
import {liveModels} from './live-model.js';
import type {ApplicationEnvelope,ApplicationRequest,ModelSelection} from './application-protocol.js';
import {ModelConnections,ModelConfigurationError} from './model-connections.js';
import {fixtureTransport} from './transport.js';
import {mkdir} from 'node:fs/promises';
const host=globalThis as any;
// The native owner chooses this mode before loading JS. It is not a UI action.
export async function install(mode:string) {
  let secret:string|undefined;
  let connections:ModelConnections|undefined;
  const metrics:Record<string,unknown>={};
  let configuration:{models:Models;workspacePath:string;initialModel?:ModelSelection}={models:createModels(),workspacePath:join(host.__applicationRoot,'workspace')};
  if(mode==='fixture'||mode==='hang')configuration=validationConfiguration({hang:mode==='hang',requested:()=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;}});
  else if(mode==='real'){
    secret=host.__validationKey;delete host.__validationKey;
    if(!secret)throw new Error('Encrypted validation credential unavailable');
    const live=liveModels(secret,patch=>Object.assign(metrics,patch),{forceEcho:false});
    configuration={models:live.models,workspacePath:configuration.workspacePath,initialModel:{provider:live.provider,modelId:live.model,name:'MiMo V2.6 Flash'}};
  }else if(mode==='product'||mode==='models'||mode==='models-fixture'){
    const native=host.__nativeCredentials;delete host.__nativeCredentials;
    const invoke=(name:string,id:string)=>{const result=JSON.parse(native[name](id));if(!result.ok)throw new ModelConfigurationError(result.error.code,result.error.message);return result.value;};
    connections=new ModelConnections({credentials:{metadata:async id=>invoke('metadataJson',id),resolve:async id=>invoke('resolveJson',id)},onRequest:receipt=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;metrics.lastCredentialGeneration=receipt.generation;metrics.lastConnectionId=receipt.connectionId;},...(mode==='models-fixture'?{fetch:fixtureTransport({requested:()=>{},aborted:()=>{}})}:{})});
    configuration={models:connections.models,workspacePath:configuration.workspacePath};
  }else throw new Error('Unsupported native application mode');
  // Fixture workspace defaults are replaced by the same stable private domain.
  configuration.workspacePath=join(host.__applicationRoot,'workspace');
  const app=new Application({path:join(host.__applicationRoot,'application.sqlite'),...configuration,secret,connections});
  if(mode==='models-fixture')host.__appRunModelPolicy=()=>{
    if(metrics.modelPolicyState==='running')return;
    metrics.modelPolicyState='running';metrics.modelPolicyCases=[];
    void(async()=>{
      const directory=join(host.__applicationRoot,'policy-temp');await mkdir(directory,{recursive:true});
      const entry=new URL('../validation/model-policy.mjs',import.meta.url).href;
      const policy=await import(entry);
      await policy.runModelPolicyChecks((result:unknown)=>(metrics.modelPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.modelPolicyState='passed';
    })().catch(error=>{metrics.modelPolicyState='failed';metrics.modelPolicyError=String(error.message??error);metrics.modelPolicyDiagnostic=error.diagnostic;});
  };
  host.__appCredentialTarget=(id:string)=>app.credentialTarget(id);
  const events:ApplicationEnvelope[]=[];
  const emit=(event:ApplicationEnvelope)=>events.push(event);
  host.__appRequest=(encoded:string)=>{const request=JSON.parse(encoded) as ApplicationRequest;void app.request(request,emit).then(emit);};
  host.__appDisconnect=(connectionId:string)=>{void app.disconnect(connectionId);};
  host.__takeAppEvents=()=>JSON.stringify(events.splice(0));
  host.__appStatus=()=>JSON.stringify({...app.status(),metrics});
  host.__appClose=()=>{void app.close().then(()=>{host.__appClosed=true;}).catch(error=>{host.__appFailure=String(error);});};
  await app.start();
}
