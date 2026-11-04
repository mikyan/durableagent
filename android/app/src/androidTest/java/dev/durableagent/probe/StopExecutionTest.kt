package dev.durableagent.probe

import android.app.NotificationManager
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

/** Actual SDK + authenticated Termux effects. Root provisions the existing paired executor. */
@RunWith(AndroidJUnit4::class)
class StopExecutionTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private var phase="opening"
    private fun phase(value:String){phase=value}
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    private fun observe(action:()->JSONObject):JSONObject{val end=SystemClock.elapsedRealtime()+2000;while(true){try{return action()}catch(error:NativeInputException){if(error.code!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()>=end)throw error;Thread.sleep(20)}}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable{
        val connection=id();val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val request=id();val future=CompletableFuture<JSONObject>();replies[request]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",request).put("method",method).put("payload",payload).toString());val result=future.get(35,TimeUnit.SECONDS);assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")}
        fun state(what:Int=12,seconds:Long=90):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what);return queue.poll(seconds,TimeUnit.SECONDS)?:error("Native observation $what timeout")}
        fun ready():JSONObject{var value=JSONObject();val queue=controls.computeIfAbsent(12){LinkedBlockingQueue()};until("Host readiness"){
            // A read sent across the owner's death can lose its Binder response. Retry only
            // this read within the existing total readiness deadline, never a stop or input.
            queue.clear();client.control(12);val observed=queue.poll(2,TimeUnit.SECONDS)
            if(observed==null)false else{value=observed;check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}
        };return value}
        fun execution(product:String,index:Int=0):JSONObject?{val rows=call("execution.list",JSONObject().put("id",product)).getJSONArray("executions");return if(rows.length()>index)rows.getJSONObject(index)else null}
        override fun close(){client.disconnect()}
    }
    private fun send(store:NativeInputStore,wire:Wire,product:String,text:String,dispatch:Boolean=true):JSONObject{
        phase("$product.inspect");val current=observe{store.inspect(product)};phase("$product.save");val saved=store.save(product,current.getLong("revision"),id(),text,emptyList());phase("$product.freeze");val fixed=store.freeze(product,saved.getLong("revision"),id())
        val location=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
        phase("$product.create-send")
        val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",location).put("expectedControlVersion",observe{store.readControl(product)}.getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
        if(dispatch){phase("$product.dispatch");wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))};return intent
    }
    private fun nativeQuery(access:ExecutionAccess,executionId:String):JSONObject{
        val begun=JSONObject(access.beginJson("query",JSONObject().put("executionId",executionId).toString()));assertTrue(begun.toString(),begun.getBoolean("ok"));val operation=begun.getJSONObject("value").getString("operationId");var result=JSONObject()
        until("Native execution observation",10000){val envelope=JSONObject(access.pollJson(operation));assertTrue(envelope.toString(),envelope.getBoolean("ok"));val value=envelope.getJSONObject("value");if(value.getBoolean("pending"))false else{result=value.getJSONObject("result");true}}
        assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")
    }
    private fun finish(page:ActivityScenario<AgentActivity>,wire:Wire,primary:Throwable?){runCatching{page.close()};try{wire.client.control(20,"close");until("Host closes",20000){wire.state().optString("phase")=="closed"}}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}

    /** Deliberately external test actor: no application intent, SDK tool or writer-queue bypass in production. */
    private inner class IndependentSleepScope(run:String):AutoCloseable {
        val executionId="stop-isolation-$run"
        private val identity=ExecutionIdentity(context,"production-v1",allowCreate=false)
        private val peer=ExecutionPairingStore(context).use{it.requireClient(identity.certificateSha256())}
        private val client=ExecutionTlsClient(identity,peer)
        private val info=client.request("ping",JSONObject())
        private val request=JSONObject().put("executionId",executionId).put("context",JSONObject()
            .put("productId",executionId).put("sdkConversationId",1).put("taskId",1).put("callId",executionId).put("bindingId",executionId)
            .put("locationVersion",1).put("controlGeneration",1).put("namespace",info.getString("namespace")))
            .put("command",JSONObject().put("kind","argv").put("argv",org.json.JSONArray().put("/data/data/com.termux/files/usr/bin/sleep").put("120")))
            .put("cwd",info.getString("defaultWorkspace")).put("env",JSONObject()).put("inheritEnv",false).put("timeoutMs",150000)
        private val requestDigest=NativeInputStore.sha256(NativeExecutionFence.canonical(request).toByteArray(Charsets.UTF_8))
        private var attempted=false
        private fun verified(value:JSONObject):JSONObject{
            assertEquals(executionId,value.getString("executionId"));assertEquals(info.getString("namespace"),value.getString("namespace"))
            assertEquals(peer.executorId,value.getString("executorId"));assertEquals(peer.ledgerEpoch,value.getString("ledgerEpoch"))
            if(value.optString("reason")!="NO_RECEIPT"&&value.optString("reason")!="CANCELLED_BEFORE_ACCEPTANCE"){
                assertEquals(requestDigest,value.getString("requestDigest"));assertEquals(NativeExecutionFence.canonical(request.getJSONObject("context")),NativeExecutionFence.canonical(value.getJSONObject("context")))
            };return value
        }
        fun start(){attempted=true;val accepted=verified(client.request("prepare",request));verified(client.request("start",JSONObject().put("executionId",executionId).put("finalDigest",accepted.getString("finalDigest"))))}
        fun query()=verified(client.request("query",JSONObject().put("executionId",executionId)))
        override fun close(){if(!attempted)return;verified(client.request("cancel",JSONObject().put("executionId",executionId).put("reason","user")));until("Independent fixture scope cleanup",15000){query().let{it.optBoolean("scopeConfirmed")&&it.optString("state") in setOf("stopped","not_started","completed")}};attempted=false}
    }

    @Test(timeout=30000) fun inspectExistingIndependentFixtureScopes(){
        val identity=ExecutionIdentity(context,"production-v1",allowCreate=false);val peer=ExecutionPairingStore(context).use{it.requireClient(identity.certificateSha256())};val client=ExecutionTlsClient(identity,peer)
        val page=client.request("list",JSONObject().put("cursor","stop-isolation-").put("limit",10));val rows=page.getJSONArray("executions");val scopes=org.json.JSONArray()
        for(index in 0 until rows.length()){val receipt=rows.getJSONObject(index);val executionId=receipt.getString("executionId");if(!executionId.startsWith("stop-isolation-"))continue;assertEquals(executionId,receipt.getJSONObject("context").getString("productId"));assertEquals(peer.executorId,receipt.getString("executorId"));assertEquals(peer.ledgerEpoch,receipt.getString("ledgerEpoch"));scopes.put(receipt)}
        instrumentation.sendStatus(0,Bundle().apply{putString("independentStopFixtureObservation",JSONObject().put("scopes",scopes).put("nextCursor",page.opt("nextCursor")).put("noHarness",true).put("noDispatchOrCancellation",true).toString())})
    }

    @Test(timeout=240000) fun notificationStopsOnlyOwnedTermuxScopeDuringBusyJsAndNewGenerationIsIndependent(){
        val run=id();val mode="execution";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);val namespace=NativeInputBridge.namespace(mode,run)
        var primary:Throwable?=null;var unrelated:IndependentSleepScope?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->ExecutionAccess(context).use{native->try{
            phase("host.ready");val before=wire.ready();phase("target.create");wire.call("create",JSONObject().put("creationId","target").put("title","target"))
            // T10 serializes application shell writers. The unrelated witness is an explicit
            // external fixture with only a fixed sleep, not a second application shell tool.
            phase("independent.start");val independent=IndependentSleepScope(run);unrelated=independent;independent.start()
            val old=send(store,wire,"target","EXEC_CANCEL")
            phase("scopes.running");var target=JSONObject();var other=JSONObject();until("Target and independent external fixture run"){target=wire.execution("target")?:return@until false;other=independent.query();target.optString("state")=="running"&&other.optString("state")=="running"}
            val targetId=target.getString("executionId")
            phase("notification.publish");val control=observe{store.readControl("target")};NativeStopController.publish(context,mode,run,control)
            val manager=context.getSystemService(NotificationManager::class.java);assertTrue("Enable the app notification permission for this actual notification test",manager.areNotificationsEnabled())
            val notification=manager.activeNotifications.single{it.tag=="$namespace:target"};assertEquals("target",notification.notification.extras.getString(android.app.Notification.EXTRA_TITLE))
            val stopAction=notification.notification.actions.single().actionIntent
            phase("node.busy");wire.client.control(34,"15000");until("Actual JS busy",3000){wire.state(35,3).getLong("started")>0}
            page.close();val at=SystemClock.elapsedRealtime();stopAction.send();until("Notification durably commits without JS",3000){observe{store.readControl("target")}.getLong("stoppedThrough")==1L}
            stopAction.send();assertEquals(1L,observe{store.readControl("target")}.getLong("version"))
            // Do not call JS while busy: use the original immutable location from the accepted intent.
            phase("new-generation.inspect");val draft=observe{store.inspect("target")};phase("new-generation.save");val saved=store.save("target",draft.getLong("revision"),id(),"EXEC_VERIFY_CANCEL",emptyList());phase("new-generation.freeze");val fixed=store.freeze("target",saved.getLong("revision"),id())
            phase("new-generation.create-send")
            val fresh=store.createSend(JSONObject().put("id","target").put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",old.getJSONObject("context")).put("expectedControlVersion",observe{store.readControl("target")}.getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            phase("later-draft.save");val later=observe{store.inspect("target")};store.save("target",later.getLong("revision"),id(),"new unsent draft 世界",emptyList())
            phase("target.confirm-stop");var stopped=JSONObject();until("Actual original process scope stops",9000){stopped=nativeQuery(native,targetId);stopped.optString("state")=="stopped"&&stopped.optBoolean("scopeConfirmed")}
            val untouched=independent.query();assertEquals("running",untouched.getString("state"));assertFalse(untouched.optBoolean("cancelRequested"))
            phase("owner.reopen");val reopened=wire.ready();assertNotEquals(before.getInt("pid"),reopened.getInt("pid"));var freshStatus=JSONObject()
            phase("new-generation.settle")
            until("Fresh generation accepted and verifier finished"){freshStatus=wire.call("sendStatus",JSONObject().put("intentId",fresh.getString("intentId")));freshStatus.optBoolean("accepted")&&freshStatus.optJSONObject("submission")?.optString("status")=="done"}
            val oldStatus=wire.call("sendStatus",JSONObject().put("intentId",old.getString("intentId")));assertEquals("unanswered",oldStatus.getJSONObject("submission").getString("status"));assertFalse(observe{store.readControl("target")}.has("pendingAbort"))
            assertEquals("new unsent draft 世界",observe{store.inspect("target")}.getString("text"));assertEquals("stopped",observe{store.stopStatus("target")}.getString("phase"))
            val verifier=wire.execution("target",1)!!;assertEquals("completed",verifier.getString("state"));assertEquals(0,verifier.getInt("exitCode"));assertTrue(wire.call("history",JSONObject().put("id","target")).toString().contains("cancel-effect-absent"))
            // Re-deliver the old PendingIntent after a newer explicit input: it cannot stop generation 2.
            stopAction.send();Thread.sleep(150);assertEquals(1L,observe{store.readControl("target")}.getLong("stoppedThrough"))
            independent.close()
            instrumentation.sendStatus(0,Bundle().apply{putString("stopExecutionEvidence",JSONObject().put("case","notification-busy-termux").put("target",stopped).put("unrelatedAtTargetStop",untouched).put("unrelatedSource","independent-fixed-sleep-fixture").put("unrelatedCleanup",independent.query()).put("oldPid",before.getInt("pid")).put("newPid",reopened.getInt("pid")).put("elapsedMs",SystemClock.elapsedRealtime()-at).put("freshReceipt",freshStatus.getJSONObject("receipt")).put("verifier",verifier).put("laterDraftPreserved",true).put("oldNotificationCannotStopNewGeneration",true).toString())})
        }catch(error:Throwable){primary=error;instrumentation.sendStatus(0,Bundle().apply{putString("stopIsolationFailure",JSONObject().put("run",run).put("phase",phase).put("code",(error as? NativeInputException)?.code?:error.javaClass.simpleName).put("independentExecutionId",unrelated?.executionId).toString())});throw error}finally{try{unrelated?.let{it.close();instrumentation.sendStatus(0,Bundle().apply{putString("stopIsolationCleanup",JSONObject().put("run",run).put("receipt",it.query()).toString())})}}catch(error:Throwable){if(primary!=null)primary!!.addSuppressed(error)else throw error}finally{finish(page,wire,primary)}}}}
    }

    @Test(timeout=240000) fun realMimoToolStopHasNoOldFollowupAndExplicitNewInputUsesNewGeneration(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        val run=id();val mode="execution-real";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).use{store->ExecutionAccess(context).use{native->try{
            wire.ready();wire.call("create",JSONObject().put("creationId","real-stop"));val path=".durableagent-t11-$run-late"
            val old=send(store,wire,"real-stop","Use bash exactly once with this command, then report its result: printf 't11-running\\n'; sleep 30; printf 'forbidden\\n' >> '$path'")
            var running=JSONObject();until("Real MiMo starts actual managed tool"){running=wire.execution("real-stop")?:return@until false;running.optString("state")=="running"}
            val requests=wire.state().getJSONObject("metrics").getInt("transportRequests");assertTrue(requests>0);val control=observe{store.readControl("real-stop")}
            NativeStopController.request(context,mode,run,JSONObject().put("id","real-stop").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            var stopped=JSONObject();until("Real tool and SDK abort confirm"){stopped=nativeQuery(native,running.getString("executionId"));stopped.optString("state")=="stopped"&&stopped.optBoolean("scopeConfirmed")&&!observe{store.readControl("real-stop")}.has("pendingAbort")}
            assertEquals("unanswered",wire.call("sendStatus",JSONObject().put("intentId",old.getString("intentId"))).getJSONObject("submission").getString("status"));Thread.sleep(300);assertEquals(requests,wire.state().getJSONObject("metrics").getInt("transportRequests"))
            val marker="T11-NEXT-${run.take(8)}";val fresh=send(store,wire,"real-stop","Use bash exactly once to verify the stopped command left no file. Run: if test ! -e '$path'; then printf '$marker\\n'; else exit 99; fi . Report the command output.")
            var status=JSONObject();until("Explicit new real request completes"){status=wire.call("sendStatus",JSONObject().put("intentId",fresh.getString("intentId")));status.optJSONObject("submission")?.optString("status")=="done"}
            val verifier=wire.execution("real-stop",1)!!;assertEquals("completed",verifier.getString("state"));assertEquals(0,verifier.getInt("exitCode"));assertTrue(fresh.getLong("controlGeneration")>old.getLong("controlGeneration"));assertTrue(wire.call("history",JSONObject().put("id","real-stop")).toString().contains(marker))
            instrumentation.sendStatus(0,Bundle().apply{putString("stopExecutionEvidence",JSONObject().put("case","real-mimo-stop-new-generation").put("oldRequests",requests).put("totalRequests",wire.state().getJSONObject("metrics").getInt("transportRequests")).put("stopped",stopped).put("newReceipt",status.getJSONObject("receipt")).put("verifier",verifier).put("oldFollowupRequests",0).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{finish(page,wire,primary)}}}
    }
}
