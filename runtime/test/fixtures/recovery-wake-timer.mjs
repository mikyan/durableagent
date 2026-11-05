/** Test-host alarm for the SDK's absolute wake deadline, including an early timer. */
export function armRecoveryWake(at,wake,{now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!Number.isFinite(at))throw Error('Invalid recovery wake deadline');
 let timer,closed=false;
 const arm=()=>{timer=setTimer(fire,Math.max(1,Math.min(2147483647,at-now())));};
 const fire=()=>{
  timer=undefined;if(closed)return;
  // SDK onWake only publishes changed deadlines. An early host wake cannot rely
  // on another notification for the same at, so retain the alarm until it is due.
  if(now()<at){arm();return;}
  closed=true;void wake();
 };
 arm();
 return ()=>{closed=true;if(timer!==undefined)clearTimer(timer);timer=undefined;};
}
