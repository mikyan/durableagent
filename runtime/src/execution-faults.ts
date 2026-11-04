/** Debug-only owner-process death boundary. No transport or WebView can configure it. */
export function executionFaults(native:{at(stage:string):void},metrics:Record<string,unknown>){
 let selected='off';const allowed=new Set(['off','intent-persisted','accepted','output-checkpoint','before-result']);
 return {set(stage:string){if(!allowed.has(stage))throw Error('Unsupported execution validation boundary');selected=stage;},boundary(stage:string,request:{executionId:string}){if(stage!==selected)return;selected='off';metrics.executionBoundary={stage,executionId:request.executionId};native.at('execution-'+stage);}};
}
