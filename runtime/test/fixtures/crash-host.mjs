import {prepareCrash} from '../../dist/storage-crash.js';
setInterval(()=>{},1000);
prepareCrash(process.argv[2],process.argv[3],state=>process.send(state)).catch(error=>{
  process.send({status:'failed',error:String(error.stack??error)});
});
