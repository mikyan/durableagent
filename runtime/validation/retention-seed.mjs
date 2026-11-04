import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createSession,defineDoc} from '@earendil-works/pi-durable';
import {openOwnedStorage} from '../dist/storage.js';

// Debug-only native fixture. The current SDK owner must be closed before this public write.
export async function seedFutureRecord(path) {
 const owned=await openOwnedStorage(path);const session=createSession(owned.storage);
 try {
  const Future=defineDoc({kind:'app.validation-future-blocker',version:1,scope:'session',initial:()=>({uniqueEvidence:'retain-through-read-only'}),checkpointWhen:()=>false});
  await session.commit(async tx=>{await tx.doc(Future);},context);
 }finally{await session.close(context);}
}
