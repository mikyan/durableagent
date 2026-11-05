import {ModelConnections} from '../../dist/model-connections.js';
export function runningModels(requested){
 return new ModelConnections({credentials:{metadata:async id=>({connectionId:id,state:'configured',configured:true,generation:1}),resolve:async()=>({key:'synthetic-running-test',generation:1})},fetch:async request=>{
  requested();const body=await request.json(),first=body.messages.at(-1).role==='user';
  const delta=first?{tool_calls:[{index:0,id:'durable-command',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'one controlled external command',timeout:30})}}]}:{content:'verified part-one and part-two'};
  return new Response(`data: ${JSON.stringify({id:'running',choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'running',choices:[{index:0,delta:{},finish_reason:first?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 }});
}
