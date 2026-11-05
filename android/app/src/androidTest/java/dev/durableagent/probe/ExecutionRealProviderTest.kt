package dev.durableagent.probe

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Real provider credentials are consumed only inside the existing encrypted native validation capsule. */
@RunWith(AndroidJUnit4::class)
class ExecutionRealProviderTest {
 /** An independent live acceptance: the prompt does not supply the expected environment facts. */
 @Test(timeout=240000) fun realMimoIdentifiesAndroidAndItsActualTermuxWorkspace(){
  assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val context=instrumentation.targetContext
  val run=UUID.randomUUID().toString()
  val connection=UUID.randomUUID().toString()
  val marker="environment-世界-$run"
  val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java)
   .putExtra("validationMode","execution-real").putExtra("validationRun",run))
  val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
  val states=LinkedBlockingQueue<JSONObject>()
  val client=ApplicationClient(context,"execution-real",run){what,text->
   if(what==12)states.offer(JSONObject(text))
   if(what==10){val response=JSONObject(text);pending.remove(response.optString("requestId"))?.complete(response)}
  }.apply{connect()}
  val input=NativeInputStore(context,NativeInputBridge.namespace("execution-real",run))
  val backgrounded=AtomicBoolean(false)
  val lifecycle=ActivityLifecycleCallback{activity,stage->
   if(activity is AgentActivity&&activity.intent.getStringExtra("validationRun")==run&&stage in setOf(Stage.PAUSED,Stage.STOPPED))backgrounded.set(true)
  }
  instrumentation.runOnMainSync{ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(lifecycle)}
  fun foreground(){assertFalse("Acceptance requires AgentActivity foreground; bringing Termux forward cannot satisfy it",backgrounded.get())}
  fun until(timeout:Long=120000,condition:()->Boolean){
   val end=SystemClock.elapsedRealtime()+timeout
   while(!condition()){foreground();assertTrue("Live environment observation timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(50)}
  }
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{
   val id=UUID.randomUUID().toString();val future=CompletableFuture<JSONObject>();pending[id]=future
   client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString())
   val response=future.get(30,TimeUnit.SECONDS)
   assertTrue("Public application call failed: $method ${response.optJSONObject("error")?.optString("code")}",response.getBoolean("ok"))
   return response.getJSONObject("value")
  }
  fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Live environment host status timeout")}
  fun js(source:String):String{
   val future=CompletableFuture<String>()
   page.onActivity{it.webView?.evaluateJavascript(source){value->future.complete(value)}?:future.complete("null")}
   return future.get(10,TimeUnit.SECONDS)
  }
  fun click(selector:String){until{js("document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js("document.querySelector(${JSONObject.quote(selector)}).click()")}
  var stage="opening"
  try{
   until{val observed=state();assertNotEquals("Application failed before live request","failed",observed.optString("phase"));observed.optString("phase")=="ready"}
   until{js("document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}
   click("[data-testid=create-conversation]")
   until{call("list").getJSONArray("conversations").length()==1}
   val id=call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
   val target=JSONObject().put("id",id)
   val catalog=call("projects.get",target)
   val selection=catalog.getJSONObject("selection")
   val workspaces=catalog.getJSONArray("workspaces")
   val workspace=(0 until workspaces.length()).map{workspaces.getJSONObject(it)}.single{it.getString("id")==selection.getString("workspaceId")}
   val adoptedPath=workspace.getString("path")
   // No expected platform, provider, UID, version, ABI or workspace value is supplied to the model.
   val command="printf 'kernel='; uname -s; printf 'api='; /system/bin/getprop ro.build.version.sdk; printf 'abi='; /system/bin/getprop ro.product.cpu.abi; printf 'pwd='; pwd -P; printf 'uid='; id -u; printf 'marker=%s\\n' '$marker'"
   val prompt="""
    请验收你本次实际运行环境。先根据系统提供的环境说明确定核心宿主平台、Bash 执行提供者、是否独立 UID、已采用工作区路径和宿主 API 级别，不能从猜测或应用进程 cwd 补值。
    只调用一次 bash，原样运行下面的只读命令。不要 cd，不指定 cwd，不调用其他工具，不重试；失败时如实报告失败。
    $command
    收到真实工具结果后，只输出一个 JSON 对象，不要 Markdown 围栏。字段 hostPlatform、toolProvider、independentUid（布尔值）、adoptedPath、hostAndroidApi（整数）必须来自系统环境说明；hostPlatform 和 toolProvider 使用该平台或产品的英文名称，不附加解释；kernel、androidApi（整数）、deviceAbi、physicalCwd、toolUid（整数）、marker 必须来自工具的对应实际输出。
   """.trimIndent()
   stage="sending"
   until{js("document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"}
   js("(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")
   until{js("document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"&&input.inspect(id).getString("text")==prompt}
   val inputRevision=input.inspect(id).getLong("revision")
   click("[data-testid=send-message]")
   stage="model-and-execution"
   var snapshot=JSONObject();var receipt=JSONObject()
   until{
    snapshot=call("open",target)
    assertNotEquals("Live conversation failed: ${snapshot.optString("reason")}","failed",snapshot.optString("phase"))
    val sends=call("sendList",target).getJSONArray("items")
    val submission=(0 until sends.length()).map{sends.getJSONObject(it)}.firstOrNull{it.getJSONObject("intent").getLong("inputRevision")==inputRevision}?.optJSONObject("submission")
    assertNotEquals("Live model request settled without an answer","unanswered",submission?.optString("status"))
    val rows=call("execution.list",target).getJSONArray("executions")
    assertTrue("Model must execute exactly one command without retry",rows.length()<=1)
    if(rows.length()==1)receipt=rows.getJSONObject(0)
    if(snapshot.optString("phase")=="done"){
     assertEquals("A model greeting cannot replace the real command",1,rows.length())
     assertEquals("completed",receipt.getString("state"));true
    }else false
   }
   foreground()
   assertEquals(0,receipt.getInt("exitCode"))
   assertTrue(receipt.getBoolean("scopeConfirmed"))
   assertFalse(receipt.getBoolean("captureIncomplete"))
   assertTrue(receipt.getString("namespace").startsWith("termux:"))
   assertEquals(id,receipt.getJSONObject("context").getString("productId"))
   assertTrue(receipt.getString("requestDigest").matches(Regex("[a-f0-9]{64}")))
   assertTrue(receipt.getString("finalDigest").matches(Regex("[a-f0-9]{64}")))
   stage="raw-output"
   val stdout=ByteArrayOutputStream();val stderr=ByteArrayOutputStream();var cursor=0
   while(cursor<receipt.getInt("outputCursor")){
    val previous=cursor
    val output=call("execution.readOutput",JSONObject().put("id",id).put("executionId",receipt.getString("executionId")).put("cursor",cursor))
    val chunks=output.getJSONArray("chunks")
    for(index in 0 until chunks.length()){
     val chunk=chunks.getJSONObject(index);assertEquals(++cursor,chunk.getInt("sequence"))
     val stream=chunk.getString("stream");assertTrue(stream in setOf("stdout","stderr"))
     (if(stream=="stdout")stdout else stderr).write(android.util.Base64.decode(chunk.getString("data"),android.util.Base64.DEFAULT))
    }
    assertTrue("Output cursor must advance",cursor>previous);assertEquals(cursor,output.getInt("nextCursor"))
    assertTrue(stdout.size()+stderr.size()<8192)
   }
   assertEquals("Read-only environment command must not fail silently","",stderr.toString("UTF-8"))
   val raw=stdout.toString("UTF-8")
   val lines=raw.trimEnd('\n').split('\n')
   assertEquals(6,lines.size)
   val facts=lines.associate{line->val split=line.indexOf('=');assertTrue(split>0);line.substring(0,split) to line.substring(split+1)}
   assertEquals(setOf("kernel","api","abi","pwd","uid","marker"),facts.keys)
   assertEquals("Linux",facts["kernel"])
   assertEquals(Build.VERSION.SDK_INT.toString(),facts["api"])
   assertEquals(Build.SUPPORTED_ABIS.first(),facts["abi"])
   val termuxUid=context.packageManager.getApplicationInfo("com.termux",0).uid
   assertEquals(termuxUid.toString(),facts["uid"]);assertNotEquals(context.applicationInfo.uid,termuxUid)
   assertEquals(marker,facts["marker"])
   // Independent authenticated location inspection handles real /data/data aliases without guessing.
   stage="workspace-inspection"
   val actualLocation=ExecutionAccess(context).use{access->
    fun unwrap(text:String):JSONObject{val value=JSONObject(text);assertTrue("Authenticated workspace inspection failed: ${value.optJSONObject("error")?.optString("code")}",value.getBoolean("ok"));return value.getJSONObject("value")}
    val operation=unwrap(access.beginJson("inspectWorkspace",JSONObject().put("path",adoptedPath).toString())).getString("operationId")
    var polled=JSONObject()
    until(40000){polled=unwrap(access.pollJson(operation));!polled.getBoolean("pending")}
    unwrap(polled.getJSONObject("result").toString())
   }
   assertEquals("available",actualLocation.getString("state"))
   assertEquals(receipt.getString("namespace"),actualLocation.getString("namespace"))
   assertEquals(actualLocation.getString("realPath"),facts["pwd"])
   stage="model-answer"
   val entries=snapshot.getJSONArray("entries")
   val rows=(0 until entries.length()).map{entries.getJSONObject(it)}
   val tool=rows.single{it.getString("role")=="tool"}.getString("text")
   assertTrue(tool.contains(marker));assertTrue(tool.contains(facts.getValue("pwd")))
   val answer=JSONObject(rows.last{it.getString("role")=="assistant"}.getString("text").trim())
   assertEquals("android",answer.getString("hostPlatform").lowercase())
   assertEquals("termux",answer.getString("toolProvider").lowercase())
   assertTrue(answer.getBoolean("independentUid"))
   assertEquals(adoptedPath,answer.getString("adoptedPath"))
   assertEquals(Build.VERSION.SDK_INT,answer.getInt("hostAndroidApi"))
   assertEquals(facts["kernel"],answer.getString("kernel"))
   assertEquals(Build.VERSION.SDK_INT,answer.getInt("androidApi"))
   assertEquals(facts["abi"],answer.getString("deviceAbi"))
   assertEquals(facts["pwd"],answer.getString("physicalCwd"))
   assertEquals(termuxUid,answer.getInt("toolUid"))
   assertEquals(marker,answer.getString("marker"))
   val metrics=state().getJSONObject("metrics")
   assertEquals(2,metrics.getInt("transportRequests"))
   assertEquals(2,metrics.getInt("environmentRequestCount"))
   assertFalse(metrics.optBoolean("environmentObservationFailed"))
   val system=metrics.getJSONObject("environmentFirstRequest")
   assertTrue("Environment must be in the actual system request before any tool output",system.getBoolean("present"))
   assertEquals("android",system.getJSONObject("host").getString("platform"))
   assertEquals(Build.VERSION.SDK_INT,system.getJSONObject("host").getInt("androidApi"))
   assertEquals(Build.VERSION.RELEASE,system.getJSONObject("host").getString("androidRelease"))
   assertEquals(Build.SUPPORTED_ABIS.toList(),system.getJSONObject("host").getJSONArray("supportedAbis").let{abis->(0 until abis.length()).map{abis.getString(it)}})
   assertEquals("adopted",system.getString("binding"))
   assertEquals(adoptedPath,system.getString("adoptedPath"))
   assertTrue(system.getBoolean("describesIndependentTermuxUid"));assertTrue(system.getBoolean("offersBash"))
   val modelCalls=metrics.getJSONArray("environmentTranscriptTools")
   assertEquals(1,modelCalls.length())
   val bash=modelCalls.getJSONObject(0)
   assertEquals("bash",bash.getString("name"))
   assertTrue(bash.getBoolean("validArguments"))
   val argumentKeys=bash.getJSONArray("argumentKeys").let{keys->(0 until keys.length()).map{keys.getString(it)}}
   assertTrue(argumentKeys.contains("command"));assertTrue("Model must not override cwd or other options",argumentKeys.all{it in setOf("command","timeout")})
   assertEquals("Model must execute the exact command without cd or injected expected facts",MessageDigest.getInstance("SHA-256").digest(command.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)},bash.getString("commandSha256"))
   foreground()
   instrumentation.sendStatus(0,Bundle().apply{putString("executionEnvironmentEvidence",JSONObject()
    .put("run",run).put("conversationId",id).put("execution",receipt).put("actualStdout",raw)
    .put("adoptedPath",adoptedPath).put("realPath",actualLocation.getString("realPath")).put("modelAnswer",answer)
    .put("systemRequestEnvironment",system).put("modelToolCall",bash)
    .put("appStayedForeground",true).put("transportRequests",2).put("explicitBashChoice",true).toString())})
  }catch(error:Throwable){
   instrumentation.sendStatus(0,Bundle().apply{putString("executionEnvironmentFailure",JSONObject().put("run",run).put("stage",stage).put("failure",error.javaClass.simpleName).put("appBackgrounded",backgrounded.get()).toString())})
   throw error
  }finally{
   instrumentation.runOnMainSync{ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(lifecycle)}
   page.close();input.close();client.control(20,"close")
   try{val end=SystemClock.elapsedRealtime()+15000;while(state().optString("phase")!="closed"&&SystemClock.elapsedRealtime()<end)Thread.sleep(50)}finally{client.disconnect()}
  }
 }

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
