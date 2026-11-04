import assert from 'node:assert/strict';
import {createRegistry,defineTool} from '@earendil-works/pi-durable';
import {createEnvConformance} from '@earendil-works/pi-durable/testing';
import {obj,str} from '@earendil-works/pi-schema';
import type {ManagedExecution} from './managed-execution.js';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import {createHash} from 'node:crypto';
import {FILE_CONFORMANCE_NAMES,fileConformanceTool} from './file-conformance.js';

/** Unmodified SDK shell cases which require no T10 file implementation. Debug host assembly only. */
export const EXECUTION_CONFORMANCE_NAMES=[
 'exec reports the stream of every chunk in both forms',
 'argv exec reports missing programs and empty argv as spawn errors',
 'windowed exec keeps the exact tail and counts what it skips',
 'argv exec distinguishes timeout from abort',
] as const;
export function executionConformanceRegistry(execution:ManagedExecution){
 const registry=createRegistry();registry.install({name:'validation.execution-conformance',tools:[execution.wrapTool(defineTool({
  name:'execution_conformance',description:'Run one fixed SDK shell conformance case in its empty test directory',parameters:obj({caseName:str()}),
  execute:async(args,api)=>{
   if(!api.env)throw Error('Missing execution environment');
   if(args.caseName==='raw-output'){
    const result=await api.env.exec(['/data/data/com.termux/files/usr/bin/python','-c',"import sys; sys.stdout.buffer.write(('line-世界\\n'*100000).encode()); sys.stdout.buffer.flush()"],{spill:{afterBytes:1000,afterLines:10}},BACKGROUND_CONTEXT);if(!result.ok)throw result.error;assert.equal(result.value.exitCode,0);assert.ok(result.value.spillPath);const raw=await api.env.readBinaryFile(result.value.spillPath,BACKGROUND_CONTEXT);if(!raw.ok)throw raw.error;assert.deepEqual(Buffer.from(raw.value),Buffer.from('line-世界\n'.repeat(100000)));return {output:[{type:'text',text:`raw-reference-verified:${raw.value.length}:${createHash('sha256').update(raw.value).digest('hex')}`}]};
   }
   if(![...EXECUTION_CONFORMANCE_NAMES,...FILE_CONFORMANCE_NAMES].includes(args.caseName as any))throw Error('Unknown conformance case');
   const cases=createEnvConformance({shell:['/data/data/com.termux/files/usr/bin/bash','-c'],withEnv:async use=>use(api.env!),assertions:{ok:assert.ok,strictEqual:assert.strictEqual,deepEqual:assert.deepStrictEqual,partialDeepEqual:assert.partialDeepStrictEqual,greaterThan:(a,b)=>assert.ok(a>b),rejects:async(operation,text)=>{await assert.rejects(operation,error=>error instanceof Error&&error.message.includes(text));}}});
   const selected=cases.find(item=>item.name===args.caseName);if(!selected)throw Error('Pinned SDK conformance case missing');await selected.run();return {output:[{type:'text',text:'SDK-CONFORMANCE-PASS: '+selected.name}]};
  },
 })),fileConformanceTool(execution)]});return registry;
}
