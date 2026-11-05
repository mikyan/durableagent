import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createStorageConformance} from '@earendil-works/pi-durable/testing';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from './storage.js';
import {sqliteChecks} from './sqlite-checks.js';

export type StorageCheck={name:string;run:()=>Promise<void>};
export function createStorageChecks(directory:string,diagnostic?:(value:Record<string,unknown>)=>void):StorageCheck[] {
  let sequence=0;
  return [...createStorageConformance({
    assertions:{ok:assert.ok,strictEqual:assert.strictEqual,deepEqual:assert.deepStrictEqual,
      partialDeepEqual:assert.partialDeepStrictEqual,greaterThan:(a,b)=>assert.ok(a>b),
      rejects:async(promise,message)=>{await assert.rejects(promise,error=>{assert.ok(String(error).includes(message));return true;});}},
    withStorage:async use=>{const {storage}=await openOwnedStorage(join(directory,`conformance-${sequence++}.sqlite`));try{await use(storage);}finally{await storage.close(context);}}
  }),...sqliteChecks(directory,diagnostic)];
}
