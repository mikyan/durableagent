import {createHash} from 'node:crypto';
import type {ApplicationRequest,ApplicationResponse} from '../../runtime/src/application-protocol';
import type {FrozenInput,InputConversation,NativeDraft} from '../../runtime/src/input-protocol';

// The Android storage/SAF boundary only. Product UI, client and controller are real.
export class InputPlatform {
  conversations=new Map<string,InputConversation>();
  drafts=new Map<string,NativeDraft>();
  frozen=new Map<string,FrozenInput>();
  operations=new Map<string,unknown>();
  requests:ApplicationRequest[]=[];
  rememberConversation=(conversation:InputConversation)=>{this.conversations.set(conversation.id,conversation);};
  readFrozen=async(token:string)=>{const value=this.frozen.get(token);if(!value)throw Error('Unknown token');return structuredClone(value);};
  readObject=async()=>new Uint8Array();
  read(id:string):NativeDraft {
    if(!this.conversations.has(id))throw Object.assign(Error('Unknown conversation'),{code:'INPUT_UNKNOWN_CONVERSATION'});
    return structuredClone(this.drafts.get(id)??{id,revision:0,stateVersion:0,text:'',selections:[],committed:true});
  }
  async handle(request:ApplicationRequest):Promise<ApplicationResponse> {
    this.requests.push(request);
    try{return {type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:this.apply(request)};}
    catch(error){return {type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:(error as {code?:string}).code??'INPUT_FAILED',message:(error as Error).message}};}
  }
  apply(request:ApplicationRequest):unknown {
    const p=request.payload??{},id=String(p.id);
    if(request.method==='input.list')return {conversations:[...this.conversations.values()]};
    const previous=this.read(id);
    if(request.method==='input.read'||request.method==='input.inspect')return previous;
    const operation=String(p.operationId);
    if(this.operations.has(operation))return structuredClone(this.operations.get(operation));
    if(p.expectedRevision!==undefined&&p.expectedRevision!==previous.revision)throw Object.assign(Error('保存版本已变化'),{code:'INPUT_CONFLICT'});
    let next:unknown;
    if(request.method==='input.save'||request.method==='input.clear'){
      const selectionIds=request.method==='input.clear'?[]:p.selectionIds as string[];
      next={...previous,revision:previous.revision+1,stateVersion:previous.stateVersion+1,text:request.method==='input.clear'?'':String(p.text),selections:selectionIds.map(id=>previous.selections.find(item=>item.id===id)!)};
      this.drafts.set(id,next as NativeDraft);
    }else if(request.method==='input.freeze'){
      const token=crypto.randomUUID(),representations=previous.selections.map(item=>item.preparation.representation!);
      if(previous.selections.some(item=>item.preparation.state!=='ready'))throw Object.assign(Error('附件尚未准备完成'),{code:'INPUT_NOT_READY'});
      const hash=createHash('sha256').update('input-v1\n');
      for(const field of [previous.text,String(representations.length),...representations.flatMap(item=>[item.kind,item.mimeType,item.sha256,String(item.byteLength),item.range])]){const bytes=Buffer.from(field);hash.update(String(bytes.length)+':').update(bytes);}
      next={token,id,revision:previous.revision,text:previous.text,representations,digest:hash.digest('hex')};this.frozen.set(token,next as FrozenInput);
    }else throw Error('Unsupported fixture operation');
    this.operations.set(operation,next);return structuredClone(next);
  }
}
