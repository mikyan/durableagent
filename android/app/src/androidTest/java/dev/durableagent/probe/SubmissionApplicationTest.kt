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
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real WebView, native intent transactions, SDK and SQLite. Debug faults never enter the UI protocol. */
@RunWith(AndroidJUnit4::class)
class SubmissionApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun payload(id:String)=JSONObject().put("id",id)
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("submissionEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private fun until(timeout:Long=90000,condition:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Submission state timeout",SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)}}
    private fun scenario(mode:String,run:String)=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        private val connection=id()
        private val responses=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->
            if(what!=0){val value=JSONObject(text);if(what==10)responses.remove(value.optString("requestId"))?.complete(value) else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}
        }.apply{connect()}
        fun async(method:String,value:JSONObject=JSONObject()):CompletableFuture<JSONObject>{
            val requestId=id();val response=CompletableFuture<JSONObject>();responses[requestId]=response
            client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",requestId).put("method",method).put("payload",value).toString())
            return response
        }
        fun call(method:String,value:JSONObject=JSONObject()):JSONObject{val response=async(method,value).get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun control(what:Int,value:String="",timeout:Long=10):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,value);return queue.poll(timeout,TimeUnit.SECONDS)?:error("Control $what timeout")}
        fun state()=control(12)
        fun ready():JSONObject{var last=JSONObject();until{last=state();if(last.optString("phase")=="failed")error(last.toString());last.optString("phase")=="ready"};return last}
        fun fault(value:String)=control(36,value)
        fun boundary()=control(37,timeout=3)
        fun closeHost(){client.control(20,"close");until(15000){val state=state();state.optString("phase")=="closed"&&!state.optBoolean("domainOwned")&&state.optInt("nativeOwners")==0}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,source:String):String{val response=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(source){result->response.complete(result)}?:response.complete("null")};return response.get(10,TimeUnit.SECONDS)}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until{js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun edit(page:ActivityScenario<AgentActivity>,text:String){until{js(page,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"};js(page,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")}
    private fun ready(page:ActivityScenario<AgentActivity>){until{js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun requestCount(state:JSONObject,real:Boolean)=state.getJSONObject("metrics").optInt(if(real)"transportRequests" else "modelRequests")
    private fun history(wire:Wire,id:String)=wire.call("history",payload(id)).getJSONArray("items")
    private fun settle(wire:Wire,id:String){until{val state=wire.call("open",payload(id));if(state.optString("phase")=="failed")error(state.toString());state.optString("phase")=="done"}}
    private fun cleanup(wire:Wire){try{val boundary=wire.boundary();if(boundary.optString("stage").isNotEmpty())wire.client.control(38) else wire.closeHost()}finally{wire.close()}}

    @Test(timeout=180000) fun actualAndroidSdkSubmissionPolicies(){
        val run=id();val page=scenario("fixture",run);val wire=Wire("fixture",run)
        try{
            wire.ready();wire.client.control(40)
            var state=JSONObject();until{state=wire.state();val phase=state.getJSONObject("metrics").optString("submissionPolicyState");if(phase=="failed")error(state.toString());phase=="passed"}
            assertEquals(13,state.getJSONObject("metrics").getJSONArray("submissionPolicyCases").length())
            evidence("shared-sdk-policy",state)
        }finally{page.close();cleanup(wire)}
    }

    @Test(timeout=180000) fun reactDoubleClickLostAckNewDraftAndExplicitSameText(){reactAdmission(false)}

    @Test(timeout=240000) fun realMimoLostAckReconcilesWithoutAnotherCloudRequest(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        reactAdmission(true)
    }

    /** Only public native observer reads retry a rejected lease acquisition. Never replay a write. */
    private inner class NativeObserver(private val store:NativeInputStore) {
        val busyReads=JSONObject()
        private fun read(operation:String,action:()->JSONObject):JSONObject {
            val started=SystemClock.elapsedRealtime()
            while(true) {
                try{return action()}
                catch(error:NativeInputException) {
                    if(error.code!="INPUT_STORAGE_BUSY")throw AssertionError("Native observer $operation failed: ${error.code}",error)
                    busyReads.put(operation,busyReads.optInt(operation)+1)
                    if(SystemClock.elapsedRealtime()-started>=2000)throw AssertionError("Native observer $operation remained busy for 2 seconds; retries=$busyReads",error)
                    Thread.sleep(25)
                }
            }
        }
        fun list(id:String)=read("listSends"){store.listSends(payload(id))}
        fun draft(id:String)=read("inspect"){store.inspect(id)}
        fun intent(id:String)=read("readSend"){store.readSend(id)}
    }

    private fun reactAdmission(real:Boolean){
        val mode=if(real)"real" else "fixture";val run=id();val page=scenario(mode,run);val wire=Wire(mode,run);val store=NativeInputStore(context,NativeInputBridge.namespace(mode,run))
        val observer=NativeObserver(store)
        val marker="T07-"+id().take(8)
        val text=if(real)"请仅回复一句简短中文问候，原样包含验证标记 $marker。" else "可靠发送原输入🌍"
        val newer="原生确认晚到之前的新草稿🌍"
        try{
            val host=wire.ready();ready(page);click(page,"[data-testid=create-conversation]")
            until{wire.call("list").getJSONArray("conversations").length()==1}
            val productId=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            wire.fault("ack-drop");edit(page,text)
            until{js(page,"document.querySelector('[data-testid=send-message]')?.disabled===false")=="true"}
            // Two real DOM clicks in one turn exercise the controller's synchronous action gate.
            js(page,"(()=>{const e=document.querySelector('[data-testid=send-message]');e.click();e.click();})()")
            until{observer.list(productId).getJSONArray("intents").length()==1};settle(wire,productId)
            val onlyIntents=observer.list(productId).getJSONArray("intents");assertEquals(1,onlyIntents.length());val intent=onlyIntents.getJSONObject(0);val intentId=intent.getString("intentId")
            assertEquals("uncertain",intent.getString("delivery"));assertFalse(intent.has("receipt"));assertEquals(text,observer.draft(productId).getString("text"))
            val status=wire.call("sendStatus",JSONObject().put("intentId",intentId));assertTrue(status.getBoolean("accepted"));val receipt=status.getJSONObject("receipt")
            // A status query must neither create ACK nor mutate the author's draft.
            val version=intent.getLong("stateVersion");wire.call("sendStatus",JSONObject().put("intentId",intentId));assertEquals(version,observer.intent(intentId).getLong("stateVersion"))
            assertEquals(1,requestCount(wire.state(),real));assertEquals(2,history(wire,productId).length())
            if(real)assertTrue(history(wire,productId).getJSONObject(1).getString("text").contains(marker))
            edit(page,newer);until{observer.draft(productId).getString("text")==newer};val newRevision=observer.draft(productId).getLong("revision")
            wire.fault("off");click(page,"[data-intent-id='$intentId'] [data-testid=retry-submission]")
            until{observer.intent(intentId).getString("delivery")=="acknowledged"}
            until{js(page,"document.querySelector('[data-testid=message-input]')?.value===${JSONObject.quote(newer)}")=="true"}
            assertEquals(newer,observer.draft(productId).getString("text"));assertEquals(newRevision,observer.draft(productId).getLong("revision"))
            val afterAck=wire.call("sendStatus",JSONObject().put("intentId",intentId));assertEquals(receipt.toString(),afterAck.getJSONObject("receipt").toString());assertEquals(1,requestCount(wire.state(),real))
            // Same intent, including repeated explicit wire actions, never makes another SDK input.
            val repeated=wire.call("send",JSONObject().put("intentId",intentId));assertEquals(receipt.toString(),repeated.getJSONObject("receipt").toString());assertFalse(repeated.getJSONObject("acknowledgement").getBoolean("draftCleared"));assertEquals(1,requestCount(wire.state(),real))
            edit(page,text);click(page,"[data-testid=send-message]")
            until{observer.list(productId).getJSONArray("intents").length()==2};until{history(wire,productId).length()==4};settle(wire,productId)
            val intents=observer.list(productId).getJSONArray("intents");val second=intents.getJSONObject(0)
            assertNotEquals(intentId,second.getString("intentId"));assertEquals(text,second.getJSONObject("preview").getString("text"))
            until{observer.intent(second.getString("intentId")).getString("delivery")=="acknowledged"}
            assertNotEquals(receipt.getLong("submissionId"),observer.intent(second.getString("intentId")).getJSONObject("receipt").getLong("submissionId"))
            assertEquals(2,requestCount(wire.state(),real));assertEquals(4,history(wire,productId).length())
            val recreate=InstrumentationRegistry.getArguments().getString("recreateActivity","true")=="true"
            if(recreate){val beforeRecreate=history(wire,productId).toString();page.recreate();ready(page)
                until{js(page,"document.querySelectorAll('[data-testid=history-message]').length===4")=="true"}
                assertEquals(beforeRecreate,history(wire,productId).toString());assertEquals(2,requestCount(wire.state(),real))}
            evidence(if(real)"real-mimo-ack-repair" else "react-ack-repair",JSONObject().put("host",host).put("firstReceipt",receipt).put("firstIntent",observer.intent(intentId)).put("secondIntent",observer.intent(second.getString("intentId"))).put("observerBusyReads",observer.busyReads).put("newerDraftRetainedAtAck",true).put("readOnlyQueryMutatedNative",false).put("history",history(wire,productId)).put("requestsAfterSameIntentRepair",1).put("requestsAfterNewAction",2).put("activityRecreated",recreate).apply{if(recreate)put("recreateAddedRequests",0)})
        }finally{page.close();store.close();cleanup(wire)}
    }

    @Test(timeout=240000) fun actualSdkCommitBeforeAndAfterOwnerProcessDeath(){
        for(boundary in listOf("sdk-before","sdk-after")){
            val run=id();var page:ActivityScenario<AgentActivity>?=scenario("fixture",run);var wire=Wire("fixture",run);val store=NativeInputStore(context,NativeInputBridge.namespace("fixture",run));val productId="crash-$boundary"
            try{
                val originalHost=wire.ready();wire.call("create",JSONObject().put("creationId",productId))
                val draft=store.save(productId,0,id(),"真实提交边界 $boundary",emptyList());val frozen=store.freeze(productId,draft.getLong("revision"),id())
                val intent=store.createSend(JSONObject().put("actionId",id()).put("id",productId).put("inputToken",frozen.getString("token")).put("expectedContext",store.inspect(productId).getJSONObject("submissionContext")).put("expectedControlVersion",store.readControl(productId).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
                val intentId=intent.getString("intentId");wire.fault(boundary);val pending=wire.async("send",JSONObject().put("intentId",intentId))
                var halted=JSONObject();until{halted=wire.boundary();halted.optString("stage")==boundary}
                val pid=halted.getInt("pid");assertEquals(originalHost.getInt("pid"),pid);assertNotEquals(android.os.Process.myPid(),pid);assertFalse(pending.isDone)
                assertEquals("uncertain",store.readSend(intentId).getString("delivery"));assertFalse(store.readSend(intentId).has("receipt"))
                val domain=File(context.filesDir,"application-validation/$run");assertNull(StorageDomainLease.acquire(domain))
                page?.close();page=null;wire.client.control(38)
                // OS releases the actual owner lease only after that blocked :agent process dies.
                until(15000){StorageDomainLease.acquire(domain)?.let{it.close();true}?:false}
                wire.close();wire=Wire("fixture",run);val reopened=wire.ready();assertNotEquals(pid,reopened.getInt("pid"));assertNotEquals(originalHost.getString("instance"),reopened.getString("instance"))
                settle(wire,productId);val status=wire.call("sendStatus",JSONObject().put("intentId",intentId));assertTrue(status.getBoolean("accepted"));assertEquals("acknowledged",store.readSend(intentId).getString("delivery"))
                val receipt=status.getJSONObject("receipt");val priorHistory=history(wire,productId);assertEquals(2,priorHistory.length());assertEquals("真实提交边界 $boundary",priorHistory.getJSONObject(0).getString("text"));assertEquals(1,requestCount(wire.state(),false))
                for(index in 1..2)assertEquals(receipt.toString(),wire.call("send",JSONObject().put("intentId",intentId)).getJSONObject("receipt").toString())
                assertEquals(priorHistory.toString(),history(wire,productId).toString());assertEquals(1,requestCount(wire.state(),false));assertEquals(1,store.listSends(payload(productId)).getJSONArray("intents").length())
                evidence(boundary,JSONObject().put("halted",halted).put("reopened",reopened).put("intent",store.readSend(intentId)).put("receipt",receipt).put("history",priorHistory).put("ownerLeaseReleasedByDeath",true).put("modelRequestsAfterRecovery",1).put("repeatSameIntentAddedRequests",0))
            }finally{page?.close();store.close();cleanup(wire)}
        }
    }
}
