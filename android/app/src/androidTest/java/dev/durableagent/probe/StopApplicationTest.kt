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
class StopApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(25)}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable{
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val request=id();val pending=CompletableFuture<JSONObject>();replies[request]=pending;client.post(JSONObject().put("protocol",1).put("connectionId","stop-test").put("requestId",request).put("method",method).put("payload",payload).toString());val result=pending.get(30,TimeUnit.SECONDS);assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")}
        fun control(what:Int,timeout:Long=5):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what);return queue.poll(timeout,TimeUnit.SECONDS)?:error("Native control $what timed out")}
        var reconnectReadMisses=0
        fun hostIdentity():JSONObject?{val queue=controls.computeIfAbsent(35){LinkedBlockingQueue()};queue.clear();client.control(35);return queue.poll(250,TimeUnit.MILLISECONDS).also{if(it==null)reconnectReadMisses++}}
        fun ready():JSONObject{var state=JSONObject();until("Host ready"){state=control(12,90);if(state.optString("phase")=="failed")error(state.toString());state.optString("phase")=="ready"};return state}
        override fun close(){client.disconnect()}
    }
    private fun observe(action:()->JSONObject):JSONObject{val end=SystemClock.elapsedRealtime()+2000;while(true){try{return action()}catch(error:NativeInputException){if(error.code!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()>=end)throw error;Thread.sleep(20)}}}
    private fun create(store:NativeInputStore,product:String,text:String,submission:JSONObject):JSONObject{
        val draft=observe{store.inspect(product)};val saved=store.save(product,draft.getLong("revision"),id(),text,emptyList());val fixed=store.freeze(product,saved.getLong("revision"),id())
        return store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",submission).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
    }
    @Test(timeout=180000) fun actualSdkAbortScopesWaitForOwnedAndInheritedBackgroundWork(){
        val run=id();val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run));val wire=Wire("fixture",run)
        var primary:Throwable?=null
        try{wire.ready();wire.client.control(56);var state=JSONObject();until("Shared SDK stop scopes"){state=wire.control(12);val metrics=state.getJSONObject("metrics");if(metrics.optString("stopPolicyState")=="failed")error(metrics.toString());metrics.optString("stopPolicyState")=="passed"};assertEquals(2,state.getJSONObject("metrics").getJSONArray("stopPolicyCases").length());instrumentation.sendStatus(0,Bundle().apply{putString("stopEvidence",state.toString())})}
        catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");until("Cleanup shared stop scopes",20000){wire.control(12).optString("phase")=="closed"}}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}
    }
    @Test(timeout=180000) fun nativeStopSurvivesUiDetachAndRebuildsBusyOwnerBeforeNewAdmission(){busyOwner(false)}
    @Test(timeout=180000) fun pendingStopSurvivesTemporaryNativeWriterOccupancy(){busyOwner(true)}
    private fun busyOwner(heldWriter:Boolean){
        val run=id();val mode="hang";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);val store=NativeInputStore(context,NativeInputBridge.namespace(mode,run))
        var primary:Throwable?=null;val writer=java.util.concurrent.Executors.newSingleThreadExecutor();val releaseWriter=java.util.concurrent.CountDownLatch(1)
        try{
            val before=wire.ready();val product="stop-chat";wire.call("create",JSONObject().put("creationId",product));val submission=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
            val original=create(store,product,"old hanging request",submission);wire.call("send",JSONObject().put("intentId",original.getString("intentId")))
            until("Old model started"){wire.control(12).getJSONObject("metrics").optInt("modelRequests")==1}
            wire.client.control(34,"15000");until("Real JS busy loop entered",3000){wire.control(35).getLong("started")>0}
            val started=SystemClock.elapsedRealtime();val request=JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",store.readControl(product).getLong("version"))
            val control=if(heldWriter)store.requestStop(request)else NativeStopController.request(context,mode,run,request)
            val fresh=create(store,product,"new explicit generation",submission);assertTrue(control.has("pendingAbort"));assertTrue(fresh.getLong("controlGeneration")>control.getLong("stoppedThrough"));assertTrue("Native acknowledgement must precede old JS loop ending",SystemClock.elapsedRealtime()-started<3000)
            val nativeAckMs=SystemClock.elapsedRealtime()-started
            if(heldWriter){
                val entered=java.util.concurrent.CountDownLatch(1);val current=observe{store.inspect(product)}
                val saving=writer.submit{NativeInputStore(context,NativeInputBridge.namespace(mode,run),boundary={stage->if(stage=="transaction.beforeCommit"){entered.countDown();check(releaseWriter.await(5,TimeUnit.SECONDS))}}).use{it.save(product,current.getLong("revision"),id(),"later unsent draft",emptyList())}}
                assertTrue("Actual native write transaction entered",entered.await(2,TimeUnit.SECONDS));NativeStopController.resume(context,mode,run)
                Thread.sleep(1600);releaseWriter.countDown();saving.get(2,TimeUnit.SECONDS)
            }
            page.close()
            until("Busy owner was not rebuilt by native stop",9000){wire.hostIdentity()?.getInt("pid")?.let{it!=before.getInt("pid")}==true}
            val reopened=wire.ready();assertNotEquals(before.getInt("pid"),reopened.getInt("pid"));assertFalse(observe{store.readControl(product)}.has("pendingAbort"))
            val oldStatus=wire.call("sendStatus",JSONObject().put("intentId",original.getString("intentId")))
            var freshStatus=wire.call("sendStatus",JSONObject().put("intentId",fresh.getString("intentId")))
            instrumentation.sendStatus(0,Bundle().apply{putString("stopObservation",JSONObject().put("old",oldStatus).put("fresh",freshStatus).put("host",reopened).put("history",wire.call("history",JSONObject().put("id",product))).toString())})
            assertEquals("unanswered",oldStatus.getJSONObject("submission").getString("status"))
            // This is an explicitly saved send intent, not draft text: T07 startup may admit it once old abort has completed.
            until("Saved new explicit generation accepted"){freshStatus=wire.call("sendStatus",JSONObject().put("intentId",fresh.getString("intentId")));freshStatus.optBoolean("accepted")}
            assertEquals(fresh.getString("intentId"),freshStatus.getJSONObject("receipt").getString("intentId"));assertEquals(fresh.getLong("controlGeneration"),freshStatus.getJSONObject("receipt").getLong("controlGeneration"))
            assertNotEquals(oldStatus.getJSONObject("receipt").getLong("submissionId"),freshStatus.getJSONObject("receipt").getLong("submissionId"))
            until("New explicit request started"){wire.control(12).getJSONObject("metrics").optInt("modelRequests")==1}
            val history=wire.call("history",JSONObject().put("id",product)).getJSONArray("items");assertEquals(2,history.length());assertEquals("old hanging request",history.getJSONObject(0).getString("text"));assertEquals("new explicit generation",history.getJSONObject(1).getString("text"));assertEquals(freshStatus.getJSONObject("submission").getString("entryId"),history.getJSONObject(1).getString("id"))
            val replay=wire.call("send",JSONObject().put("intentId",fresh.getString("intentId")));assertEquals(freshStatus.getJSONObject("receipt").toString(),replay.getJSONObject("receipt").toString());assertEquals(1,wire.control(12).getJSONObject("metrics").optInt("modelRequests"))
            if(heldWriter)assertEquals("later unsent draft",observe{store.inspect(product)}.getString("text"))
            instrumentation.sendStatus(0,Bundle().apply{putString("stopEvidence",JSONObject().put("case","busy-owner-new-generation").put("oldPid",before.getInt("pid")).put("newPid",reopened.getInt("pid")).put("reconnectReadMisses",wire.reconnectReadMisses).put("nativeAckMs",nativeAckMs).put("rebuildAndNewRequestMs",SystemClock.elapsedRealtime()-started).put("reopenNewGenerationRequests",1).put("oldGenerationResubmitted",false).put("newExplicitRequests",1).put("oldStatus",oldStatus.getJSONObject("submission").getString("status")).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{releaseWriter.countDown();writer.shutdownNow();runCatching{page.close()};try{wire.client.control(20,"close");until("Cleanup close",20000){wire.control(12).optString("phase")=="closed"}}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close();store.close()}}
    }
}
