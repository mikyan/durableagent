import {join} from 'node:path';
import {createModels,type Models} from '@earendil-works/pi-ai/models';
import {projectWitness} from './project-validation.js';
import {Application} from './application.js';
import {ManagedExecution} from './managed-execution.js';
import {NativeExecutionChannel} from './execution-channel.js';
import {executionValidation} from './execution-validation.js';
import {executionConformanceRegistry} from './execution-conformance.js';
import {executionFaults} from './execution-faults.js';
import {validationConfiguration} from './application-validation.js';
import {liveModels} from './live-model.js';
import type {ApplicationEnvelope,ApplicationRequest,ModelSelection} from './application-protocol.js';
import {ModelConnections,ModelConfigurationError} from './model-connections.js';
import {fixtureTransport} from './transport.js';
import {mkdir} from 'node:fs/promises';
import {InputError} from './input.js';
import type {ApplicationInputs} from './application.js';
import type {SendAuthority} from './submission-protocol.js';
const host=globalThis as any;
// The native owner chooses this mode before loading JS. It is not a UI action.
export async function install(mode:string) {
  const extensionMode=mode.startsWith('extensions-');if(extensionMode)mode=mode.slice('extensions-'.length);
  let secret:string|undefined;
  let connections:ModelConnections|undefined;
  const metrics:Record<string,unknown>={};
  const projectValidation=!extensionMode&&(mode==='fixture'||mode==='real')?projectWitness(metrics):undefined;
  let route:{id:string;text:string;at:number;forbiddenDraft?:string}|undefined;
  if(extensionMode)host.__appExtensionRoute=(value:string)=>{const input=JSON.parse(value);if(typeof input.id!=='string'||typeof input.text!=='string')throw Error('Invalid extension fixture');route={...input,at:Number(metrics.transportRequests??metrics.modelRequests??0)};metrics.extensionRequestHasTargetDraft=false;};
  const observeExtensionRequest=(body:string)=>{if(route?.forbiddenDraft&&JSON.stringify(JSON.parse(body)).includes(route.forbiddenDraft))metrics.extensionRequestHasTargetDraft=true;};
  const routeTool=()=>route&&Number(metrics.transportRequests??metrics.modelRequests??0)===route.at?'conversation_transfer':undefined;
  if(projectValidation)host.__appProjectWitness=(value:string)=>{if(value!=='witness')throw Error('Unknown project validation mode');projectValidation.enable();};
  const nativeInputs=host.__nativeInputs;delete host.__nativeInputs;
  const nativeExecution=host.__nativeExecution;delete host.__nativeExecution;
  const inputInvoke=(method:string,...args:string[])=>{const response=JSON.parse(nativeInputs[method](...args));if(!response.ok)throw new InputError(response.error.code,response.error.message);return response.value;};
  const inputs:ApplicationInputs|undefined=nativeInputs?{rememberConversation:(conversation,capability)=>{inputInvoke('rememberConversationJson',JSON.stringify(conversation),JSON.stringify(capability??null));},readFrozen:async token=>inputInvoke('readFrozenJson',token),readObject:async(token,objectId)=>Buffer.from(inputInvoke('readObjectBase64',token,objectId),'base64'),retainFrozen:async(ownerId,token)=>{inputInvoke('retainFrozenJson',ownerId,token);}}:undefined;
  const locationEdits=nativeInputs?{beginLocationEdit:async(operationId:string)=>inputInvoke('beginLocationEditJson',operationId),readLocationEdit:async()=>inputInvoke('readLocationEditJson'),finishLocationEdit:async(operationId:string,contexts:unknown[])=>{inputInvoke('finishLocationEditJson',operationId,JSON.stringify(contexts));}}:undefined;
  const sends:SendAuthority|undefined=nativeInputs?{readSend:async id=>inputInvoke('readSendJson',id),listSends:async options=>inputInvoke('listSendsJson',JSON.stringify(options??{})),markDeliveryUnknown:async id=>inputInvoke('markDeliveryUnknownJson',id),confirmAdmission:async(id,receipt)=>inputInvoke('confirmAdmissionJson',id,JSON.stringify(receipt)),readControl:async id=>inputInvoke('readControlJson',id),pendingStops:async()=>inputInvoke('pendingStopsJson'),confirmAbort:async(id,barrier)=>inputInvoke('confirmAbortJson',id,JSON.stringify(barrier))}:undefined;
  let configuration:{models:Models;workspacePath:string;initialModel?:ModelSelection}={models:createModels(),workspacePath:join(host.__applicationRoot,'workspace')};
  if(mode==='fixture'||mode==='hang')configuration=validationConfiguration({hang:mode==='hang',observeRequest:extensionMode?observeExtensionRequest:undefined,toolName:()=>projectValidation?.enabled?'location_witness':routeTool(),toolArguments:()=>route?{id:route.id,text:route.text}:{},requested:()=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;}});
  else if(mode==='execution')configuration=executionValidation(String(host.__applicationRoot).split(/[\\/]/).at(-1)!,()=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;});
  else if(mode==='real'||mode==='execution-real'){
    secret=host.__validationKey;delete host.__validationKey;
    if(!secret)throw new Error('Encrypted validation credential unavailable');
    const live=liveModels(secret,patch=>Object.assign(metrics,patch),{forceEcho:false,forceTool:()=>mode==='execution-real'?'bash':projectValidation?.enabled?'location_witness':routeTool(),observeRequest:extensionMode?observeExtensionRequest:undefined});
    configuration={models:live.models,workspacePath:configuration.workspacePath,initialModel:{provider:live.provider,modelId:live.model,name:'MiMo V2.6 Flash'}};
  }else if(mode==='product'||mode==='models'||mode==='models-fixture'){
    const native=host.__nativeCredentials;delete host.__nativeCredentials;
    const invoke=(name:string,id:string)=>{const result=JSON.parse(native[name](id));if(!result.ok)throw new ModelConfigurationError(result.error.code,result.error.message);return result.value;};
    connections=new ModelConnections({credentials:{metadata:async id=>invoke('metadataJson',id),resolve:async id=>invoke('resolveJson',id)},onRequest:receipt=>{metrics.modelRequests=Number(metrics.modelRequests??0)+1;metrics.lastCredentialGeneration=receipt.generation;metrics.lastConnectionId=receipt.connectionId;metrics.lastInput=receipt.input;},...(mode==='models-fixture'?{fetch:fixtureTransport({requested:()=>{},aborted:()=>{}})}:{})});
    configuration={models:connections.models,workspacePath:configuration.workspacePath};
  }else throw new Error('Unsupported native application mode');
  // Fixture workspace defaults are replaced by the same stable private domain.
  const executionValidationFaults=mode==='execution'&&host.__submissionValidation?executionFaults(host.__submissionValidation,metrics):undefined;
  if(executionValidationFaults)host.__appExecutionFault=(stage:string)=>executionValidationFaults.set(stage);
  const execution=nativeExecution&&sends&&['product','execution','execution-real'].includes(mode)?new ManagedExecution({channel:new NativeExecutionChannel(nativeExecution),authority:sends,...(executionValidationFaults?{boundary:executionValidationFaults.boundary}:{})}):undefined;
  configuration.workspacePath=execution?'/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace':join(host.__applicationRoot,'workspace');
  const path=join(host.__applicationRoot,'application.sqlite');
  let submissionValidation:any;
  if(host.__submissionValidation){const native=host.__submissionValidation;delete host.__submissionValidation;const module=await import(new URL('../validation/submission-control.mjs',import.meta.url).href);submissionValidation=module.submissionControl(path,native,metrics,mode==='fixture'||mode==='hang');host.__appSubmissionFault=(value:string)=>submissionValidation.set(value);}
  const app=new Application({path,...configuration,secret,connections,inputs,sends,locationEdits,execution,routes:nativeInputs?{createRoute:async request=>inputInvoke('createRouteJson',JSON.stringify(request))}:undefined,...(mode==='execution'&&execution?{registry:executionConformanceRegistry(execution)}:{}),...(projectValidation?{registry:projectValidation.registry,locations:projectValidation.locations}:{}),...(submissionValidation?{submissionBoundary:submissionValidation.boundary,...(submissionValidation.storageFactory?{storageFactory:submissionValidation.storageFactory}:{})}:{})});
  if(extensionMode&&mode==='fixture')host.__appRunExtensionPolicy=()=>{
    if(metrics.extensionPolicyState==='running')return;metrics.extensionPolicyState='running';metrics.extensionPolicyCases=[];
    void(async()=>{const directory=join(host.__applicationRoot,'extension-policy-temp');await mkdir(directory,{recursive:true});for(const entry of ['extension','registry']){const policy=await import(new URL(`../validation/${entry}-policy.mjs`,import.meta.url).href);await policy[entry==='extension'?'runExtensionPolicyChecks':'runRegistryPolicyChecks']((result:unknown)=>(metrics.extensionPolicyCases as unknown[]).push(result),{tempRoot:directory});}metrics.extensionPolicyState='passed';})().catch(error=>{metrics.extensionPolicyState='failed';metrics.extensionPolicyError=String(error.message??error);metrics.extensionPolicyDiagnostic=error.diagnostic;});
  };
  if(mode==='fixture')host.__appRunProjectPolicy=()=>{
    if(metrics.projectPolicyState==='running')return;metrics.projectPolicyState='running';metrics.projectPolicyCases=[];
    void(async()=>{const directory=join(host.__applicationRoot,'project-policy-temp');await mkdir(directory,{recursive:true});const policy=await import(new URL('../validation/project-policy.mjs',import.meta.url).href);await policy.runProjectPolicyChecks((result:unknown)=>(metrics.projectPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.projectPolicyState='passed';})().catch(error=>{metrics.projectPolicyState='failed';metrics.projectPolicyError=String(error.message??error);metrics.projectPolicyDiagnostic=error.diagnostic;});
  };
  if(mode==='fixture')host.__appRunSubmissionPolicy=()=>{
    if(metrics.submissionPolicyState==='running')return;metrics.submissionPolicyState='running';metrics.submissionPolicyCases=[];
    void(async()=>{const directory=join(host.__applicationRoot,'submission-policy-temp');await mkdir(directory,{recursive:true});const policy=await import(new URL('../validation/submission-policy.mjs',import.meta.url).href);await policy.runSubmissionPolicyChecks((result:unknown)=>(metrics.submissionPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.submissionPolicyState='passed';})().catch(error=>{metrics.submissionPolicyState='failed';metrics.submissionPolicyError=String(error.message??error);metrics.submissionPolicyDiagnostic=error.diagnostic;});
  };
  if(mode==='fixture')host.__appRunStopPolicy=()=>{
    if(metrics.stopPolicyState==='running')return;metrics.stopPolicyState='running';metrics.stopPolicyCases=[];
    void(async()=>{const directory=join(host.__applicationRoot,'stop-policy-temp');await mkdir(directory,{recursive:true});const policy=await import(new URL('../validation/stop-policy.mjs',import.meta.url).href);await policy.runStopPolicyChecks((result:unknown)=>(metrics.stopPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.stopPolicyState='passed';})().catch(error=>{metrics.stopPolicyState='failed';metrics.stopPolicyError=String(error.message??error);});
  };
  if(mode==='fixture')host.__appRunRetentionPolicy=()=>{
    if(metrics.retentionPolicyState==='running')return;metrics.retentionPolicyState='running';metrics.retentionPolicyCases=[];
    void(async()=>{const directory=join(host.__applicationRoot,'retention-policy-temp');await mkdir(directory,{recursive:true});const policy=await import(new URL('../validation/retention-policy.mjs',import.meta.url).href);await policy.runRetentionPolicyChecks((result:unknown)=>(metrics.retentionPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.retentionPolicyState='passed';})().catch(error=>{metrics.retentionPolicyState='failed';metrics.retentionPolicyError=String(error.message??error);});
  };
  if(mode==='fixture')host.__appSeedFutureRetention=()=>{
    if(metrics.retentionFutureState)return;metrics.retentionFutureState='seeding';
    void(async()=>{await app.close();const fixture=await import(new URL('../validation/retention-seed.mjs',import.meta.url).href);await fixture.seedFutureRecord(path);metrics.retentionFutureState='seeded';})().catch(error=>{metrics.retentionFutureState='failed';metrics.retentionFutureError=String(error.message??error);});
  };
  if(mode==='models-fixture')host.__appRunInputPolicy=()=>{
    if(metrics.inputPolicyState==='running')return;
    metrics.inputPolicyState='running';metrics.inputPolicyCases=[];
    void(async()=>{
      const directory=join(host.__applicationRoot,'input-policy-temp');await mkdir(directory,{recursive:true});
      const policy=await import(new URL('../validation/input-policy.mjs',import.meta.url).href);
      await policy.runInputPolicyChecks((result:unknown)=>(metrics.inputPolicyCases as unknown[]).push(result),{tempRoot:directory});metrics.inputPolicyState='passed';
    })().catch(error=>{metrics.inputPolicyState='failed';metrics.inputPolicyError=String(error.message??error);metrics.inputPolicyDiagnostic=error.diagnostic;});
  };
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
  try {await app.start();}
  catch(error){if(!app.status().readOnly)throw error;}
}
