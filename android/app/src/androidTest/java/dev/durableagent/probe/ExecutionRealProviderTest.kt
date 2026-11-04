package dev.durableagent.probe

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real provider credentials are consumed only inside the existing encrypted native validation capsule. */
@RunWith(AndroidJUnit4::class)
class ExecutionRealProviderTest {
 @Test(timeout=240000) fun realMimoCallsManagedTermuxThroughTheConversation(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext;val run=UUID.randomUUID().toString();val connection=UUID.randomUUID().toString()
  val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution-real").putExtra("validationRun",run))
  val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();val states=LinkedBlockingQueue<JSONObject>()
  val client=ApplicationClient(context,"execution-real",run){what,text->if(what==12)states.offer(JSONObject(text));if(what==10){val value=JSONObject(text);pending.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
  fun until(timeout:Long=120000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Real execution observation timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(35)}}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=UUID.randomUUID().toString();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val response=future.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
  fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Real execution host timeout")}
  fun js(source:String):String{val future=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(source){value->future.complete(value)}?:future.complete("null")};return future.get(10,TimeUnit.SECONDS)}
  fun click(selector:String){until{js("document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js("document.querySelector(${JSONObject.quote(selector)}).click()")}
  try{
   until{val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"};until{js("document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"};click("[data-testid=create-conversation]");until{call("list").getJSONArray("conversations").length()==1};val productId=call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
   val marker="MiMo-Termux-世界-$run";val prompt="请调用 bash 工具，准确执行这条无副作用命令：printf '%s\\n' '$marker'。只执行一次；收到工具结果后用一句中文确认，不要调用其他工具。"
   js("(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()");until{js("document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"};click("[data-testid=send-message]")
   var record=JSONObject();until{val executions=call("execution.list",JSONObject().put("id",productId)).getJSONArray("executions");if(executions.length()==0)return@until false;assertEquals(1,executions.length());record=executions.getJSONObject(0);val opened=call("open",JSONObject().put("id",productId));if(opened.optString("phase")=="failed")error(opened.toString());record.optString("state")=="completed"&&opened.optString("phase")=="done"}
   assertEquals(0,record.getInt("exitCode"));assertFalse(record.getBoolean("captureIncomplete"));assertTrue(record.getString("namespace").startsWith("termux:"));val entries=call("open",JSONObject().put("id",productId)).getJSONArray("entries");assertEquals(1,(0 until entries.length()).count{entries.getJSONObject(it).getString("role")=="tool"});assertTrue((0 until entries.length()).any{val entry=entries.getJSONObject(it);entry.getString("role")=="tool"&&entry.getString("text").contains(marker)})
   val raw=ByteArrayOutputStream();var cursor=0;while(cursor<record.getInt("outputCursor")){val output=call("execution.readOutput",JSONObject().put("id",productId).put("executionId",record.getString("executionId")).put("cursor",cursor));val chunks=output.getJSONArray("chunks");for(i in 0 until chunks.length()){val chunk=chunks.getJSONObject(i);assertEquals(++cursor,chunk.getInt("sequence"));if(chunk.getString("stream")=="stdout")raw.write(android.util.Base64.decode(chunk.getString("data"),android.util.Base64.DEFAULT))};assertEquals(cursor,output.getInt("nextCursor"));assertTrue(raw.size()<4096)};assertEquals(marker+"\n",raw.toString("UTF-8"));val metrics=state().getJSONObject("metrics");assertEquals(2,metrics.getInt("transportRequests"))
   instrumentation.sendStatus(0,Bundle().apply{putString("executionRealProviderEvidence",JSONObject().put("run",run).put("conversationId",productId).put("execution",record).put("transportRequests",metrics.getInt("transportRequests")).put("actualStdout",raw.toString("UTF-8")).put("toolResults",1).toString())})
  }finally{page.close();client.control(20,"close");until(15000){state().optString("phase")=="closed"};client.disconnect()}
 }
}
