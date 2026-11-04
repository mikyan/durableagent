// Test platform adapter. Real SQLite, separate from SDK storage; Android uses NativeInputStore.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {InputError,frozenInputDigest} from '../dist/input.js';
export class SqliteSendAuthority {
  constructor(path){this.path=path;this.reopen();}
  reopen(){if(this.db?.isOpen)return;this.db=new DatabaseSync(this.path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS facts(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))');}
  read(kind,id){const row=this.db.prepare('SELECT value FROM facts WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):undefined;}
  write(kind,id,value){this.db.prepare('INSERT INTO facts VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,JSON.stringify(value));return structuredClone(value);}
  rememberConversation(conversation){this.write('conversation',conversation.id,conversation);}
  async beginLocationEdit(operationId){const old=this.read('edit','active');if(old&&old.operationId!==operationId)throw Object.assign(Error('位置正在修改'),{code:'INPUT_LOCATION_EDITING'});return this.write('edit','active',{operationId});}
  async readLocationEdit(){return this.read('edit','active')??null;}
  async finishLocationEdit(operationId,contexts){if(this.read('edit','active')?.operationId!==operationId)throw Error('Edit fence mismatch');this.db.exec('BEGIN IMMEDIATE');try{for(const {id,context}of contexts){const product=this.read('conversation',id);if(!product)throw Error('Unknown native product');product.submissionContext=context;this.write('conversation',id,product);}this.db.prepare("DELETE FROM facts WHERE kind='edit' AND id='active'").run();this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
  async readFrozen(token){const value=this.read('frozen',token);if(!value)throw Error('Missing fixed input');return value;}
  async readObject(){throw Error('No object adapter in text fixture');}
  async readControl(id){if(!this.read('conversation',id))throw Error('Unknown native conversation');return this.read('control',id)??{id,version:0,generation:1,stoppedThrough:0};}
  draft(id){return this.read('draft',id)??{id,revision:0,stateVersion:0,text:'',selections:[],committed:true};}
  save(id,text){const previous=this.draft(id);return this.write('draft',id,{...previous,revision:previous.revision+1,text});}
  async create(id,text,actionId=randomUUID(),fixed){const old=this.read('intent',actionId);if(old)return old;if(await this.readLocationEdit())throw Object.assign(Error('位置正在修改'),{code:'INPUT_LOCATION_EDITING'});const draft=this.save(id,text);const input=fixed??{token:randomUUID(),id,revision:draft.revision,text,representations:[],digest:frozenInputDigest(text,[])};this.write('frozen',input.token,input);const control=await this.readControl(id);if(control.generation<=control.stoppedThrough){control.generation++;control.version++;this.write('control',id,control);}const intent={protocol:1,intentId:actionId,actionId,id,inputToken:input.token,inputRevision:input.revision,inputDigest:input.digest,context:this.read('conversation',id).submissionContext,queue:{whenBusy:'followUp',whenIdle:'start'},controlGeneration:control.generation,createdAt:Date.now(),preview:{text:input.text,attachmentCount:input.representations.length},stateVersion:0,delivery:'pending',cancelled:false};this.beforeIntent?.(intent);return this.write('intent',actionId,intent);}
  async createRoute(request){
    const {actionId,id,text,source,expectedContext,expectedControlVersion}=request;
    const fail=(code,message)=>{throw new InputError(code,message);};
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const prior=this.read('route',actionId);if(prior){if(!same(prior,request))fail('INPUT_OPERATION_CONFLICT','转交操作身份已有其他正文或目标');return this.readSend(actionId);}
    if(this.read('intent',actionId))fail('INPUT_OPERATION_CONFLICT','发送身份已使用');
    if(this.read('edit','active'))fail('LOCATION_EDIT_PENDING','位置修改尚未核验');
    const sourceProduct=this.read('conversation',source.id),target=this.read('conversation',id);
    if(!sourceProduct||!target)fail('NOT_FOUND','会话不存在');
    if(sourceProduct.submissionContext.sdkConversationId!==source.sdkConversationId)fail('SOURCE_MISMATCH','来源身份不一致');
    const sourceControl=await this.readControl(source.id),targetControl=await this.readControl(id);
    if(sourceControl.pendingAbort||sourceControl.generation!==source.controlGeneration||sourceControl.stoppedThrough>=source.controlGeneration)fail('SOURCE_STOPPED','来源操作已停止');
    if(!same(target.submissionContext,expectedContext))fail('SUBMISSION_CONTEXT_CONFLICT','目标位置预期已改变');
    if(targetControl.pendingAbort||targetControl.stoppedThrough>=targetControl.generation)fail('TARGET_STOPPED','目标正在停止或已停止');
    if(targetControl.version!==expectedControlVersion)fail('CONTROL_CONFLICT','目标控制已改变');
    const fixed={token:randomUUID(),id,revision:0,text,representations:[],digest:frozenInputDigest(text,[])};
    const intent={protocol:1,intentId:actionId,actionId,id,inputToken:fixed.token,inputRevision:0,inputDigest:fixed.digest,context:expectedContext,queue:{whenBusy:'followUp',whenIdle:'start'},controlGeneration:targetControl.generation,source,createdAt:Date.now(),preview:{text,attachmentCount:0},stateVersion:0,delivery:'pending',cancelled:false};
    this.db.exec('BEGIN IMMEDIATE');try{this.write('frozen',fixed.token,fixed);this.write('route',actionId,request);this.write('intent',actionId,intent);this.db.exec('COMMIT');return intent;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async readSend(id){const value=this.read('intent',id);if(!value)throw Object.assign(Error('发送意图不存在'),{code:'SEND_NOT_FOUND'});return value;}
  async listSends({id,cursor,limit=30}={}){if(!Number.isInteger(limit)||limit<1||limit>50)throw Object.assign(Error('每页最多查询 50 条发送意图。'),{code:'INPUT_INVALID'});let values=this.db.prepare("SELECT value FROM facts WHERE kind='intent' ORDER BY rowid DESC").all().map(x=>JSON.parse(x.value)).filter(x=>!id||x.id===id);const start=Number(cursor??0),items=values.slice(start,start+limit);return {intents:items,...(start+items.length<values.length?{next:String(start+items.length)}:{})};}
  async markDeliveryUnknown(id){const value=await this.readSend(id);if(value.delivery!=='acknowledged'){value.delivery='uncertain';value.stateVersion++;this.write('intent',id,value);}return value;}
  async confirmAdmission(id,receipt){this.beforeAck?.(id,receipt);this.db.exec('BEGIN IMMEDIATE');try{const value=await this.readSend(id);if(value.receipt&&JSON.stringify(value.receipt)!==JSON.stringify(receipt))throw Error('Receipt mismatch');const draft=value.source?undefined:this.draft(value.id),cleared=!!draft&&!value.receipt&&draft.revision===value.inputRevision;value.receipt=receipt;value.delivery='acknowledged';value.stateVersion++;if(cleared)this.write('draft',value.id,{...draft,revision:draft.revision+1,text:'',selections:[]});this.write('intent',id,value);this.db.exec('COMMIT');this.afterAck?.(id,receipt);return value.source?{kind:'route',intent:value,draftCleared:false}:{intent:value,draftCleared:cleared,draft:this.draft(value.id)};}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
  async stop(id,stopId=randomUUID()){const control=await this.readControl(id);control.version++;control.stoppedThrough=control.generation;control.pendingAbort={stopId,throughGeneration:control.generation,context:this.read('conversation',id).submissionContext};for(const {value}of this.db.prepare("SELECT value FROM facts WHERE kind='intent'").all()){const item=JSON.parse(value);if(item.id===id&&item.controlGeneration<=control.stoppedThrough)item.cancelled=true;if(item.source?.id===id&&item.source.controlGeneration<=control.stoppedThrough)item.sourceCancelled=true;this.write('intent',item.intentId,item);}return this.write('control',id,control);}
  async pendingStops(){return this.db.prepare("SELECT value FROM facts WHERE kind='control'").all().map(x=>JSON.parse(x.value)).filter(x=>x.pendingAbort).map(control=>({id:control.id,control}));}
  async confirmAbort(id,barrier){const control=await this.readControl(id);if(JSON.stringify(control.pendingAbort)===JSON.stringify(barrier)){delete control.pendingAbort;control.version++;this.write('control',id,control);}return control;}
  close(){if(this.db.isOpen)this.db.close();}
}
