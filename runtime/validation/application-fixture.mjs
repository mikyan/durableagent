// Existing T04-T06 contract tests express input tersely. This test-only platform driver
// performs native draft/freeze/intent steps; production Application accepts only intentId.
import {Application as CoreApplication} from '../dist/application.js';
import {SqliteSendAuthority} from './submission-authority.mjs';
export class Application extends CoreApplication {
  constructor(options){
    const native=new SqliteSendAuthority(options.path+'.input.sqlite'),external=options.inputs;
    const inputs={rememberConversation:(conversation,capability)=>{native.rememberConversation(conversation);external?.rememberConversation(conversation,capability);},readFrozen:token=>native.readFrozen(token),readObject:(token,id)=>external?external.readObject(token,id):native.readObject(token,id)};
    super({...options,inputs,sends:native});this.native=native;this.external=external;
  }
  async start(){this.native.reopen();return super.start();}
  async close(){try{await super.close();}finally{this.native.close();}}
  async request(request,emit){
    if(this.status().phase==='ready'&&request.protocol===1){
      const payload=request.payload??{};
      if(request.method==='send'&&payload.intentId===undefined&&payload.actionId&&payload.id){
        const fixed=payload.inputToken?await this.external.readFrozen(payload.inputToken):undefined;
        const intent=await this.native.create(payload.id,payload.text??fixed?.text??'',payload.actionId,fixed);
        request={...request,payload:{intentId:intent.intentId}};
      }else if(request.method==='stop'&&payload.actionId&&payload.id){await this.native.stop(payload.id,payload.actionId);request={...request,payload:{id:payload.id,stopId:payload.actionId}};}
    }
    return super.request(request,emit);
  }
}
