import { RuntimeProbe } from './probe.js';
const host=globalThis as any;
export async function install(mode='text') {
  let realKey:string|undefined;
  if(mode==='real') {realKey=host.__validationKey;delete host.__validationKey;if(!realKey)throw new Error('Encrypted validation credential unavailable');}
  const probe=new RuntimeProbe({hang:mode==='hang',tool:mode==='tool'||mode==='invalid',invalidTool:mode==='invalid',realKey});
  host.__probe=probe;
  probe.observe(state=>{host.__snapshot=JSON.stringify(state);});
  host.__command=(command:string)=>{
    const prompt=mode==='real'?'调用 echo 工具一次，city 为北京🌍，count 为2；然后说明工具返回的城市和数量。':'请回答你好🌍';
    const operation=command==='send'?probe.send(prompt):command==='send-long'?probe.send('从1到300依次编号，每项用一整句描述北京的旅行体验，持续输出，不要省略。'):command==='stop'?probe.stop():command==='close'?probe.close():probe.start();
    operation.catch((error:Error)=>{host.__snapshot=JSON.stringify({...probe.snapshot(),status:'failed',phase:'sdk',error:probe.safeError(error)});});
  };
  await probe.start();
}
