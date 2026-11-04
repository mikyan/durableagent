/** Input must already pass the fixed executor's receipt identity/authenticity checks.
 * This projection grants no permission to start; prepare/start still check the native stop fence,
 * current network policy, fixed location and writer claim at their own dispatch boundaries. */
export function continuationEligibility(receipt:{state:string;source?:string;scopeConfirmed?:boolean;cancelReason?:string},policyInterrupted=false):'proceed'|'verify-external'|'policy-interrupted' {
 if(policyInterrupted||(receipt.source!=='application'&&receipt.cancelReason==='network_policy'))return 'policy-interrupted';
 if(receipt.state==='unknown'||(['completed','stopped','not_started'].includes(receipt.state)&&receipt.scopeConfirmed!==true))return 'verify-external';
 return 'proceed';
}
