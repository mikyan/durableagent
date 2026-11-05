package dev.durableagent.probe

import android.content.Intent
import android.app.ActivityManager
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.util.Base64
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

/** Explicit root opt-in. Real MiMo, persisted CredentialVault and the installed managed executor. */
@RunWith(AndroidJUnit4::class)
class RecoveryRealApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    @Suppress("DEPRECATION") private fun service()=context.getSystemService(ActivityManager::class.java).getRunningServices(Int.MAX_VALUE).find{it.service.className==ApplicationService::class.java.name}
    private fun until(label:String,timeout:Long=120000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        private val connection=id();private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val key=id();val future=CompletableFuture<JSONObject>();replies[key]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",key).put("method",method).put("payload",payload).toString());val response=future.get(35,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun state(timeout:Long=5):JSONObject?{val queue=controls.computeIfAbsent(12){LinkedBlockingQueue()};queue.clear();client.control(12);return queue.poll(timeout,TimeUnit.SECONDS)}
        fun ready(previousPid:Int?=null):JSONObject {var state=JSONObject();until("Real recovery owner ready"){val observed=state(2);if(observed==null)false else{state=observed;check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"&&(previousPid==null||state.getInt("pid")!=previousPid)}};return state}
        fun importKey(target:String){val queue=controls.computeIfAbsent(31){LinkedBlockingQueue()};queue.clear();client.control(31,JSONObject().put("target",target).put("expectedGeneration",0).toString());val result=queue.poll(15,TimeUnit.SECONDS)?:error("Encrypted validation import timed out");assertTrue(result.toString(),result.getBoolean("ok"))}
        fun closeHost(){client.control(20,"close");until("Real recovery owner closes",30000){state()?.optString("phase")=="closed"}}
        override fun close(){client.disconnect()}
    }
    private fun rpc(access:ExecutionAccess,method:String,payload:JSONObject):JSONObject {
        val begun=JSONObject(access.beginJson(method,payload.toString()));assertTrue(begun.toString(),begun.getBoolean("ok"));val operation=begun.getJSONObject("value").getString("operationId");var result=JSONObject()
        until("Read-only native execution observation",15000){val reply=JSONObject(access.pollJson(operation));assertTrue(reply.toString(),reply.getBoolean("ok"));val value=reply.getJSONObject("value");if(value.getBoolean("pending"))false else{result=value.getJSONObject("result");true}}
        assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")
    }
    private fun file(access:ExecutionAccess,path:String):String {
        val opened=rpc(access,"file.open",JSONObject().put("path",path).put("noFollow",true));assertTrue(opened.toString(),opened.getBoolean("ok"));val value=opened.getJSONObject("value");val handle=value.getString("handle")
        try{val read=rpc(access,"file.read",JSONObject().put("handle",handle).put("offset",0).put("length",4096));assertTrue(read.toString(),read.getBoolean("ok"));val page=read.getJSONObject("value");assertEquals(value.getString("epoch"),page.getString("epoch"));return String(Base64.decode(page.getString("data"),Base64.DEFAULT),Charsets.UTF_8)}
        finally{rpc(access,"file.close",JSONObject().put("handle",handle))}
    }
    @Test(timeout=300000) fun realFileResumesOriginalExecutionAfterOwnerDeathUsingItsPersistedCredential(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        val arguments=InstrumentationRegistry.getArguments();val unbound=arguments.getString("productUnbound")=="true"
        val diagnostic=arguments.getString("recoveryDiagnostic")=="true";val recoveryWait=arguments.getString("recoveryWaitMs")?.toLong()?.also{require(it in 30000..120000)}?:120000L
        val constrainedTimeout=arguments.getString("bashTimeoutSeconds")?.toInt()?.also{require(it==30)}
        val mode=if(unbound)"product" else "recovery-product";val run=id();val product="real-recovery-$run";val connection=if(unbound)arguments.getString("productConnection")?:error("Product connection precondition missing")else "recovery-live";val path="/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace/.durableagent-t12-$run.txt"
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));var wire=Wire(mode,run);var connected=true;var primary:Throwable?=null;var credentialGeneration=1L
        var observedSdkId=0L;var observedExecutionId="";var observedIntentKey=""
        fun observation(stage:String){if(diagnostic&&observedSdkId>0&&observedExecutionId.isNotEmpty())instrumentation.sendStatus(0,Bundle().apply{putString("recoveryDiagnostic",RecoveryFailureObservation.capture(context,mode,run,product,observedSdkId,observedExecutionId,observedIntentKey).put("stage",stage).put("beforeCleanup",true).put("servicePid",service()?.pid?:0).toString())})}
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->ExecutionAccess(context).use{observer->try{
            wire.ready()
            if(unbound){
                val existing=wire.call("list").getJSONArray("conversations");assertTrue("Product domain must have no other running/waiting work",(0 until existing.length()).none{existing.getJSONObject(it).optString("phase") in setOf("running","waiting")})
                val configuration=wire.call("models.get");assertFalse("Keep the existing configured product default",configuration.isNull("defaultModel"));val values=configuration.getJSONArray("connections");val selected=(0 until values.length()).map{values.getJSONObject(it)}.single{it.getString("id")==connection};assertTrue(selected.getBoolean("enabled"));assertEquals("mimo-cn",selected.getString("protocol"));assertTrue(selected.getJSONObject("credential").getBoolean("configured"));credentialGeneration=selected.getJSONObject("credential").getLong("generation")
            }else{
                wire.call("models.create",JSONObject().put("creationId",connection).put("expectedVersion",0).put("name","Recovery validation").put("protocol","mimo-cn").put("endpoint","https://token-plan-cn.xiaomimimo.com/v1"));wire.importKey(connection)
                wire.call("models.setDefault",JSONObject().put("expectedVersion",1).put("selection",JSONObject().put("provider",connection).put("modelId","mimo-v2.6-flash")))
            }
            wire.call("create",JSONObject().put("creationId",product))
            if(unbound)wire.call("models.select",JSONObject().put("id",product).put("selection",JSONObject().put("provider",connection).put("modelId","mimo-v2.6-flash")))
            val command="test ! -e '$path' || exit 71; printf 'part-one\\n' > '$path'; printf 'T12_PART_ONE\\n'; sleep 18; printf 'part-two\\n' >> '$path'; cat '$path'"
            val prompt="请实际执行文件操作，不要预测输出，也不要直接回复预期文本。这是已授权的恢复验证，新文件尚不存在。你必须首先调用已提供的 bash 工具执行下面完整命令一次，并等待实际工具结果；没有工具结果就不能声称完成。不要增添命令，不要调用 read、write 或其他工具，不要重复命令。\n<command>\n$command\n</command>\n工具真实完成后，依据实际输出原样报告文件最后两行。"+(if(constrainedTimeout!=null)"\n首次且唯一的 bash 工具调用必须明确设置 timeout 为数字 30（秒），不要省略，不要使用 60 或其他值。" else "")
            val saved=store.save(product,0,id(),prompt,emptyList());val frozen=store.freeze(product,saved.getLong("revision"),id());val expectation=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
            val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",frozen.getString("token")).put("expectedContext",expectation).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))
            var execution=JSONObject();var requestReported=false;until("Real MiMo starts the single managed execution"){
                val state=wire.state()?:error("Missing live product state");val metrics=state.getJSONObject("metrics")
                if(!requestReported&&metrics.optInt("modelRequests")>0){requestReported=true;val tools=metrics.getJSONObject("lastRequestTools");instrumentation.sendStatus(0,Bundle().apply{putString("realRequestStructure",JSONObject().put("run",run).put("product",product).put("tools",tools).put("credentialGeneration",metrics.getLong("lastCredentialGeneration")).toString())});val names=tools.getJSONArray("names");assertTrue("Actual product HTTP request must offer bash",(0 until names.length()).any{names.getString(it)=="bash"});assertEquals("default",tools.getString("choice"))}
                val rows=wire.call("execution.list",JSONObject().put("id",product)).getJSONArray("executions");assertTrue("The real model must use one requested execution",rows.length()<=1)
                if(rows.length()!=1){assertFalse("The model returned without performing the required real tool operation",wire.call("open",JSONObject().put("id",product)).optString("phase") in setOf("done","failed"));false}else{execution=rows.getJSONObject(0);execution.optString("state")=="running"&&execution.optInt("outputCursor")>0}
            }
            val partial=file(observer,path);assertEquals("part-one\n",partial)
            observedSdkId=expectation.getLong("sdkConversationId");observedExecutionId=execution.getString("executionId");val scope=execution.getJSONObject("context");observedIntentKey="${scope.getLong("taskId")}:${scope.getString("callId")}:1"
            if(constrainedTimeout!=null){
                val fixed=RecoveryFailureObservation.fixedRequest(context,mode,run,product,observedSdkId,observedExecutionId,observedIntentKey,execution.getString("requestDigest"),command)
                instrumentation.sendStatus(0,Bundle().apply{putString("fixedExecutionRequest",fixed.put("run",run).put("beforeOwnerDeath",true).toString())})
                assertTrue("Durable fixed request must match the actual receipt before owner death: $fixed",fixed.optBoolean("readOnly")&&fixed.optBoolean("verified"))
                assertEquals("Actual MiMo tool parameter must be the requested thirty seconds",30000L,fixed.getLong("timeoutMs"))
            }
            observation("before-owner-death")
            val before=wire.state()?:error("Missing pre-death state");val pid=before.getInt("pid");assertNotEquals(Process.myPid(),pid);assertTrue(before.getBoolean("domainOwned"));val beforeRequests=before.getJSONObject("metrics").getInt("modelRequests");assertTrue(beforeRequests>0)
            instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryCheckpoint",JSONObject().put("run",run).put("product",product).put("path",path).put("executionId",execution.getString("executionId")).put("beforePid",pid).put("beforeRequests",beforeRequests).put("partial",partial).toString())})
            // Only this app's reported :agent owner is killed. The executor/process scope remains untouched.
            var recoveredPid:Int?=null
            if(unbound){page.close();wire.close();connected=false;instrumentation.waitForIdleSync();assertTrue("Product service has a started foreground lifetime before UI removal",service()?.let{it.started&&it.foreground}==true)}
            Process.killProcess(pid)
            if(unbound){
                until("Android restarts the unbound sticky product owner"){service()?.let{if(it.pid>0&&it.pid!=pid){recoveredPid=it.pid;true}else false}==true}
                val recoveryStarted=SystemClock.elapsedRealtime();var nextObservation=10000L
                NativeRecoveryStore(context,NativeInputBridge.namespace(mode,run)).use{recovery->until("Unbound product owner durably finishes before any client reconnects",recoveryWait){
                    if(diagnostic&&SystemClock.elapsedRealtime()-recoveryStarted>=nextObservation){observation("unbound-${nextObservation}ms");nextObservation=if(nextObservation==10000L)30000L else Long.MAX_VALUE}
                    try{val values=recovery.readProjection().getJSONArray("completions");(0 until values.length()).any{values.getJSONObject(it).getString("conversationId")==product}}catch(error:IllegalStateException){if(error.message=="RECOVERY_STORAGE_BUSY")false else throw error}
                }}
                wire=Wire(mode,run);connected=true
            }
            val reopened=wire.ready(pid);assertNotEquals(pid,reopened.getInt("pid"))
            var settled=JSONObject();until("Existing real input settles after host recovery"){
                settled=wire.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId")))
                val snapshot=wire.call("open",JSONObject().put("id",product));if(snapshot.optString("phase")=="failed")error(snapshot.toString())
                settled.optJSONObject("submission")?.optString("status")=="done"
            }
            val completed=wire.call("execution.list",JSONObject().put("id",product)).getJSONArray("executions");assertEquals(1,completed.length());assertEquals(execution.getString("executionId"),completed.getJSONObject(0).getString("executionId"));assertEquals("completed",completed.getJSONObject(0).getString("state"));assertEquals(0,completed.getJSONObject(0).getInt("exitCode"));assertTrue(completed.getJSONObject(0).getBoolean("scopeConfirmed"))
            val content=file(observer,path);assertEquals("part-one\npart-two\n",content)
            val history=wire.call("history",JSONObject().put("id",product)).getJSONArray("items");assertEquals(1,(0 until history.length()).count{history.getJSONObject(it).optString("role")=="user"})
            val toolText=(0 until history.length()).map{history.getJSONObject(it)}.filter{it.optString("role")=="tool"}.joinToString("\n"){it.optString("text")};assertTrue(toolText.contains("part-one\npart-two"))
            val answer=(0 until history.length()).map{history.getJSONObject(it)}.filter{it.optString("role")=="assistant"}.last().optString("text");assertTrue(answer.contains("part-one"));assertTrue(answer.contains("part-two"))
            val after=wire.state()?:error("Missing post-recovery state");if(!unbound){assertEquals(credentialGeneration,after.getJSONObject("metrics").getLong("lastCredentialGeneration"));assertTrue(beforeRequests+after.getJSONObject("metrics").getInt("modelRequests")<=6)}
            instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryEvidence",JSONObject().put("run",run).put("product",product).put("path",path).put("originalExecution",execution.getString("executionId")).put("finalExecution",completed.getJSONObject(0)).put("admission",settled.getJSONObject("receipt")).put("beforePid",pid).put("afterPid",after.getInt("pid")).put("unboundProduct",unbound).put("recoveredPid",recoveredPid?:JSONObject.NULL).put("credentialGeneration",credentialGeneration).put("beforeRequests",beforeRequests).put("observedAfterRequests",after.getJSONObject("metrics").optInt("modelRequests")).put("completeRequestCountObserved",!unbound).put("partial",partial).put("final",content).toString())})
        }catch(error:Throwable){primary=error;observation("failure-before-stop")
            if(diagnostic)try{if(!connected){wire=Wire(mode,run);connected=true};val retained=wire.state(5);instrumentation.sendStatus(0,Bundle().apply{putString("recoveryOwnerAfterFailure",JSONObject().put("product",product).put("observedAfterFailureAndRebind",true).put("state",retained?:JSONObject.NULL).toString())})}catch(observationError:Exception){error.addSuppressed(observationError)}
            instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryFailure",JSONObject().put("run",run).put("product",product).put("path",path).put("error",error.javaClass.simpleName).toString())});throw error}
        finally{
            if(primary!=null)try{val control=store.readControl(product);NativeStopController.request(context,mode,run,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",control.getLong("version")));until("Failed fixture's own work stops",30000){!store.readControl(product).has("pendingAbort")}}catch(error:Throwable){primary!!.addSuppressed(error)}
            page.close();if(!connected){wire=Wire(mode,run);wire.ready()};try{wire.closeHost()}catch(error:Throwable){if(primary!=null)primary!!.addSuppressed(error)else throw error}finally{wire.close()}
        }}}
    }
}
