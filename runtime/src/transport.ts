// Only the model HTTP boundary is replaced. Pi AI still loads its lazy provider,
// parses SSE, decodes UTF-8 and assembles deltas using the published packages.
export type FixtureOptions={reply?:string;hang?:boolean;observeRequest?:(body:string)=>void;toolName?:(input?:unknown)=>string|undefined;toolArguments?:(input:unknown)=>Record<string,unknown>;tool?:boolean;invalidTool?:boolean;failFirst?:number};
export function fixtureTransport(options:FixtureOptions & {requested:()=>void; aborted:()=>void}): typeof fetch {
  let requests=0;
  return async (_input, init) => {
    if(options.observeRequest)options.observeRequest(await new Request(_input,init).text());
    const last=options.toolName?JSON.parse(await new Request(_input,init).text()).messages?.at(-1):undefined,chosen=options.toolName?.(last?.content);const witness=chosen&&last?.role==='user'?chosen:undefined;const tool=!!witness||options.tool&&requests===0;requests++;
    options.requested();
    if(requests<=(options.failFirst??0))return new Response('Injected provider unavailable',{status:503});
    const encoder = new TextEncoder();
    const deltas = witness?[{tool_calls:[{index:0,id:'location-'+requests,type:'function',function:{name:witness,arguments:JSON.stringify(options.toolArguments?.(last?.content)??{})}}]}]:tool ? [
      {tool_calls:[{index:0,id:'tool-1',type:'function',function:{name:'echo',arguments:'{"city":"北'}}]},
      {tool_calls:[{index:0,function:{arguments:'京🌍","count":'}}]},
      {tool_calls:[{index:0,function:{arguments:options.invalidTool?'"many"}':'"2"}'}}]}
    ] : (options.reply?options.reply.match(/[\s\S]{1,180}/g)!:['你', '好', '🌍']).map(content=>({content}));
    let index = 0;
    let done=false;
    let abort:()=>void;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        abort=()=>{if(!done){done=true;options.aborted();controller.error(new DOMException('Fixture aborted','AbortError'));}};
        init?.signal?.addEventListener('abort',abort,{once:true});
        if(init?.signal?.aborted)abort();
      },
      async pull(controller) {
        if(options.hang) return new Promise<void>(resolve=>{init?.signal?.addEventListener('abort',()=>resolve(),{once:true});});
        await new Promise(resolve => setTimeout(resolve, 35));
        if(done)return;
        if (index < deltas.length) {
          const bytes = encoder.encode(`data: ${JSON.stringify({id:'probe',object:'chat.completion.chunk',choices:[{index:0,delta:deltas[index++],finish_reason:null}]})}\n\n`);
          // Every byte boundary includes splits inside UTF-8 and SSE syntax.
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        } else {
          controller.enqueue(encoder.encode(`data: {"id":"probe","choices":[{"index":0,"delta":{},"finish_reason":"${tool?'tool_calls':'stop'}"}]}\n\ndata: [DONE]\n\n`));
          controller.close();
          done=true;
          init?.signal?.removeEventListener('abort',abort);
        }
      },
      cancel() { done=true;init?.signal?.removeEventListener('abort',abort); }
    }), {headers:{'content-type':'text/event-stream'}});
  };
}
