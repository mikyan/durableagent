package dev.durableagent.probe

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real :agent SIGKILL; the Termux authority remains a separate UID/process with its own evidence. */
@RunWith(AndroidJUnit4::class)
class ExecutionRecoveryTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation();private val context=instrumentation.targetContext
 private fun uuid()=UUID.randomUUID().toString()
 private fun target(id:String)=JSONObject().put("id",id)
 private fun until(timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Execution recovery timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
 private inner class Wire(val run:String):AutoCloseable {
  private val connection=uuid();private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
  val client=ApplicationClient(context,"execution",run){what,text->if(what>=10){val value=JSONObject(text);if(what==10)pending.remove(value.optString("requestId"))?.complete(value)else if(what>=12)controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
  fun async(method:String,payload:JSONObject=JSONObject()):CompletableFuture<JSONObject>{val id=uuid();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());return future}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val result=async(method,payload).get(30,TimeUnit.SECONDS);assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")}
  fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("Control timeout $what")}
  fun ready():JSONObject{var state=JSONObject();until{state=control(12);check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"};return state}
  fun closeHost(){client.control(20,"close");until(15000){val value=control(12);value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
  override fun close(){client.disconnect()}
 }
 private fun prepare(store:NativeInputStore,id:String,text:String):String{val before=store.inspect(id);val saved=store.save(id,before.getLong("revision"),uuid(),text,emptyList());val frozen=store.freeze(id,saved.getLong("revision"),uuid());return store.createSend(JSONObject().put("actionId",uuid()).put("id",id).put("inputToken",frozen.getString("token")).put("expectedContext",store.inspect(id).getJSONObject("submissionContext")).put("expectedControlVersion",store.readControl(id).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start"))).getString("intentId")}

 @Test(timeout=120000) fun actualCompleteRawOutputIsReadThroughTheSameEnvironment(){
  val run=uuid();val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run));val wire=Wire(run);val store=NativeInputStore(context,NativeInputBridge.namespace("execution",run));val id="raw-output"
  try{wire.ready();wire.call("create",JSONObject().put("creationId",id));val intent=prepare(store,id,"EXEC_RAW_OUTPUT");wire.call("send",JSONObject().put("intentId",intent));until{wire.call("open",target(id)).optString("phase")=="done"};val executions=wire.call("execution.list",target(id)).getJSONArray("executions");assertEquals(1,executions.length());val receipt=executions.getJSONObject(0);assertEquals("completed",receipt.getString("state"));assertEquals(1200000,receipt.getInt("outputBytes"));assertFalse(receipt.getBoolean("captureIncomplete"));val entries=wire.call("open",target(id)).getJSONArray("entries");assertTrue((0 until entries.length()).any{entries.getJSONObject(it).getString("role")=="tool"&&entries.getJSONObject(it).getString("text")=="raw-reference-verified:1200000:"+receipt.getString("rawSha256")});instrumentation.sendStatus(0,Bundle().apply{putString("executionRawEvidence",JSONObject().put("run",run).put("receipt",receipt).put("sameEnvironmentExactBytesVerified",1200000).toString())})
  }finally{page.close();store.close();try{wire.closeHost()}finally{wire.close()}}
 }

 @Test(timeout=360000) fun actualOwnerDeathAcrossFourExecutionWindowsDoesNotRepeatTheEffect(){
  for(stage in listOf("intent-persisted","accepted","output-checkpoint","before-result")){
   val run=uuid();var page:ActivityScenario<AgentActivity>?=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run));var wire=Wire(run);val store=NativeInputStore(context,NativeInputBridge.namespace("execution",run));val id="recover-$stage";var halted=false
   try{
    val original=wire.ready();wire.call("create",JSONObject().put("creationId",id));val intentId=prepare(store,id,"EXEC_SUCCESS");wire.control(43,stage);wire.async("send",JSONObject().put("intentId",intentId));var boundary=JSONObject();until{boundary=wire.control(37);boundary.optString("stage")=="execution-$stage"};halted=true
    assertEquals(original.getInt("pid"),boundary.getInt("pid"));assertNotEquals(android.os.Process.myPid(),boundary.getInt("pid"));val domain=File(context.filesDir,"application-validation/$run");assertNull(StorageDomainLease.acquire(domain));page?.close();page=null;wire.client.control(38);until(15000){StorageDomainLease.acquire(domain)?.let{it.close();true}?:false};wire.close();halted=false
    wire=Wire(run);val reopened=wire.ready();assertNotEquals(original.getInt("pid"),reopened.getInt("pid"));assertNotEquals(original.getString("instance"),reopened.getString("instance"));until{wire.call("open",target(id)).optString("phase")=="done"}
    val records=wire.call("execution.list",target(id)).getJSONArray("executions");assertEquals(1,records.length());val execution=records.getJSONObject(0);assertEquals("completed",execution.getString("state"));assertEquals(0,execution.getInt("exitCode"));val opened=wire.call("open",target(id));val entries=opened.getJSONArray("entries");assertEquals(1,(0 until entries.length()).count{entries.getJSONObject(it).getString("role")=="tool"});assertTrue((0 until entries.length()).any{entries.getJSONObject(it).optString("text").contains("Termux SDK 世界")})
    val verification=prepare(store,id,"EXEC_VERIFY_SUCCESS");wire.call("send",JSONObject().put("intentId",verification));until{wire.call("execution.list",target(id)).getJSONArray("executions").length()==2&&wire.call("open",target(id)).optString("phase")=="done"};val verified=wire.call("open",target(id)).getJSONArray("entries");assertTrue((0 until verified.length()).any{verified.getJSONObject(it).optString("text").contains("exactly-one-effect")});val requests=wire.control(12).getJSONObject("metrics").getInt("modelRequests");wire.call("send",JSONObject().put("intentId",intentId));assertEquals(2,wire.call("execution.list",target(id)).getJSONArray("executions").length());assertEquals(requests,wire.control(12).getJSONObject("metrics").getInt("modelRequests"))
    instrumentation.sendStatus(0,Bundle().apply{putString("executionRecoveryEvidence",JSONObject().put("stage",stage).put("run",run).put("boundary",boundary).put("reopenedPid",reopened.getInt("pid")).put("execution",execution).put("verifiedExactlyOneEffect",true).put("sameIntentAddedExecutions",0).toString())})
   }finally{page?.close();store.close();try{if(halted)wire.client.control(38)else wire.closeHost()}finally{wire.close()}}
  }
 }

 @Test(timeout=180000) fun actualOwnerDiesAfterOriginalAppendAndRecoveryDoesNotAppendAgain(){
  val run=uuid();var page:ActivityScenario<AgentActivity>?=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run));var wire=Wire(run);val store=NativeInputStore(context,NativeInputBridge.namespace("execution",run));val id="recover-original";var halted=false
  try{
   val before=wire.ready();wire.call("create",JSONObject().put("creationId",id));val intent=prepare(store,id,"FILE_QUEUE_LOCAL");wire.control(43,"before-result");wire.async("send",JSONObject().put("intentId",intent));var boundary=JSONObject();until{boundary=wire.control(37);boundary.optString("stage")=="execution-before-result"};halted=true
   assertEquals(before.getInt("pid"),boundary.getInt("pid"));val domain=File(context.filesDir,"application-validation/$run");assertNull(StorageDomainLease.acquire(domain));page?.close();page=null;wire.client.control(38);until(15000){StorageDomainLease.acquire(domain)?.let{it.close();true}?:false};wire.close();halted=false
   wire=Wire(run);val after=wire.ready();assertNotEquals(before.getInt("pid"),after.getInt("pid"));until{wire.call("sendStatus",JSONObject().put("intentId",intent)).optJSONObject("submission")?.optString("status")=="done"}
   val executions=wire.call("execution.list",target(id)).getJSONArray("executions");assertEquals(1,executions.length());val execution=executions.getJSONObject(0);assertEquals("completed",execution.getString("state"));val changes=wire.call("files.list",target(id)).getJSONArray("changes");assertEquals(1,changes.length());val original=changes.getJSONObject(0);assertEquals("completed",original.getString("state"));assertTrue(original.getBoolean("scopeConfirmed"));assertTrue(original.getBoolean("original"))
   val verify=prepare(store,id,"FILE_QUEUE_READ");wire.call("send",JSONObject().put("intentId",verify));until{wire.call("sendStatus",JSONObject().put("intentId",verify)).optJSONObject("submission")?.optString("status")=="done"}
   val entries=wire.call("open",target(id)).getJSONArray("entries");val text=(0 until entries.length()).map{entries.getJSONObject(it).optString("text","")}.last{it.startsWith("FILE-QUEUE-READ:")};val read=JSONObject(text.removePrefix("FILE-QUEUE-READ:"));assertEquals("local\n",read.getString("text"))
   val requests=wire.control(12).getJSONObject("metrics").getInt("modelRequests");wire.call("send",JSONObject().put("intentId",intent));assertEquals(1,wire.call("execution.list",target(id)).getJSONArray("executions").length());assertEquals(requests,wire.control(12).getJSONObject("metrics").getInt("modelRequests"))
   instrumentation.sendStatus(0,Bundle().apply{putString("originalRecoveryEvidence",JSONObject().put("run",run).put("beforePid",before.getInt("pid")).put("afterPid",after.getInt("pid")).put("boundary",boundary).put("original",original).put("read",read).put("sameIntentAddedExecutions",0).toString())})
  }finally{page?.close();store.close();try{if(halted)wire.client.control(38)else wire.closeHost()}finally{wire.close()}}
 }
}
