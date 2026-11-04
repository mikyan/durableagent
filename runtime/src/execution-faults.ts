/** Debug-only owner-process death boundary. No transport or WebView can configure it. */
export function executionFaults(native:{at(stage:string):void},metrics:Record<string,unknown>){
 let selected='off';const allowed=new Set(['off','intent-persisted','accepted','output-checkpoint','before-result']);
 let armed=false,release:(()=>void)|undefined;
 return {set(stage:string){if(!allowed.has(stage))throw Error('Unsupported execution validation boundary');selected=stage;},
  gate(action:string){if(action==='arm'){if(release||armed)throw Error('File validation gate already active');armed=true;metrics.executionWriteGate={state:'armed'};}else if(action==='release'){armed=false;release?.();}else throw Error('Unsupported file validation gate');},
  async boundary(stage:string,request:{executionId:string}){
   if(stage==='file-reserved'&&armed){armed=false;metrics.executionWriteGate={state:'held',executionId:request.executionId};await new Promise<void>(resolve=>{const timer=setTimeout(()=>{metrics.executionWriteGate={state:'expired',executionId:request.executionId};release=undefined;resolve();},30000);release=()=>{clearTimeout(timer);metrics.executionWriteGate={state:'released',executionId:request.executionId};release=undefined;resolve();};});}
   if(stage!==selected)return;selected='off';metrics.executionBoundary={stage,executionId:request.executionId};native.at('execution-'+stage);
  }};
}
