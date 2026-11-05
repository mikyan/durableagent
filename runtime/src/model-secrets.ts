export function sanitizeEvent<T>(event:T,secrets:ReadonlySet<string>):T {
  const partial=(event as any).type!=='done'&&(event as any).type!=='error';
  const clean=(value:any,field='',depth=0,messageRoot=false):any=>{
    if(typeof value==='string'){
      for(const secret of secrets){value=value.replaceAll(secret,'[REDACTED]');if(partial&&['text','thinking','delta','content','errorMessage'].includes(field))for(let size=Math.min(secret.length-1,value.length);size>0;size--)if(value.endsWith(secret.slice(0,size))){value=value.slice(0,-size)+'[REDACTED]';break;}}
      return value;
    }
    if(Array.isArray(value))return value.map(item=>clean(item,field,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!(key==='metadata'&&messageRoot)).map(([key,item])=>[clean(key),clean(item,key,depth+1,depth===0&&['message','error','partial'].includes(key))]));
    return value;
  };return clean(event);
}
// Filter before the provider parser sees errors, metadata or streamed content. Keep the
// unmatched tail across chunks, so reflected keys split at arbitrary UTF-8 boundaries cannot leak.
export function redactResponse(response:Response,secret:string):Response {
  if(!response.body||!secret)return response;
  const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();let pending='';
  return new Response(new ReadableStream<Uint8Array>({async pull(controller){try{while(true){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});let count=done?pending.length:Math.max(0,pending.length-secret.length+1);const last=pending.lastIndexOf(secret,count);if(last>=0&&last+secret.length>count)count=last;if(count<pending.length&&count>0&&/[\uD800-\uDBFF]/.test(pending[count-1]))count--;const safe=pending.slice(0,count).replaceAll(secret,'[REDACTED]');pending=pending.slice(count);if(safe)controller.enqueue(encoder.encode(safe));if(done){controller.close();return;}if(safe)return;}}catch{controller.error(Error('模型响应读取失败'));}},async cancel(reason){await reader.cancel(reason);}}),{status:response.status,statusText:response.statusText.replaceAll(secret,'[REDACTED]'),headers:{'content-type':response.headers.get('content-type')??'application/octet-stream'}});
}
