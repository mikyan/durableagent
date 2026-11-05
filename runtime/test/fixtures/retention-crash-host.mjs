import {createSession} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from '../../dist/storage.js';
import {Configuration} from '../../dist/application-records.js';
const [path,phase]=process.argv.slice(2);
try {
 const owned=await openOwnedStorage(path),session=createSession(owned.storage);
 const hold=async()=>{process.send({stage:phase});await new Promise(()=>{});};
 await session.commit(async tx=>{await tx.doc(Configuration);if(phase==='before-commit')await hold();},context);
 if(phase==='after-commit')await hold();
}catch(error){process.send({error:String(error.message??error)});process.exitCode=1;}
