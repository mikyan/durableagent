package dev.durableagent.probe

import android.content.Intent
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
        val mode="recovery-product";val run=id();val product="real-recovery-$run";val connection="recovery-live";val path="/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace/.durableagent-t12-$run.txt"
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->ExecutionAccess(context).use{observer->try{
            wire.ready();wire.call("models.create",JSONObject().put("creationId",connection).put("expectedVersion",0).put("name","Recovery validation").put("protocol","mimo-cn").put("endpoint","https://token-plan-cn.xiaomimimo.com/v1"));wire.importKey(connection)
            wire.call("models.setDefault",JSONObject().put("expectedVersion",1).put("selection",JSONObject().put("provider",connection).put("modelId","mimo-v2.6-flash")))
            wire.call("create",JSONObject().put("creationId",product))
            val command="test ! -e '$path' || exit 71; printf 'part-one\\n' > '$path'; printf 'T12_PART_ONE\\n'; sleep 18; printf 'part-two\\n' >> '$path'; cat '$path'"
            val prompt="This is an authorized recovery test on one new test file. Use bash exactly once. The complete command is between the command tags; do not add other commands.\n<command>\n$command\n</command>\nAfter the tool completes, report the two resulting lines verbatim. Do not call read, write, any other tool, or repeat the command."
            val saved=store.save(product,0,id(),prompt,emptyList());val frozen=store.freeze(product,saved.getLong("revision"),id());val expectation=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
            val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",frozen.getString("token")).put("expectedContext",expectation).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))
            var execution=JSONObject();until("Real MiMo starts the single managed execution"){
                val rows=wire.call("execution.list",JSONObject().put("id",product)).getJSONArray("executions");assertTrue("The real model must use one requested execution",rows.length()<=1)
                if(rows.length()!=1)false else{execution=rows.getJSONObject(0);execution.optString("state")=="running"&&execution.optInt("outputCursor")>0}
            }
            val partial=file(observer,path);assertEquals("part-one\n",partial)
            val before=wire.state()?:error("Missing pre-death state");val pid=before.getInt("pid");assertNotEquals(Process.myPid(),pid);assertTrue(before.getBoolean("domainOwned"));val beforeRequests=before.getJSONObject("metrics").getInt("modelRequests");assertTrue(beforeRequests>0)
            instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryCheckpoint",JSONObject().put("run",run).put("product",product).put("path",path).put("executionId",execution.getString("executionId")).put("beforePid",pid).put("beforeRequests",beforeRequests).put("partial",partial).toString())})
            // Only this app's reported :agent owner is killed. The executor/process scope remains untouched.
            Process.killProcess(pid)
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
            val after=wire.state()?:error("Missing post-recovery state");assertEquals(1L,after.getJSONObject("metrics").getLong("lastCredentialGeneration"));assertTrue(beforeRequests+after.getJSONObject("metrics").getInt("modelRequests")<=6)
            instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryEvidence",JSONObject().put("run",run).put("product",product).put("path",path).put("originalExecution",execution.getString("executionId")).put("finalExecution",completed.getJSONObject(0)).put("admission",settled.getJSONObject("receipt")).put("beforePid",pid).put("afterPid",after.getInt("pid")).put("credentialGeneration",1).put("beforeRequests",beforeRequests).put("afterRequests",after.getJSONObject("metrics").getInt("modelRequests")).put("partial",partial).put("final",content).toString())})
        }catch(error:Throwable){primary=error;instrumentation.sendStatus(0,Bundle().apply{putString("realRecoveryFailure",JSONObject().put("run",run).put("product",product).put("path",path).put("error",error.javaClass.simpleName).toString())});throw error}
        finally{
            if(primary!=null)try{val control=store.readControl(product);NativeStopController.request(context,mode,run,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",control.getLong("version")));until("Failed fixture's own work stops",30000){!store.readControl(product).has("pendingAbort")}}catch(error:Throwable){primary!!.addSuppressed(error)}
            page.close();try{wire.closeHost()}catch(error:Throwable){if(primary!=null)primary!!.addSuppressed(error)else throw error}finally{wire.close()}
        }}}
    }
}
