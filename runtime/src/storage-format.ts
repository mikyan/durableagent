import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {Storage,DocumentRecord,Cursor} from '@earendil-works/pi-durable';

export type ApplicationRecordFormat={version:number;scope:'session'|'conversation';history?:'latest'|'rewindable';fork?:'current'|'asOf'|'initial'};
export const APPLICATION_RECORD_FORMATS:Readonly<Record<string,ApplicationRecordFormat>>={
 'app.configuration':{version:2,scope:'session'},
 'app.product-conversations':{version:1,scope:'session'},
 'app.model-configuration':{version:1,scope:'session'},
 'app.projects':{version:1,scope:'session'},
 'app.admission':{version:1,scope:'session'},
 'app.submission-binding':{version:1,scope:'session'},
 'app.current-submission-binding':{version:1,scope:'session'},
 'app.execution-binding':{version:1,scope:'conversation',history:'latest',fork:'current'},
 'app.managed-execution-intent':{version:1,scope:'session'},
 'app.managed-execution-index':{version:1,scope:'session'},
 'app.workspace-writes':{version:1,scope:'session'},
 'app.managed-file-intent':{version:1,scope:'session'},
 'app.managed-file-index':{version:1,scope:'session'},
};
/** Definition-free public reads verify even dormant records before Harness.open can reconcile work.
 * This does not migrate values, retire documents, or infer that external effects are safe to replay.
 */
export async function verifyApplicationStorage(storage:Storage,additional:Readonly<Record<string,ApplicationRecordFormat>>={}) {
 const formats={...APPLICATION_RECORD_FORMATS,...additional};
 async function scope(scope:DocumentRecord['scope']) {
  let cursor:Cursor|undefined;
  do{const page=await storage.scanDocuments({scope,at:'current'},50,cursor,context);
   for(const record of page.items){if(!record.kind.startsWith('app.'))continue;
    const format=formats[record.kind],stored=await storage.document(record.id,'current',context);
    if(!format||!stored||stored.version>format.version||stored.version<1||record.scope.kind!==format.scope||record.history!==format.history||record.fork!==format.fork)throw new Error('APP_FORMAT_UNSUPPORTED');
   }cursor=page.next;
  }while(cursor);
 }
 await scope({kind:'session'});
 let cursor:Cursor|undefined;
 do{const page=await storage.scanConversations({},50,cursor,context);for(const conversation of page.items)await scope({kind:'conversation',conversationId:conversation.id});cursor=page.next;}while(cursor);
}
