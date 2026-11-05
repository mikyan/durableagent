export interface ExecutionChannel {
  request(method:string,payload:Record<string,unknown>):Promise<Record<string,unknown>>;
  rememberIntent?(payload:Record<string,unknown>):Promise<void>;
  recoveryComplete?():Promise<void>;
}
export class ExecutionChannelError extends Error {
  constructor(readonly code:string){super(`执行通道未确认请求（${code}）`);this.name='ExecutionChannelError';}
}
export interface NativeExecutionBoundary {
  beginJson(method:string,payloadJson:string):string;
  pollJson(operationId:string):string;
  rememberIntentJson?(payloadJson:string):string;
  recoveryCompleteJson?():string;
}
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
function protocol():never{throw new ExecutionChannelError('NATIVE_PROTOCOL_MISMATCH');}
function unwrap(value:unknown):Record<string,unknown>{
  if(!record(value)||typeof value.ok!=='boolean')return protocol();
  if(value.ok){if(!keys(value,['ok','value'])||!record(value.value))return protocol();return value.value;}
  if(!keys(value,['ok','error'])||!record(value.error)||!keys(value.error,['code','message'])||typeof value.error.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.error.code)||typeof value.error.message!=='string')return protocol();
  throw new ExecutionChannelError(value.error.code);
}
function decode(value:unknown):Record<string,unknown>{
  if(typeof value!=='string'||value.length>70000||Buffer.byteLength(value,'utf8')>70000)return protocol();
  let decoded:unknown;try{decoded=JSON.parse(value);}catch{return protocol();}
  return unwrap(decoded);
}
function encode(payload:unknown):string{
  const ancestors=new Set<object>();
  const invalid=():never=>{throw new ExecutionChannelError('INVALID_EXECUTION_REQUEST');};
  function visit(value:unknown,depth:number):void{
    if(depth>64)invalid();
    if(value===null||typeof value==='boolean')return;
    if(typeof value==='string'){if(value.length>60000)invalid();return;}
    if(typeof value==='number'){if(!Number.isFinite(value))invalid();return;}
    if(typeof value!=='object')return invalid();
    if(ancestors.has(value))invalid();
    if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)invalid();
    ancestors.add(value);for(const item of Object.values(value))visit(item,depth+1);ancestors.delete(value);
  }
  if(!record(payload))invalid();visit(payload,0);
  let encoded:string;try{encoded=JSON.stringify(payload);}catch{return invalid();}
  if(Buffer.byteLength(encoded,'utf8')>60000)invalid();return encoded;
}

/** The trusted Javet boundary is injected by the native host, never by a WebView message. */
export class NativeExecutionChannel implements ExecutionChannel {
  constructor(private readonly native:NativeExecutionBoundary){}
  async rememberIntent(payload:Record<string,unknown>){if(!this.native.rememberIntentJson)throw new ExecutionChannelError('NATIVE_CONTROL_UNAVAILABLE');decode(this.native.rememberIntentJson(encode(payload)));}
  async recoveryComplete(){if(!this.native.recoveryCompleteJson)throw new ExecutionChannelError('NATIVE_CONTROL_UNAVAILABLE');decode(this.native.recoveryCompleteJson());}
  async request(method:string,payload:Record<string,unknown>):Promise<Record<string,unknown>> {
    try {
      if(!/^[a-zA-Z][a-zA-Z0-9.]{0,63}$/.test(method))throw new ExecutionChannelError('INVALID_EXECUTION_REQUEST');
      const payloadJson=encode(payload);
      // Includes one bounded existing-listener readiness phase and one operation.
      const deadline=performance.now()+40000;
      const begun=decode(this.native.beginJson(method,payloadJson));
      if(!keys(begun,['operationId'])||typeof begun.operationId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(begun.operationId))return protocol();
      const operationId=begun.operationId;
      for(;;){
        // Native transport has its own bounded request. After an owner-thread
        // pause, collect a completed result before judging the caller deadline.
        // The same operation is polled; prepare/start is never replayed.
        const reply=decode(this.native.pollJson(operationId));
        if(typeof reply.pending!=='boolean')return protocol();
        if(!reply.pending){if(!keys(reply,['pending','result']))return protocol();return unwrap(reply.result);}
        if(!keys(reply,['pending']))return protocol();
        if(performance.now()>=deadline)throw new ExecutionChannelError('EXECUTION_WAIT_UNKNOWN');
        await new Promise<void>(resolve=>setTimeout(resolve,20));
      }
    }catch(error){if(error instanceof ExecutionChannelError)throw error;throw new ExecutionChannelError('NATIVE_CHANNEL_UNCONFIRMED');}
  }
}
