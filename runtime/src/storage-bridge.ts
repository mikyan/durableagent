import {join} from 'node:path';
import {createStorageChecks} from './storage-checks.js';
import {openOwnedStorage} from './storage.js';
import {prepareCrash,recoverCrash,type CrashPhase} from './storage-crash.js';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
const host=globalThis as any;
export async function installStorage(mode:string):Promise<boolean> {
  const match=/^storage-(suite|crash-(before|during|after|confirmed|deferred|migration)|recover-(before|during|after|confirmed|deferred|migration)):([a-zA-Z0-9-]+)$/.exec(mode);
  if(!match)return false;
  const directory=join(host.__storageRoot,match[4]);
  const publish=(state:Record<string,unknown>)=>{host.__snapshot=JSON.stringify({...state,node:process.version,sdk:'1.5.0'});};
  publish({status:'testing',phase:match[1]});
  host.__command=(command:string)=>{if(command==='close')publish({...JSON.parse(host.__snapshot),status:'closed'});};
  if(match[1]==='suite') {
    const configuration=(await (async()=>{const opened=await openOwnedStorage(join(directory,'engine.sqlite'));await opened.storage.close(context);return opened.configuration;})());
    const diagnostics:Record<string,unknown>={};
    const checks=createStorageChecks(directory,value=>Object.assign(diagnostics,value));const passed:string[]=[];
    for(const check of checks){publish({status:'testing',current:check.name,passed,total:checks.length,configuration});await check.run();passed.push(check.name);}
    publish({status:'suite-passed',passed,total:checks.length,configuration,diagnostics});
  } else if(match[2])await prepareCrash(directory,match[2] as CrashPhase,publish);
  else publish(await recoverCrash(directory,match[3] as CrashPhase));
  return true;
}
