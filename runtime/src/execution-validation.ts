import {validationConfiguration} from './application-validation.js';
import {EXECUTION_CONFORMANCE_NAMES} from './execution-conformance.js';
import {FILE_CONFORMANCE_NAMES} from './file-conformance.js';

/** Debug host mode only. A bounded deterministic model drives the actual SDK/Termux boundary. */
export function executionValidation(run:string,requested:()=>void){
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(run))throw Error('Invalid execution validation domain');
 const prefix=`.durableagent-t09-${run}`;
 const cases:Record<string,{command:string;timeout?:number}>={
  EXEC_LOCAL_PWD:{command:'pwd -P'},
  EXEC_SUCCESS:{command:`printf 'Termux SDK 世界\\n'; printf 'stderr-marker\\n' >&2; printf 'one\\n' >> '${prefix}-success'`},
  EXEC_VERIFY_SUCCESS:{command:`if test "$(cat '${prefix}-success')" = one; then printf 'exactly-one-effect\\n'; else exit 98; fi`},
  EXEC_FAILURE:{command:"printf 'expected failure\\n' >&2; exit 7"},
  EXEC_LARGE:{command:"python -c \"import sys; sys.stdout.buffer.write(('line-世界\\n'*100000).encode()); sys.stdout.buffer.flush()\""},
  EXEC_CANCEL:{command:`printf 'ready-to-cancel\\n'; sleep 30; printf 'too-late\\n' >> '${prefix}-cancel'`},
  // A fixed root-owned streaming endpoint; no arbitrary URL or command enters the debug host.
  // The Python child makes genuine HTTP reads until the native policy stops its whole scope.
  EXEC_NETWORK_DOWNLOAD:{command:`python -u -c 'import urllib.request,time; r=urllib.request.urlopen("http://10.0.2.2:18763/t13/${run}",timeout=60); print("t13-download-open",flush=True); n=0\ntry:\n while True:\n  b=r.read(1024)\n  if not b: break\n  n+=len(b)\nexcept OSError:\n print("t13-download-socket-ended-awaiting-policy",flush=True)\n time.sleep(30)\nprint("t13-download-finished",n,flush=True)' & child=$!; wait "$child"`},
  EXEC_UNRELATED:{command:"printf 'unrelated-running\\n'; sleep 30; printf 'unrelated-finished\\n'"},
  EXEC_VERIFY_CANCEL:{command:`if test ! -e '${prefix}-cancel'; then printf 'cancel-effect-absent\\n'; else exit 99; fi`},
  EXEC_RECONNECT:{command:`printf 'before-disconnect\\n'; sleep 2; printf 'after-reconnect\\n'; printf 'one\\n' >> '${prefix}-reconnect'`},
  EXEC_TIMEOUT:{command:`sleep 30; printf 'too-late\\n' >> '${prefix}-timeout'`,timeout:0.2},
  EXEC_CONFORMANCE_SETUP:{command:`mkdir -- '${prefix}-conformance'; for i in 0 1 2 3; do mkdir -- '${prefix}-conformance/'$i || exit; done; printf 'conformance-directories-ready\\n'`},
  EXEC_CONFORMANCE_CLEANUP:{command:`for i in 0 1 2 3; do rmdir -- '${prefix}-conformance/'$i || exit; done; rmdir -- '${prefix}-conformance'; printf 'conformance-directories-removed\\n'`},
  FILE_QUEUE_SHELL:{command:`printf 'queue-shell-running\\n'; sleep 8; mkdir -p -- '.durableagent-t10-${run}'; printf 'shell\\n' >> '.durableagent-t10-${run}/queue.txt'; printf 'queue-shell-complete\\n'`},
 };
 const text=(input:unknown)=>typeof input==='string'?input:Array.isArray(input)?input.map(part=>part?.text??'').join(''):'';
 const originalCase=(name:string)=>{
  if(name.startsWith('FILE_DOCUMENT_READ:')){const resourceId=name.slice('FILE_DOCUMENT_READ:'.length);if(!/^[a-f0-9]{64}$/.test(resourceId))throw Error('Invalid original read fixture');return {tool:'document_read',args:{resourceId}};}
  if(name.startsWith('FILE_DOCUMENT_WRITE:')){const value=JSON.parse(name.slice('FILE_DOCUMENT_WRITE:'.length));if(!/^[a-f0-9]{64}$/.test(value.resourceId)||!/^[a-f0-9]{64}$/.test(value.expectedDigest)||value.content!==`native-${run}\n`)throw Error('Invalid shared original fixture');return {tool:'document_write',args:{resourceId:value.resourceId,expectedDigest:value.expectedDigest,content:value.content}};}
  if(name.startsWith('FILE_SHARED_BASH:')){const path=name.slice('FILE_SHARED_BASH:'.length);if(!/^\/storage\/emulated\/0\/Download\/DurableAgent-SAF-[a-f0-9-]{36}\/original\.bin$/.test(path))throw Error('Invalid shared original path');return {tool:'bash',args:{command:`test "$(cat -- '${path}')" = 'native-${run}' || exit 93; printf 'shell-${run}\\n' >> '${path}'; printf 'shared-original-append-complete\\n'`}};}
  return undefined;
 };
 const fileCases:Record<string,string>={FILE_ROUNDTRIP:'roundtrip',FILE_DEPENDENCY:'dependency',FILE_QUEUE_SETUP:'queue-setup',FILE_QUEUE_LOCAL:'queue-append',FILE_QUEUE_READ:'queue-read',FILE_PURE:'pure'};
 return validationConfiguration({requested,toolName:input=>{const name=text(input).trim();return originalCase(name)?.tool??(fileCases[name]?'file_contract':name==='EXEC_RAW_OUTPUT'||/^(EXEC|FILE)_CONFORMANCE_[0-3]$/.test(name)?'execution_conformance':'bash');},toolArguments:input=>{const name=text(input).trim();const original=originalCase(name);if(original)return original.args;if(fileCases[name])return {run,caseName:fileCases[name]};if(/^FILE_CONFORMANCE_[0-3]$/.test(name))return {caseName:FILE_CONFORMANCE_NAMES[Number(name.at(-1))]};if(name==='EXEC_RAW_OUTPUT')return {caseName:'raw-output'};if(/^EXEC_CONFORMANCE_[0-3]$/.test(name))return {caseName:EXECUTION_CONFORMANCE_NAMES[Number(name.at(-1))]};const value=cases[name];if(!value)throw Error('Unknown execution validation case');return value;}});
}
