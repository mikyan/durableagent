import {DatabaseSync} from 'node:sqlite';
import {apply} from '@earendil-works/chord/delta';

/** Existing product database only. SQLite enforces read-only; no Harness/Models/provider is created. */
export async function inspectProductRecovery(path){
 const database=new DatabaseSync(path,{readOnly:true});
 try{
  database.exec('BEGIN');
  // SqliteStorage.open runs schema bookkeeping even on a current schema. This
  // observation fixture instead reads fixed v1 session documents in one snapshot.
  const read=kind=>{const record=database.prepare('SELECT id FROM documents WHERE kind=? AND scope_kind=\'session\' AND owner_id=0 AND family=0 AND key_value=? AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1').get(JSON.stringify(kind),JSON.stringify(''));if(!record)return undefined;
   const base=database.prepare('SELECT seq,version,content FROM document_revisions WHERE document_id=? AND kind=\'base\' ORDER BY seq DESC LIMIT 1').get(record.id);if(!base||base.version!==1)throw Error('Preflight document version unsupported');let value=JSON.parse(base.content);
   for(const delta of database.prepare('SELECT version,kind,content FROM document_revisions WHERE document_id=? AND seq>? ORDER BY seq').all(record.id,base.seq)){if(delta.version!==1||delta.kind!=='delta')throw Error('Preflight revision unsupported');value=apply(value,JSON.parse(delta.content));}return value;
  };
  const models=read('app.model-configuration'),products=read('app.product-conversations');const tasks=database.prepare('SELECT conversation_id,COUNT(*) AS count FROM tasks WHERE status!=\'terminal\' GROUP BY conversation_id').all();const activeTasks=tasks.reduce((sum,row)=>sum+row.count,0),activeSdkConversations=new Set(tasks.map(row=>row.conversation_id));
  const activeProducts=Object.values(products?.items??{}).filter(product=>activeSdkConversations.has(product.sdkId)).map(product=>product.id);
  return {databaseReadOnly:true,harnessNotOpened:true,modelTransportNotInstalled:true,configurationVersion:models?.version??0,defaultModel:models?.defaultModel??null,connections:(models?.connections??[]).map(value=>({id:value.id,protocol:value.protocol,endpoint:value.endpoint,enabled:value.enabled,models:value.models.map(model=>model.id)})),productCount:Object.keys(products?.items??{}).length,activeProductIds:activeProducts,activeSdkConversationCount:activeSdkConversations.size,activeTaskCount:activeTasks};
 }finally{database.close();}
}
