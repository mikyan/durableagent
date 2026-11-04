package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
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

/** Reopen an already settled validation domain and observe only public read interfaces. Never sends input. */
@RunWith(AndroidJUnit4::class)
class ExecutionObservationTest {
 @Test(timeout=90000) fun inspectExistingCompletedRunThroughPublicInterfaces(){
  val instrumentation=InstrumentationRegistry.getInstrumentation();val run=InstrumentationRegistry.getArguments().getString("executionRun")?:error("executionRun is required")
  require(run.matches(Regex("[a-zA-Z0-9-]{1,80}")))
  val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();val states=LinkedBlockingQueue<JSONObject>();val connection=UUID.randomUUID().toString()
  val client=ApplicationClient(instrumentation.targetContext,"execution",run){what,text->if(what==12)states.offer(JSONObject(text));if(what==10){val value=JSONObject(text);pending.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
  fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("State timeout")}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=UUID.randomUUID().toString();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val response=future.get(30,TimeUnit.SECONDS);check(response.getBoolean("ok")){response.toString()};return response.getJSONObject("value")}
  fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("executionObservation",JSONObject().put("run",run).put("interface",name).put("value",value).toString())})}
  try{
   val deadline=SystemClock.elapsedRealtime()+30000;var status=state();while(status.optString("phase")!="ready"){check(status.optString("phase")!="failed"){status.toString()};check(SystemClock.elapsedRealtime()<deadline);Thread.sleep(30);status=state()};evidence("status",status)
   val list=call("list");evidence("list",list);val conversations=list.getJSONArray("conversations");assertTrue(conversations.length()>0)
   if(InstrumentationRegistry.getArguments().getString("fileQueueOnly")=="true"){
    for(i in 0 until minOf(conversations.length(),4)){
     val id=conversations.getJSONObject(i).getString("id");val target=JSONObject().put("id",id)
     for(method in listOf("execution.list","files.list","sendList")){val before=SystemClock.elapsedRealtime();val result=runCatching{call(method,target)};evidence(method,JSONObject().put("id",id).put("elapsedMs",SystemClock.elapsedRealtime()-before).put("result",result.getOrNull()).put("error",result.exceptionOrNull()?.message))}
     for(wait in listOf(0L,1000L))NativeInputStore(instrumentation.targetContext,NativeInputBridge.namespace("execution",run)).withLeaseWait(wait).use{store->
      for(method in listOf("readControl","inspect")){val before=SystemClock.elapsedRealtime();var code:String?=null;val result=try{if(method=="readControl")store.readControl(id) else store.inspect(id)}catch(error:NativeInputException){code=error.code;null};evidence("input.$method",JSONObject().put("id",id).put("leaseWaitMs",wait).put("elapsedMs",SystemClock.elapsedRealtime()-before).put("result",result).put("errorCode",code))}
     }
    }
    assertEquals("Observation must not start another model turn",0,state().getJSONObject("metrics").optInt("modelRequests"));return
   }
   for(i in 0 until minOf(conversations.length(),4)){val id=conversations.getJSONObject(i).getString("id");val open=call("open",JSONObject().put("id",id));evidence("open",open);evidence("history",call("history",JSONObject().put("id",id).put("limit",10)));evidence("input.readControl",NativeInputStore(instrumentation.targetContext,NativeInputBridge.namespace("execution",run)).use{it.readControl(id)});evidence("input.inspect",NativeInputStore(instrumentation.targetContext,NativeInputBridge.namespace("execution",run)).use{it.inspect(id)});evidence("projects.get",call("projects.get",JSONObject().put("id",id)));evidence("files.list",call("files.list",JSONObject().put("id",id)));evidence("sendList",call("sendList",JSONObject().put("id",id)));val executions=call("execution.list",JSONObject().put("id",id));evidence("execution.list",executions);val rows=executions.getJSONArray("executions");for(j in 0 until minOf(rows.length(),3)){val executionId=rows.getJSONObject(j).getString("executionId");var cursor=0;repeat(3){val output=call("execution.readOutput",JSONObject().put("id",id).put("executionId",executionId).put("cursor",cursor));evidence("execution.readOutput",output);cursor=output.getInt("nextCursor")}}}
   assertEquals("Observation must not start another model turn",0,state().getJSONObject("metrics").optInt("modelRequests"))
  }finally{client.control(20,"close");val deadline=SystemClock.elapsedRealtime()+15000;while(state().optString("phase")!="closed"&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(30);client.disconnect()}
 }
}
