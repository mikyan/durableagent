import {createModels,createProvider} from '@earendil-works/pi-ai/models';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {fixtureTransport,type FixtureOptions} from './transport.js';
import type {ModelSelection} from './application-protocol.js';
// Test/platform adapter only; never selected implicitly by the product Activity.
export function validationConfiguration(options:FixtureOptions & {requested?:()=>void;aborted?:()=>void}={}) {
  const models=createModels(),api=openAICompletionsApi();
  const transport=fixtureTransport({...options,requested:options.requested??(()=>{}),aborted:options.aborted??(()=>{})});
  models.setProvider(createProvider({id:'fixture',baseUrl:'https://fixture.invalid/v1',
    auth:{apiKey:{name:'Validation only',resolve:async()=>({auth:{apiKey:'fixture-not-secret'}})}},
    models:[{id:'conversation',name:'验证模型',api:'openai-completions',provider:'fixture',baseUrl:'https://fixture.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:1000}],
    api:{stream:(m,c,o)=>api.stream(m,c,{...o,maxRetries:0,fetch:transport}),streamSimple:(m,c,o)=>api.streamSimple(m,c,{...o,maxRetries:0,fetch:transport})}}));
  return {models,initialModel:{provider:'fixture',modelId:'conversation',name:'验证模型'} satisfies ModelSelection,workspacePath:'/validation/default-workspace'};
}
