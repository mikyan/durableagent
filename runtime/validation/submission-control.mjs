// Explicit debug host seam. Actual SQLite COMMIT is held before/after the engine call;
// the Android parent kills the separate owner process, never substitutes orderly close.
import {faultDatabase} from '../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
export function submissionControl(path,native,metrics,sqliteFaults){
 let fault='off',armed=false;
 const hit=stage=>{metrics.submissionBoundary=stage;native.at(stage);};
 return {
   set(value){if(!['off','ack-drop','sdk-before','sdk-after'].includes(value))throw Error('Unsupported validation boundary');fault=value;armed=false;metrics.submissionFault=fault;},
   boundary(stage){if(stage==='after-sdk-submit'&&fault.startsWith('sdk-'))armed=true;if(stage==='before-native-ack'&&fault==='ack-drop')throw Error('Synthetic ACK response withheld');},
   ...(sqliteFaults?{storageFactory:async()=>{const {db,control}=await faultDatabase(path);control.before=sql=>{if(armed&&sql==='COMMIT'&&fault==='sdk-before')hit('sdk-before');};control.after=sql=>{if(armed&&sql==='COMMIT'&&fault==='sdk-after')hit('sdk-after');};return SqliteStorage.open(db);}}:{}),
 };
}
