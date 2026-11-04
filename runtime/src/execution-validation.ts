import {validationConfiguration} from './application-validation.js';
import {EXECUTION_CONFORMANCE_NAMES} from './execution-conformance.js';

/** Debug host mode only. A bounded deterministic model drives the actual SDK/Termux boundary. */
export function executionValidation(run:string,requested:()=>void){
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(run))throw Error('Invalid execution validation domain');
 const prefix=`.durableagent-t09-${run}`;
 const cases:Record<string,{command:string;timeout?:number}>={
  EXEC_SUCCESS:{command:`printf 'Termux SDK 世界\\n'; printf 'stderr-marker\\n' >&2; printf 'one\\n' >> '${prefix}-success'`},
  EXEC_VERIFY_SUCCESS:{command:`if test "$(cat '${prefix}-success')" = one; then printf 'exactly-one-effect\\n'; else exit 98; fi`},
  EXEC_FAILURE:{command:"printf 'expected failure\\n' >&2; exit 7"},
  EXEC_LARGE:{command:"python -c \"import sys; sys.stdout.buffer.write(('line-世界\\n'*100000).encode()); sys.stdout.buffer.flush()\""},
  EXEC_CANCEL:{command:`printf 'ready-to-cancel\\n'; sleep 30; printf 'too-late\\n' >> '${prefix}-cancel'`},
  EXEC_VERIFY_CANCEL:{command:`if test ! -e '${prefix}-cancel'; then printf 'cancel-effect-absent\\n'; else exit 99; fi`},
  EXEC_RECONNECT:{command:`printf 'before-disconnect\\n'; sleep 2; printf 'after-reconnect\\n'; printf 'one\\n' >> '${prefix}-reconnect'`},
  EXEC_TIMEOUT:{command:`sleep 30; printf 'too-late\\n' >> '${prefix}-timeout'`,timeout:0.2},
  EXEC_CONFORMANCE_SETUP:{command:`mkdir -- '${prefix}-conformance'; for i in 0 1 2 3; do mkdir -- '${prefix}-conformance/'$i || exit; done; printf 'conformance-directories-ready\\n'`},
  EXEC_CONFORMANCE_CLEANUP:{command:`for i in 0 1 2 3; do rmdir -- '${prefix}-conformance/'$i || exit; done; rmdir -- '${prefix}-conformance'; printf 'conformance-directories-removed\\n'`},
 };
 const text=(input:unknown)=>typeof input==='string'?input:Array.isArray(input)?input.map(part=>part?.text??'').join(''):'';
 return validationConfiguration({requested,toolName:input=>text(input).trim()==='EXEC_RAW_OUTPUT'||/^EXEC_CONFORMANCE_[0-3]$/.test(text(input).trim())?'execution_conformance':'bash',toolArguments:input=>{const name=text(input).trim();if(name==='EXEC_RAW_OUTPUT')return {caseName:'raw-output'};if(/^EXEC_CONFORMANCE_[0-3]$/.test(name))return {caseName:EXECUTION_CONFORMANCE_NAMES[Number(name.at(-1))]};const value=cases[name];if(!value)throw Error('Unknown execution validation case');return value;}});
}
