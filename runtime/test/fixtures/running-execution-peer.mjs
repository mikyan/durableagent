import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PersistentExecutionPeer} from '../../validation/execution-peer.mjs';

// External transport seam: its ledger survives the Application child process.
// Completion is controlled independently of SDK scheduling, never by editing SDK state.
export class RunningExecutionPeer extends PersistentExecutionPeer {
 async request(method,payload){
  if(method==='start'){
   const record=this.read(payload.executionId);
   if(record.receipt.state==='accepted_not_started'){
    if(record.receipt.finalDigest!==payload.finalDigest)throw Error('Final digest differs');
    appendFileSync(join(this.directory,'effects.txt'),payload.executionId+'\n');
    appendFileSync(join(this.directory,'original.txt'),'part-one\n');
    record.receipt={...record.receipt,state:'running',sequence:3,outputCursor:1,outputBytes:13};
    this.db.prepare('UPDATE executions SET receipt=? WHERE id=?').run(JSON.stringify(record.receipt),payload.executionId);
   }
   return record.receipt;
  }
  if(method==='readOutput'){
   const record=this.read(payload.executionId),chunks=record.receipt.state==='completed'?['T12_PART_ONE\n','part-one\npart-two\n']:['T12_PART_ONE\n'];
   return {...this.identity,executionId:payload.executionId,cursor:payload.cursor,nextCursor:chunks.length,chunks:chunks.map((text,index)=>({sequence:index+1,stream:'stdout',data:Buffer.from(text).toString('base64')})).filter(chunk=>chunk.sequence>payload.cursor)};
  }
  if(method==='cancel'&&this.read(payload.executionId)?.receipt.state==='completed')return this.read(payload.executionId).receipt;
  return super.request(method,payload);
 }
 complete(){
  const records=this.db.prepare('SELECT id,receipt FROM executions').all();
  if(records.length!==1)throw Error('Expected exactly one external execution');
  const {id}=records[0],receipt=JSON.parse(records[0].receipt);
  if(receipt.state!=='running')throw Error('Expected the original running execution');
  appendFileSync(join(this.directory,'original.txt'),'part-two\n');
  const raw='T12_PART_ONE\npart-one\npart-two\n';
  this.db.prepare('UPDATE executions SET receipt=? WHERE id=?').run(JSON.stringify({...receipt,state:'completed',scopeConfirmed:true,exitCode:0,sequence:6,outputCursor:2,outputBytes:Buffer.byteLength(raw),rawSha256:createHash('sha256').update(raw).digest('hex')}),id);
  return id;
 }
}
