package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import com.caoccao.javet.interop.NodeRuntime
import com.caoccao.javet.interop.V8Host
import com.caoccao.javet.enums.V8AwaitMode

/** Does not bind ApplicationService, open the SDK, select a resource or dispatch input. */
@RunWith(AndroidJUnit4::class)
class FileNativeObservationTest {
 @Test(timeout=30000) fun inspectRetainedSdkHistoryWithoutOpeningHarness(){
  val instrument=InstrumentationRegistry.getInstrumentation();val run=InstrumentationRegistry.getArguments().getString("executionRun")?:error("executionRun required")
  require(run.matches(Regex("[A-Za-z0-9-]{1,80}")));val context=instrument.targetContext
  val domain=File(context.filesDir,"application-validation/$run");val database=File(domain,"application.sqlite");check(database.isFile){"Existing validation database required"}
  val lease=StorageDomainLease.acquire(domain)?:error("Existing owner still active; observation must not compete")
  lease.use{
   val root=RuntimeBundle.unpack(context)
   V8Host.getNodeI18nInstance().createV8Runtime<NodeRuntime>().use{runtime->
    val storage=JSONObject.quote(File(root,"dist/storage.js").toURI().toString());val history=JSONObject.quote(File(root,"dist/retained-history.js").toURI().toString());val background=JSONObject.quote(File(root,"node_modules/@earendil-works/chord/dist/context/index.js").toURI().toString())
    val source="""(async()=>{const {openOwnedStorage}=await import($storage);const {RetainedHistory}=await import($history);const {BACKGROUND_CONTEXT:context}=await import($background);const {storage}=await openOwnedStorage(${JSONObject.quote(database.absolutePath)});const retained=await RetainedHistory.open(storage);if(!retained)throw Error('Public history unavailable');try{const rows=retained.list().conversations.slice(0,8);const result=[];for(const row of rows){const page=await retained.history(row.id,undefined,20);result.push({id:row.id,entries:page.items.map(e=>({id:e.id,role:e.role,text:e.text.slice(0,2048),truncated:e.text.length>2048})),more:!!page.next});}const record=await storage.findDocument({kind:'app.managed-document-index',scope:{kind:'session'}},'current',context);const index=record?await storage.document(record.id,'current',context):undefined;const documentOperationIds=index?.version===1?Object.keys(index.value.items).slice(0,20):[];const execRecord=await storage.findDocument({kind:'app.managed-execution-index',scope:{kind:'session'}},'current',context);const execIndex=execRecord?await storage.document(execRecord.id,'current',context):undefined;const executionIds=execIndex?.version===1?Object.keys(execIndex.value.items).slice(0,20):[];const taskPage=await storage.scanTasks({order:'ascending'},64,undefined,context);const submissionPage=await storage.scanSubmissions({order:'ascending'},64,undefined,context);const tasks=taskPage.items.map(t=>({id:t.id,conversationId:t.conversationId,kind:t.kind,owner:t.owner,abortRequested:t.abortRequested,abortReason:t.abortReason,background:t.background,restarts:t.restarts,startedAt:t.startedAt,endedAt:t.endedAt,status:t.state.status,outcome:t.state.outcome,checkpoint:JSON.stringify(t.state.checkpoint)?.slice(0,4096),input:JSON.stringify(t.input)?.slice(0,2048)}));globalThis.__historyResult=JSON.stringify({tasks,tasksLimited:!!taskPage.next,submissions:submissionPage.items,submissionsLimited:!!submissionPage.next,documentOperationIds,executionIds,run:${JSONObject.quote(run)},harnessNotOpened:true,modelTransportNotInstalled:true,conversations:result});}finally{await retained.close();}})().catch(e=>{globalThis.__historyFailure=String(e.message)});"""
    runtime.getExecutor("const vm=require('node:vm');new vm.Script("+JSONObject.quote(source)+",{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();").executeVoid()
    val deadline=SystemClock.elapsedRealtime()+20000
    while(runtime.getExecutor("typeof globalThis.__historyResult").executeString()!="string"){
     runtime.await(V8AwaitMode.RunNoWait);val failure=runtime.getExecutor("globalThis.__historyFailure||''").executeString();check(failure.isEmpty()){failure};check(SystemClock.elapsedRealtime()<deadline){"Retained history observation timeout"};Thread.sleep(10)
    }
    val result=JSONObject(runtime.getExecutor("globalThis.__historyResult").executeString())
    val observed=org.json.JSONArray();val ids=result.getJSONArray("documentOperationIds")
    NativeDocumentStore(context,NativeDocumentBridge.namespace("execution",run),NativeInputBridge.namespace("execution",run)).use{documents->
     for(i in 0 until ids.length()){val id=ids.getString(i);val before=SystemClock.elapsedRealtime();val row=JSONObject().put("operationId",id);try{row.put("receipt",documents.query(id))}catch(error:NativeDocumentException){row.put("errorCode",error.code)};row.put("elapsedMs",SystemClock.elapsedRealtime()-before);observed.put(row)}
    };result.put("nativeDocumentQueries",observed)
    val executions=org.json.JSONArray();val executionIds=result.getJSONArray("executionIds")
    ExecutionAccess(context).use{access->
     for(i in 0 until executionIds.length()){
      val id=executionIds.getString(i);val begun=JSONObject(access.beginJson("query",JSONObject().put("executionId",id).toString()));val record=JSONObject().put("executionId",id)
      if(!begun.optBoolean("ok"))record.put("response",begun)else{
       val token=begun.getJSONObject("value").getString("operationId");val deadline=SystemClock.elapsedRealtime()+10000
       while(true){val poll=JSONObject(access.pollJson(token));if(!poll.optBoolean("ok")){record.put("response",poll);break};val value=poll.getJSONObject("value");if(!value.getBoolean("pending")){record.put("response",value.getJSONObject("result"));break};if(SystemClock.elapsedRealtime()>=deadline){record.put("callerWaitExpired",true);break};Thread.sleep(20)}
      };executions.put(record)
     }
    };result.put("nativeExecutionQueries",executions)
    instrument.sendStatus(0,Bundle().apply{putString("retainedFileHistoryObservation",result.toString())})
   }
  }
 }
 @Test(timeout=30000) fun inspectExistingNativeDraftsWithoutOpeningOwner(){
  val instrument=InstrumentationRegistry.getInstrumentation();val args=InstrumentationRegistry.getArguments()
  val run=args.getString("executionRun")?:error("executionRun required");require(run.matches(Regex("[A-Za-z0-9-]{1,80}")))
  val mode=args.getString("executionMode")?:"execution-real";require(mode in setOf("execution","execution-real"))
  fun emit(method:String,id:String?,value:JSONObject?,code:String?,elapsed:Long){instrument.sendStatus(0,Bundle().apply{putString("nativeFileObservation",JSONObject().put("run",run).put("mode",mode).put("interface",method).put("id",id).put("value",value).put("errorCode",code).put("elapsedMs",elapsed).put("ownerNotOpened",true).toString())})}
  NativeInputStore(instrument.targetContext,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->
   val list=store.list();emit("input.list",null,list,null,0);val rows=list.getJSONArray("conversations")
   for(i in 0 until minOf(rows.length(),8)){
    val id=rows.getJSONObject(i).getString("id")
    for(method in listOf("input.inspect","input.readControl","input.listSends")){
     val before=SystemClock.elapsedRealtime();var code:String?=null
     val value=try{when(method){"input.inspect"->store.inspect(id);"input.readControl"->store.readControl(id);else->store.listSends(JSONObject().put("id",id))}}catch(error:NativeInputException){code=error.code;null}
     emit(method,id,value,code,SystemClock.elapsedRealtime()-before)
    }
   }
  }
 }
}
