import {createHash} from 'node:crypto';
import {hostEnvironment} from './environment-prompt.js';

/** Opt-in execution-real evidence only. Never retain a request body, user text or raw tool arguments. */
export function environmentValidation(metrics:Record<string,unknown>) {
 let requests=0;
 return (body:string)=>{
  metrics.environmentRequestCount=++requests;
  try{
   if(body.length>512*1024)throw Error('Validation body budget');
   const request=JSON.parse(body);
   if(!Array.isArray(request.messages))throw Error('Validation messages unavailable');
   if(requests===1){
    const system=request.messages.filter((message:any)=>message?.role==='system'||message?.role==='developer')
     .map((message:any)=>typeof message.content==='string'?message.content:'').join('\n');
    const section=/<application_environment>\n([\s\S]*?)\n<\/application_environment>/.exec(system)?.[1];
    const data=section?.split('\n').at(-1);
    const facts=data?JSON.parse(data):undefined;
    const host=hostEnvironment(JSON.stringify(facts?.host));
    const adoptedPath=facts?.execution?.workspace?.adoptedPath;
    metrics.environmentFirstRequest={present:Boolean(section),...(host?{host}:{}),
     binding:facts?.execution?.binding==='adopted'?'adopted':'unconfirmed',
     ...(typeof adoptedPath==='string'&&adoptedPath.startsWith('/')&&adoptedPath.length<=4096?{adoptedPath}:{}),
     describesIndependentTermuxUid:Boolean(section?.includes('独立 Termux 应用的 UID')),
     offersBash:Array.isArray(facts?.offeredTools)&&facts.offeredTools.includes('bash')};
   }
   const calls=request.messages.filter((message:any)=>message?.role==='assistant')
    .flatMap((message:any)=>Array.isArray(message.tool_calls)?message.tool_calls:[]);
   if(calls.length>16)throw Error('Validation tool budget');
   metrics.environmentTranscriptTools=calls.map((call:any)=>{
    const args=JSON.parse(call?.function?.arguments??'null');
    const name=call?.function?.name;
    const record=args&&typeof args==='object'&&!Array.isArray(args);
    const keys=record?Object.keys(args).sort():[];
    return {name:typeof name==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(name)?name:'invalid',
     validArguments:Boolean(record)&&keys.every(key=>/^[A-Za-z0-9_-]{1,80}$/.test(key)),
     argumentKeys:keys.filter(key=>/^[A-Za-z0-9_-]{1,80}$/.test(key)),
     ...(typeof args?.command==='string'?{commandSha256:createHash('sha256').update(args.command).digest('hex')}:{})};
   });
  }catch{metrics.environmentObservationFailed=true;}
 };
}
