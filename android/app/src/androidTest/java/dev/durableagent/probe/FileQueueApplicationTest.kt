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
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class FileQueueApplicationTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation();private val context=instrumentation.targetContext
 private fun uuid()=UUID.randomUUID().toString()
 private fun target(id:String)=JSONObject().put("id",id)
 private fun until(timeout:Long=60000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Public file queue state timed out",SystemClock.elapsedRealtime()<end);Thread.sleep(25)}}
 private inner class Wire(val run:String):AutoCloseable {
  private val connection=uuid();private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
  val client=ApplicationClient(context,"execution",run){what,text->if(what>=10){val value=JSONObject(text);if(what==10)pending.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=uuid();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val value=future.get(30,TimeUnit.SECONDS);check(value.getBoolean("ok")){value.toString()};return value.getJSONObject("value")}
  fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("File queue control timeout $what")}
  fun ready(){until{val state=control(12);check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"}}
  fun closeHost(){client.control(20,"close");until(15000){control(12).optString("phase")=="closed"}}
  override fun close(){client.disconnect()}
 }
 private var activeRun="";private var activeOrder=""
 private fun trace(phase:String,id:String?=null,code:String?=null){instrumentation.sendStatus(0,Bundle().apply{putString("fileQueuePhase",JSONObject().put("run",activeRun).put("order",activeOrder).put("phase",phase).put("id",id).put("code",code).toString())})}
 private fun <T> nativeStep(id:String,phase:String,action:()->T):T{trace(phase+".before",id);return try{action().also{trace(phase+".after",id)}}catch(error:NativeInputException){trace(phase+".failed",id,error.code);throw IllegalStateException("Native fixture $phase failed for $id in $activeRun: ${error.code}",error)}}
 private fun prepare(store:NativeInputStore,id:String,text:String):String {
  val before=nativeStep(id,"inspect"){store.inspect(id)}
  val saved=nativeStep(id,"save"){store.save(id,before.getLong("revision"),uuid(),text,emptyList())}
  val frozen=nativeStep(id,"freeze"){store.freeze(id,saved.getLong("revision"),uuid())}
  val current=nativeStep(id,"inspect-context"){store.inspect(id)}
  val control=nativeStep(id,"read-control"){store.readControl(id)}
  return nativeStep(id,"create-send"){store.createSend(JSONObject().put("actionId",uuid()).put("id",id).put("inputToken",frozen.getString("token")).put("expectedContext",current.getJSONObject("submissionContext")).put("expectedControlVersion",control.getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))}.getString("intentId")
 }
 private fun execution(wire:Wire,id:String):JSONObject? {val rows=wire.call("execution.list",target(id)).getJSONArray("executions");return if(rows.length()==0)null else rows.getJSONObject(rows.length()-1)}
 private fun texts(wire:Wire,id:String):List<String>{val rows=wire.call("open",target(id)).getJSONArray("entries");return (0 until rows.length()).map{rows.getJSONObject(it).optString("text","")}}
 private fun completed(wire:Wire,intentId:String){until{wire.call("sendStatus",JSONObject().put("intentId",intentId)).optJSONObject("submission")?.optString("status")=="done"}}

 @Test(timeout=240000) fun actualLocalReservationAndUnknownShellSerializeBothOrdersAndQueuedStop(){
  for(order in listOf("local-reserved-first","shell-first","cancel-local")){
   val run=uuid();val wire=Wire(run);val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run));val store=NativeInputStore(context,NativeInputBridge.namespace("execution",run)).withLeaseWait(1000)
   activeRun=run;activeOrder=order;trace("scenario.begin")
   try{
    wire.ready();for(id in listOf("local","shell","pure","read"))wire.call("create",JSONObject().put("creationId",id))
    val localFirst=order=="local-reserved-first";val first=if(localFirst)"local" else "shell";val second=if(localFirst)"shell" else "local"
    if(localFirst)wire.control(58,"arm")
    val firstIntent=prepare(store,first,if(localFirst)"FILE_QUEUE_LOCAL" else "FILE_QUEUE_SHELL");wire.call("send",JSONObject().put("intentId",firstIntent))
    if(localFirst)until{wire.control(12).optJSONObject("metrics")?.optJSONObject("executionWriteGate")?.optString("state")=="held"}
    else until{execution(wire,"shell")?.optString("state")=="running"}
    val secondIntent=prepare(store,second,if(localFirst)"FILE_QUEUE_SHELL" else "FILE_QUEUE_LOCAL");wire.call("send",JSONObject().put("intentId",secondIntent))
    until{execution(wire,second)?.optString("state")=="queued"};val waiting=execution(wire,second)!!
    val pure=prepare(store,"pure","FILE_PURE");wire.call("send",JSONObject().put("intentId",pure));completed(wire,pure);assertTrue(texts(wire,"pure").contains("FILE-PURE-PASS"));assertEquals("queued",execution(wire,second)!!.getString("state"))
    if(order=="cancel-local"){
     val control=nativeStep("local","stop.read-control"){store.readControl("local")};val stopped=NativeStopController.request(context,"execution",run,JSONObject().put("id","local").put("actionId",uuid()).put("expectedControlVersion",control.getLong("version")))
     wire.call("stop",target("local").put("stopId",stopped.getJSONObject("pendingAbort").getString("stopId")))
     until{execution(wire,"local")?.optString("state")=="not_started"}
     val change=wire.call("files.list",target("local")).getJSONArray("changes").getJSONObject(0);assertEquals("not_started",change.getString("state"));assertTrue(change.getBoolean("scopeConfirmed"))
    }
    if(localFirst){assertEquals("held",wire.control(12).getJSONObject("metrics").getJSONObject("executionWriteGate").getString("state"));wire.control(58,"release")}
    completed(wire,firstIntent);if(order!="cancel-local")completed(wire,secondIntent)
    val read=prepare(store,"read","FILE_QUEUE_READ");wire.call("send",JSONObject().put("intentId",read));completed(wire,read)
    val observed=JSONObject(texts(wire,"read").last{it.startsWith("FILE-QUEUE-READ:")}.removePrefix("FILE-QUEUE-READ:"));assertEquals(if(localFirst)"local\nshell\n" else if(order=="cancel-local")"shell\n" else "shell\nlocal\n",observed.getString("text"))
    val local=execution(wire,"local")!!;val shell=execution(wire,"shell")!!;assertEquals(if(order=="cancel-local")"not_started" else "completed",local.getString("state"));assertEquals("completed",shell.getString("state"))
    instrumentation.sendStatus(0,Bundle().apply{putString("fileQueueEvidence",JSONObject().put("run",run).put("order",order).put("waiting",waiting).put("local",local).put("shell",shell).put("original",observed).put("pureToolContinued",true).put("localGateWasBeforeExternalPrepare",localFirst).toString())})
   }finally{runCatching{wire.control(58,"release")};page.close();store.close();try{wire.closeHost()}finally{wire.close()}}
  }
 }
}
