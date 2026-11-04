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
import java.util.concurrent.atomic.AtomicLong
import android.util.Base64

/** Root provisions the paired Termux endpoint and an actually metered Android network. */
@RunWith(AndroidJUnit4::class)
class DataSaverExecutionTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,read:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!read()){assertTrue(label,SystemClock.elapsedRealtime()<deadline);Thread.sleep(40)}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable{
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val statuses=LinkedBlockingQueue<JSONObject>();private val busy=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else if(what==12)statuses.offer(value)else if(what==35)busy.offer(value)}}.apply{connect()}
        fun envelope(method:String,payload:JSONObject=JSONObject()):JSONObject{val request=id();val pending=CompletableFuture<JSONObject>();replies[request]=pending;client.post(JSONObject().put("protocol",1).put("connectionId","data-saver-execution").put("requestId",request).put("method",method).put("payload",payload).toString());return pending.get(35,TimeUnit.SECONDS)}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject=envelope(method,payload).also{assertTrue(it.toString(),it.getBoolean("ok"))}.getJSONObject("value")
        fun phase(expected:String):JSONObject{var last=JSONObject();until("Host $expected: $last"){statuses.clear();client.control(12);val value=statuses.poll(1,TimeUnit.SECONDS)?:return@until false;last=value;check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")==expected};return last}
        fun policy()=call("dataSaver.operations",JSONObject().put("id","policy-chat")).getJSONArray("operations")
        fun execution(executionId:String):JSONObject?{val rows=call("execution.list",JSONObject().put("id","policy-chat")).getJSONArray("executions");return (0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.getString("executionId")==executionId}}
        fun busy():JSONObject{busy.clear();client.control(35);return busy.poll(2,TimeUnit.SECONDS)?:error("Native busy observation unavailable")}
        override fun close(){client.disconnect()}
    }
    private fun send(store:NativeInputStore,wire:Wire,text:String):JSONObject{
        val draft=store.inspect("policy-chat");val saved=store.save("policy-chat",draft.getLong("revision"),id(),text,emptyList());val fixed=store.freeze("policy-chat",saved.getLong("revision"),id())
        val location=wire.call("open",JSONObject().put("id","policy-chat")).getJSONObject("conversation").getJSONObject("submissionContext")
        val intent=store.createSend(JSONObject().put("id","policy-chat").put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",location).put("expectedControlVersion",store.readControl("policy-chat").getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
        wire.call("send",JSONObject().put("intentId",intent.getString("intentId")));return intent
    }
    @Test(timeout=240000) fun actualPreparedTermuxCommandNeedsExactGrantAndUserStopInvalidatesTheNextGrant(){flow(false)}
    @Test(timeout=240000) fun realMimoRemainsUsableWhileUnknownToolAwaitsSingleGrant(){assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true");flow(true)}
    @Test(timeout=180000) fun actualMeteredTransitionStopsTheDownloadingChildWhileJavascriptIsBusyWithoutReplay(){
        val run=id();val mode="execution";val namespace=NativeInputBridge.namespace(mode,run);val meteredAt=AtomicLong(0)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->ExecutionAccess(context).use{native->AndroidDataSaverNetwork(context){fact->if(fact.known&&fact.metered)meteredAt.compareAndSet(0,SystemClock.elapsedRealtime())}.use{network->try{
            wire.phase("ready");val current=wire.call("dataSaver.get");assertTrue("Start on actually known unmetered Android network",current.getJSONObject("network").getBoolean("known")&&!current.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",current.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"));val sent=send(store,wire,"EXEC_NETWORK_DOWNLOAD")
            var running=JSONObject();until("Actual HTTP-reading child starts"){
                val rows=wire.call("execution.list",JSONObject().put("id","policy-chat")).getJSONArray("executions");if(rows.length()!=1)return@until false;running=rows.getJSONObject(0);if(running.optString("state")!="running")return@until false
                val chunks=wire.call("execution.readOutput",JSONObject().put("id","policy-chat").put("executionId",running.getString("executionId")).put("cursor",0)).getJSONArray("chunks")
                (0 until chunks.length()).joinToString(""){String(Base64.decode(chunks.getJSONObject(it).getString("data"),Base64.DEFAULT),Charsets.UTF_8)}.contains("t13-download-open")
            }
            val executionId=running.getString("executionId");assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            wire.client.control(34,"15000");until("Real JS busy begins",3000){wire.busy().getLong("started")>0};val busy=wire.busy();assertEquals(0L,busy.getLong("ended"))
            val awaitingMetered=JSONObject().put("run",run).put("executionId",executionId).put("busyStartedElapsed",busy.getLong("started"))
            println("T13_EXECUTION_WAIT_METERED "+awaitingMetered)
            instrumentation.sendStatus(0,Bundle().apply{putString("T13_EXECUTION_WAIT_METERED",awaitingMetered.toString())})
            // Root's automated log watcher changes the actual platform setting. No supplied fact.
            until("Root supplies actual metered transition within the busy interval",8000){meteredAt.get()>0&&network.current().metered}
            fun query():JSONObject{
                val begun=JSONObject(native.beginJson("query",JSONObject().put("executionId",executionId).toString()));assertTrue(begun.toString(),begun.getBoolean("ok"));val operation=begun.getJSONObject("value").getString("operationId");var result=JSONObject()
                until("Read original native execution",5000){val envelope=JSONObject(native.pollJson(operation));assertTrue(envelope.toString(),envelope.getBoolean("ok"));val value=envelope.getJSONObject("value");if(value.getBoolean("pending"))false else{result=value.getJSONObject("result");true}}
                assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")
            }
            var stopped=JSONObject();until("Whole original download scope confirms stopped while JS is busy",8000){stopped=query();stopped.optString("state")=="stopped"&&stopped.optBoolean("scopeConfirmed")};val confirmedAt=SystemClock.elapsedRealtime()
            assertEquals("network_policy",stopped.getString("cancelReason"));assertEquals(0L,wire.busy().getLong("ended"));assertEquals(0L,store.readControl("policy-chat").getLong("stoppedThrough"))
            val awaitingRestoration=JSONObject().put("run",run).put("observedToConfirmedMs",confirmedAt-meteredAt.get()).put("stopped",stopped)
            println("T13_EXECUTION_WAIT_UNMETERED "+awaitingRestoration)
            instrumentation.sendStatus(0,Bundle().apply{putString("T13_EXECUTION_WAIT_UNMETERED",awaitingRestoration.toString())})
            until("Root restores actual unmetered network",60000){val fact=network.current();fact.known&&!fact.metered};until("Original JS busy finishes",20000){wire.busy().getLong("ended")>0}
            wire.phase("ready");val result=wire.execution(executionId)!!;assertEquals("stopped",result.getString("state"));assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"));assertEquals(1,wire.policy().length());assertEquals(0L,store.readControl("policy-chat").getLong("stoppedThrough"))
            val control=store.readControl("policy-chat");NativeStopController.request(context,mode,run,JSONObject().put("id","policy-chat").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            until("Explicit user stop settles the same policy-held invocation"){!store.readControl("policy-chat").has("pendingAbort")};assertEquals("unanswered",wire.call("sendStatus",JSONObject().put("intentId",sent.getString("intentId"))).getJSONObject("submission").getString("status"));assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case","actual-network-download-busy").put("run",run).put("initial",current).put("stopped",stopped).put("busy",busy).put("meteredObservedElapsed",meteredAt.get()).put("confirmedElapsed",confirmedAt).put("observedToConfirmedMs",confirmedAt-meteredAt.get()).put("modelRequests",1).put("executionCount",1).put("networkReturnDidNotReplay",true).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}}}
    }
    private fun flow(real:Boolean){
        val run=id();val mode=if(real)"execution-real" else "execution";val namespace=NativeInputBridge.namespace(mode,run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->try{
            wire.phase("ready");val current=wire.call("dataSaver.get");assertTrue("Root must provide an actually known metered network",current.getJSONObject("network").getBoolean("known")&&current.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",current.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"))
            val marker="T13-${run.take(8)}";val text=if(real)"Use bash exactly once with: printf '$marker\\n' . Then report its output." else "EXEC_SUCCESS"
            val first=send(store,wire,text);var waiting=JSONObject()
            until("Actual executor has prepared one fixed request awaiting policy"){val rows=wire.policy();if(rows.length()!=1)return@until false;waiting=rows.getJSONObject(0);waiting.optString("phase")=="waiting"&&!waiting.isNull("finalDigest")}
            val executionId=waiting.getString("executionId");assertEquals("unknown",waiting.getString("classification"));assertEquals("accepted_not_started",wire.execution(executionId)!!.getString("state"))
            val counter=if(real)"transportRequests" else "modelRequests";assertEquals("Model communication is exempt while the tool waits",1,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            fun grant(row:JSONObject)=JSONObject().put("id","policy-chat").put("executionId",row.getString("executionId")).put("requestDigest",row.getString("requestDigest")).put("finalDigest",row.getString("finalDigest")).put("period",row.getLong("period"))
            wire.call("dataSaver.grant",grant(waiting));until("Exactly granted command and model follow-up finish"){wire.call("sendStatus",JSONObject().put("intentId",first.getString("intentId"))).optJSONObject("submission")?.optString("status")=="done"}
            val completed=wire.execution(executionId)!!;assertEquals("completed",completed.getString("state"));assertEquals(0,completed.getInt("exitCode"));assertTrue(wire.call("dataSaver.get").getBoolean("enabled"));assertEquals(2,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            val second=send(store,wire,text);var next=JSONObject();until("New explicit execution does not inherit the prior grant"){val rows=wire.policy();next=(0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.getString("executionId")!=executionId}?:return@until false;next.optString("phase")=="waiting"&&!next.isNull("finalDigest")}
            assertEquals("accepted_not_started",wire.execution(next.getString("executionId"))!!.getString("state"))
            val control=store.readControl("policy-chat");NativeStopController.request(context,mode,run,JSONObject().put("id","policy-chat").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            until("Explicit user stop settles the waiting SDK invocation"){!store.readControl("policy-chat").has("pendingAbort")}
            val refused=wire.envelope("dataSaver.grant",grant(next));assertFalse(refused.toString(),refused.getBoolean("ok"));assertTrue(refused.getJSONObject("error").getString("code") in setOf("EXECUTION_STOPPED","SUBMISSION_STOPPED"))
            val stopped=wire.execution(next.getString("executionId"))!!;assertTrue(stopped.optBoolean("neverStarted")&&stopped.optBoolean("scopeConfirmed"));assertEquals(3,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            assertEquals("unanswered",wire.call("sendStatus",JSONObject().put("intentId",second.getString("intentId"))).getJSONObject("submission").getString("status"))
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case",if(real)"real-mimo-metered-grant" else "actual-termux-metered-grant").put("network",current.getJSONObject("network")).put("waiting",waiting).put("completed",completed).put("stoppedNext",stopped).put("requestsBeforeGrant",1).put("totalRequests",3).put("globalEnabled",true).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}
    }
}
