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
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Actual provider -> SDK write/read -> original Termux file -> independent actual Bash read. */
@RunWith(AndroidJUnit4::class)
class FileRealProviderTest {
 @Test(timeout=240000) fun realMimoWritesReadsAndIndependentlyVerifiesTheOriginal(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext;val run=UUID.randomUUID().toString();val connection=UUID.randomUUID().toString()
  val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution-real").putExtra("validationRun",run))
  val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
  val client=ApplicationClient(context,"execution-real",run){what,text->val value=JSONObject(text);if(what==10)pending.remove(value.optString("requestId"))?.complete(value)else if(what>=12)controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}.apply{connect()}
  val store=NativeInputStore(context,NativeInputBridge.namespace("execution-real",run))
  fun until(timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Real file public observation timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(35)}}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=UUID.randomUUID().toString();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val value=future.get(30,TimeUnit.SECONDS);assertTrue(value.toString(),value.getBoolean("ok"));return value.getJSONObject("value")}
  fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("Real file control timeout")}
  fun js(source:String):String{val future=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(source){value->future.complete(value)}?:future.complete("null")};return future.get(10,TimeUnit.SECONDS)}
  fun click(selector:String){until{js("document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js("document.querySelector(${JSONObject.quote(selector)}).click()")}
  var observationPhase="opening";var observationId:String?=null
  try{
   until{val state=control(12);check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"};until{js("document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"};click("[data-testid=create-conversation]");until{call("list").getJSONArray("conversations").length()==1};val id=call("list").getJSONArray("conversations").getJSONObject(0).getString("id");val target=JSONObject().put("id",id);observationId=id
   fun send(tool:String,prompt:String,count:Int):JSONObject{
    observationPhase="$tool.control";control(57,tool) // This control acknowledges dispatch; status is refreshed by the next native pump.
    until(10000){control(12).getJSONObject("metrics").optString("executionValidationTool")==tool}
    observationPhase="$tool.draft-input";js("(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()");observationPhase="$tool.wait-saved";until{js("document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"&&store.inspect(id).getString("text")==prompt};observationPhase="$tool.click-send";click("[data-testid=send-message]")
    observationPhase="$tool.wait-tool";var snapshot=JSONObject();until{snapshot=call("open",target);val rows=snapshot.getJSONArray("entries");val tools=(0 until rows.length()).count{rows.getJSONObject(it).optString("role")=="tool"};assertTrue("Unexpected additional model tool",tools<=count);snapshot.optString("phase")=="done"&&tools==count};return snapshot
   }
   val path=".durableagent-t10-real-$run.txt";val content="MiMo-T10-原件-$run\n"
   send("write","请只调用一次 write 工具，将相对路径 $path 的专用测试原件写为这个 JSON 字符串表示的准确内容（包含末尾换行）：${JSONObject.quote(content)}。不要改其他文件。工具成功后中文确认。",1)
   val change=call("files.list",target).getJSONArray("changes");assertEquals(1,change.length());val original=change.getJSONObject(0);assertEquals("completed",original.getString("state"));assertTrue(original.getBoolean("scopeConfirmed"));assertTrue(original.getBoolean("original"))
   val read=send("read","请只调用一次 read 工具，读取原件 $path 的完整内容，不作修改；收到真实内容后简短确认。",2);val readEntries=read.getJSONArray("entries");assertTrue((0 until readEntries.length()).any{val row=readEntries.getJSONObject(it);row.optString("role")=="tool"&&row.optString("text").contains(content.trimEnd())})
   send("bash","请只调用一次 bash 工具执行这条只读命令：cat -- '$path'。不要改文件，收到输出后简短确认。",3)
   val executions=call("execution.list",target).getJSONArray("executions");assertEquals(2,executions.length());val verify=executions.getJSONObject(1);assertEquals("completed",verify.getString("state"));assertEquals(0,verify.getInt("exitCode"));assertTrue(verify.getBoolean("scopeConfirmed"));var cursor=0;val bytes=java.io.ByteArrayOutputStream();while(cursor<verify.getInt("outputCursor")){val output=call("execution.readOutput",JSONObject().put("id",id).put("executionId",verify.getString("executionId")).put("cursor",cursor));val chunks=output.getJSONArray("chunks");for(index in 0 until chunks.length()){val chunk=chunks.getJSONObject(index);assertEquals(++cursor,chunk.getInt("sequence"));if(chunk.getString("stream")=="stdout")bytes.write(android.util.Base64.decode(chunk.getString("data"),android.util.Base64.DEFAULT))};assertTrue(bytes.size()<4096)};assertEquals(content,bytes.toString("UTF-8"));val requests=control(12).getJSONObject("metrics").getInt("transportRequests");assertEquals(6,requests)
   instrumentation.sendStatus(0,Bundle().apply{putString("fileRealProviderEvidence",JSONObject().put("run",run).put("conversationId",id).put("original",original).put("readToolVerified",true).put("independentBash",verify).put("exactBytesBase64",android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP)).put("transportRequests",requests).put("tools",3).toString())})
  }catch(error:Throwable){
   val observed=JSONObject().put("run",run).put("phase",observationPhase).put("id",observationId).put("failure",error.javaClass.simpleName)
   runCatching{observed.put("status",control(12))}
   runCatching{observed.put("dom",js("JSON.stringify({draft:document.querySelector('[data-testid=draft-status]')?.dataset.state,sendDisabled:document.querySelector('[data-testid=send-message]')?.disabled,text:document.querySelector('[data-testid=message-input]')?.value,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})"))}
   observationId?.let{id->runCatching{observed.put("nativeDraft",store.inspect(id))}.onFailure{observed.put("nativeDraftError",(it as? NativeInputException)?.code?:it.javaClass.simpleName)};runCatching{observed.put("nativeSends",store.listSends(JSONObject().put("id",id)))}}
   instrumentation.sendStatus(0,Bundle().apply{putString("fileRealFailureObservation",observed.toString())});throw error
  }finally{page.close();store.close();client.control(20,"close");until(15000){control(12).optString("phase")=="closed"};client.disconnect()}
 }
}
