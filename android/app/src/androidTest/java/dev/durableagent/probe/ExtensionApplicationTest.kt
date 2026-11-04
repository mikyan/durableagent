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

/** The actual React/SDK/native stores. Only model transport and explicit debug fault boundaries vary. */
@RunWith(AndroidJUnit4::class)
class ExtensionApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun uuid()=UUID.randomUUID().toString()
    private fun target(id:String)=JSONObject().put("id",id)
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("extensionEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private fun until(label:String,timeout:Long=90000,condition:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Extension state timeout: $label",SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)}}
    private fun launch(mode:String,run:String)=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        private val connection=uuid();private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)pending.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
        fun async(method:String,payload:JSONObject=JSONObject()):CompletableFuture<JSONObject>{val id=uuid();val result=CompletableFuture<JSONObject>();pending[id]=result;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());return result}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val start=SystemClock.elapsedRealtime();while(true){val response=async(method,payload).get(30,TimeUnit.SECONDS);if(response.getBoolean("ok"))return response.getJSONObject("value");if(method !in setOf("open","history","list","routing.query","sendStatus","sendList")||response.optJSONObject("error")?.optString("code")!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()-start>2000)error(response.toString());Thread.sleep(25)}}
        fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("Control $what timeout")}
        fun state()=control(12)
        fun closeBeforeReady():JSONObject{
            val queue=controls.computeIfAbsent(12){LinkedBlockingQueue()};queue.clear()
            client.control(12);client.control(20,"close")
            return queue.poll(10,TimeUnit.SECONDS)?:error("Opening state observation timed out")
        }
        fun ready():JSONObject{
            // Bundle unpack/JNI initialization runs on the owner before it can answer a query.
            // Keep one read pending within the existing readiness deadline; the short control
            // timeout is for an already-running host, not a second startup deadline.
            val queue=controls.computeIfAbsent(12){LinkedBlockingQueue()};queue.clear();client.control(12)
            val started=SystemClock.elapsedRealtime();var state=JSONObject()
            until("host ready; last=$state"){
                queue.poll(25,TimeUnit.MILLISECONDS)?.let{value->state=value
                    if(state.optString("phase")=="failed")error(state.toString())
                    if(state.optString("phase")!="ready")client.control(12)
                }
                state.optString("phase")=="ready"
            }
            evidence("host-ready-observation",JSONObject().put("elapsedMs",SystemClock.elapsedRealtime()-started).put("state",state))
            return state
        }
        fun closeHost(){client.control(20,"close");until("host close",15000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,script:String):String{val result=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(script){value->result.complete(value)}?:result.complete("null")};return result.get(10,TimeUnit.SECONDS)}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until("button $selector"){js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun edit(page:ActivityScenario<AgentActivity>,text:String){until("composer"){js(page,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"};js(page,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")}
    private var rendererRecoveries=0
    private fun recoverRenderer(page:ActivityScenario<AgentActivity>):Boolean {
        var recovered=false
        page.onActivity { activity -> if(activity.webView==null){
            fun button(view:android.view.View):android.widget.Button? {
                if(view is android.widget.Button&&view.text=="重新打开")return view
                if(view is android.view.ViewGroup)for(index in 0 until view.childCount){button(view.getChildAt(index))?.let{return it}}
                return null
            }
            val reopen=button(activity.findViewById(android.R.id.content))?:error("Renderer gone without explicit recovery control")
            check(rendererRecoveries<2){"Renderer repeatedly failed; no automatic reopen loop"};rendererRecoveries++;reopen.performClick();recovered=true
        }}
        if(recovered)evidence("explicit-renderer-recovery",JSONObject().put("count",rendererRecoveries).put("action","clicked existing 重新打开 control"))
        return recovered
    }
    private fun ready(page:ActivityScenario<AgentActivity>){until("React ready"){recoverRenderer(page);js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun read(operation:()->JSONObject):JSONObject{val start=SystemClock.elapsedRealtime();while(true){try{return operation()}catch(e:NativeInputException){if(e.code!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()-start>2000)throw e;Thread.sleep(25)}}}
    private fun history(w:Wire,id:String)=w.call("history",target(id).put("limit",100)).getJSONArray("items")
    private fun settled(w:Wire,id:String){until("settled $id"){val value=w.call("open",target(id));if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="done"}}
    private fun send(w:Wire,id:String,text:String)=w.call("send",SubmissionTestDriver.payload(context,w.mode,w.run,"send",target(id).put("text",text).put("actionId",uuid())))
    private fun count(w:Wire,real:Boolean)=w.state().getJSONObject("metrics").optInt(if(real)"transportRequests" else "modelRequests")
    private fun route(w:Wire,text:String,action:String=uuid()):JSONObject{val source=w.call("routing.query",target("source"));val destination=w.call("routing.query",target("target"));return JSONObject().put("actionId",action).put("id","target").put("text",text).put("source",target("source").put("sdkConversationId",source.getJSONObject("context").getLong("sdkConversationId")).put("controlGeneration",source.getJSONObject("control").getLong("generation"))).put("expectedContext",destination.getJSONObject("context")).put("expectedControlVersion",destination.getJSONObject("control").getLong("version"))}
    private fun cleanup(wire:Wire,primary:Throwable?=null){
        try{try{if(wire.control(37).optString("stage").isNotEmpty())wire.client.control(38)else wire.closeHost()}finally{wire.close()}}
        catch(cleanupFailure:Throwable){if(primary==null)throw cleanupFailure;primary.addSuppressed(cleanupFailure)}
    }

    @Test(timeout=180000) fun actualAndroidRegistryAndRoutingPolicies(){
        val run=uuid();val wire=Wire("extensions-fixture",run)
        var primary:Throwable?=null
        try{wire.ready();wire.client.control(52);var state=JSONObject();until("shared extension policies"){state=wire.state();val status=state.getJSONObject("metrics").optString("extensionPolicyState");if(status=="failed")error(state.toString());status=="passed"};assertEquals(12,state.getJSONObject("metrics").getJSONArray("extensionPolicyCases").length());evidence("shared-extension-policy",state)}catch(error:Throwable){primary=error;throw error}finally{cleanup(wire,primary)}
    }

    @Test(timeout=120000) fun debugCloseDuringBootstrapReleasesDomainBeforeNextValidationRun(){
        val run=uuid();var wire=Wire("extensions-fixture",run);var primary:Throwable?=null
        try{
            val before=wire.closeBeforeReady();evidence("debug-close-before-ready",before)
            assertEquals("The close must precede JS readiness","opening",before.optString("phase"))
            var closed=JSONObject();until("close requested during bootstrap",15000){closed=wire.state();closed.optString("phase")=="closed"&&!closed.optBoolean("domainOwned")}
            assertEquals(0,closed.getInt("nativeOwners"));wire.close()
            val nextRun=uuid();wire=Wire("extensions-fixture",nextRun);val opened=wire.ready()
            assertNotEquals(before.getString("instance"),opened.getString("instance"))
            wire.call("create",JSONObject().put("creationId","new-domain"))
            NativeInputStore(context,NativeInputBridge.namespace("extensions-fixture",nextRun)).use{store->assertEquals("",store.inspect("new-domain").getString("text"))}
            evidence("debug-close-next-domain",JSONObject().put("closed",closed).put("opened",opened).put("newNativeDraftFound",true))
        }catch(error:Throwable){primary=error;throw error}finally{cleanup(wire,primary)}
    }

    @Test(timeout=240000) fun realReactTimelinePagesAndUnmountDoesNotStopRunningConversation(){
        val run=uuid();var mode="extensions-fixture";var page:ActivityScenario<AgentActivity>?=launch(mode,run);var wire=Wire(mode,run)
        try{wire.ready();ready(page!!);click(page!!,"[data-testid=create-conversation]");until("one conversation"){wire.call("list").getJSONArray("conversations").length()==1};val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            for(index in 0 until 26){send(wire,id,"分页记录 $index 北京🌍");settled(wire,id)};assertEquals(26,count(wire,false));val stored=history(wire,id).toString()
            page!!.close();page=null;wire.closeHost();wire.close();mode="hang";wire=Wire(mode,run);wire.ready();page=launch(mode,run);ready(page!!)
            send(wire,id,"保持运行的输入");until("live run"){wire.call("open",target(id)).optString("phase")=="running"}
            click(page!!,"[data-testid=open-extensions]");click(page!!,"[data-testid=toggle-timeline]");until("actual mounted"){js(page!!,"document.body.textContent.includes('本页已挂载')")=="true"}
            assertEquals("true",js(page!!,"document.querySelector('[data-extension-id=timeline]').textContent.includes('无需 Agent 贡献')"));assertEquals("true",js(page!!,"document.querySelector('[data-extension-id=routing]').textContent.includes('SDK 已安装：app.routing')"))
            until("older page button"){js(page!!,"[...document.querySelectorAll('.timeline button')].some(e=>e.textContent==='加载更早记录'&&!e.disabled)")=="true"};js(page!!,"[...document.querySelectorAll('.timeline button')].find(e=>e.textContent==='加载更早记录').click()")
            until("all timeline rows"){js(page!!,"document.querySelectorAll('.timeline [data-entry-id]').length===53")=="true"};assertEquals("true",js(page!!,"document.querySelector('.timeline').textContent.includes('分页记录 0 北京🌍')"))
            click(page!!,"[data-testid=toggle-timeline]");assertEquals("false",js(page!!,"!!document.querySelector('[data-testid=extension-timeline]')"));assertEquals("running",wire.call("open",target(id)).getString("phase"));assertEquals(1,count(wire,false))
            val beforeRenderer=wire.state();page!!.onActivity{check(it.webView?.webViewRenderProcess?.terminate()==true){"Cannot terminate actual renderer"}}
            until("renderer termination",10000){var gone=false;page!!.onActivity{gone=it.webView==null};gone};assertTrue(recoverRenderer(page!!));ready(page!!)
            assertEquals(beforeRenderer.getString("instance"),wire.state().getString("instance"));assertEquals("running",wire.call("open",target(id)).getString("phase"));assertEquals(1,count(wire,false))
            until("reopened current input"){js(page!!,"document.body.textContent.includes('保持运行的输入')")=="true"}
            val stop=SubmissionTestDriver.payload(context,mode,run,"stop",target(id).put("actionId",uuid()));wire.call("stop",stop)
            evidence("ui-only-timeline",JSONObject().put("storedBeforeRun",stored).put("pagedRows",53).put("actualMounted",true).put("stillRunningAfterUnmount",true).put("newModelRequests",1).put("explicitStopAfterUnmount",true).put("rendererRecoveries",rendererRecoveries).put("explicitRendererTerminationRecovered",true))
        }finally{page?.close();cleanup(wire)}
    }

    @Test(timeout=240000) fun realReactToolTransferAndAckReconciliation(){routingFlow(false)}
    @Test(timeout=300000) fun realMimoExplicitToolTransferPreservesDraft(){assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true");routingFlow(true)}
    private fun routingFlow(real:Boolean){
        val dropAck=!real||InstrumentationRegistry.getArguments().getString("routeAckLoss")=="true";val mode=if(real)"extensions-real" else "extensions-fixture";val run=uuid();var page:ActivityScenario<AgentActivity>?=launch(mode,run);var wire=Wire(mode,run);val store=NativeInputStore(context,NativeInputBridge.namespace(mode,run));val draft="目标尚未发送的正文🌍 "+uuid().take(6);val marker="T14-"+uuid().take(8);val forwarded="请仅回复转交标记 $marker";val prompt="用户明确要求：只调用一次 conversation_transfer，将正文「$forwarded」转交到稳定产品会话 ID PLACEHOLDER。不要创建会话，不要复制其他上下文；得到接纳结果后简短确认。"
        try{wire.ready();ready(page!!);click(page!!,"[data-testid=create-conversation]");until("target created"){wire.call("list").getJSONArray("conversations").length()==1};val target=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id");edit(page!!,draft);until("target draft saved"){read{store.inspect(target)}.getString("text")==draft};val draftBefore=read{store.inspect(target)}
            click(page!!,"[data-testid=create-conversation]");until("source created"){wire.call("list").getJSONArray("conversations").length()==2};val products=wire.call("list").getJSONArray("conversations");val source=(0 until products.length()).map{products.getJSONObject(it).getString("id")}.first{it!=target}
            wire.control(51,target(target).put("text",forwarded).put("forbiddenDraft",draft).toString());wire.control(36,if(dropAck)"ack-drop" else "off");edit(page!!,prompt.replace("PLACEHOLDER",target));click(page!!,"[data-testid=send-message]")
            until("target native intent"){read{store.listSends(target(target))}.getJSONArray("intents").length()==1};settled(wire,source);settled(wire,target)
            val targetIntent=read{store.listSends(target(target))}.getJSONArray("intents").getJSONObject(0);val status=wire.call("sendStatus",JSONObject().put("intentId",targetIntent.getString("intentId")));assertTrue(status.getBoolean("accepted"));assertEquals(source,targetIntent.getJSONObject("source").getString("id"));assertTrue(targetIntent.getJSONObject("source").getLong("taskId")>0)
            assertEquals(forwarded,targetIntent.getJSONObject("preview").getString("text"));assertEquals(if(dropAck)"uncertain" else "acknowledged",targetIntent.getString("delivery"));assertEquals(draftBefore.getLong("revision"),read{store.inspect(target)}.getLong("revision"));assertEquals(draft,read{store.inspect(target)}.getString("text"));assertEquals(3,count(wire,real))
            assertFalse(history(wire,source).toString().contains(draft));assertFalse(wire.state().getJSONObject("metrics").getBoolean("extensionRequestHasTargetDraft"))
            if(real)assertTrue(history(wire,target).getJSONObject(1).getString("text").contains(marker));assertEquals(2,history(wire,target).length())
            val receipt=status.getJSONObject("receipt");wire.control(36,"off");val repaired=wire.call("send",JSONObject().put("intentId",targetIntent.getString("intentId")));assertEquals(receipt.toString(),repaired.getJSONObject("receipt").toString());assertFalse(repaired.getJSONObject("acknowledgement").getBoolean("draftCleared"));assertEquals(draft,read{store.inspect(target)}.getString("text"));assertEquals(3,count(wire,real))
            val before=history(wire,target).toString();page!!.recreate();ready(page!!);assertEquals(before,history(wire,target).toString());assertEquals(3,count(wire,real));page!!.close();page=null;wire.closeHost();wire.close();wire=Wire("extensions-fixture",run);wire.ready();assertEquals(before,history(wire,target).toString());assertEquals(receipt.toString(),wire.call("sendStatus",JSONObject().put("intentId",targetIntent.getString("intentId"))).getJSONObject("receipt").toString());assertEquals(0,count(wire,false));assertEquals(draft,read{store.inspect(target)}.getString("text"))
            evidence(if(real)"real-mimo-tool-route" else "react-tool-route",JSONObject().put("source",source).put("target",target).put("intent",targetIntent).put("receipt",receipt).put("targetHistory",history(wire,target)).put("targetDraftPreserved",true).put("sourceHistoryContainsTargetDraft",false).put("serializedModelRequestContainsTargetDraft",false).put("ackLossInjected",dropAck).put("explicitCloudRequests",3).put("ackReconcileAddedRequests",0).put("reopenAddedRequests",0).put("activityRecreated",true))
        }finally{page?.close();store.close();cleanup(wire)}
    }

    @Test(timeout=240000) fun actualSdkRouteCommitAcrossOwnerProcessDeath(){
        for(boundary in listOf("sdk-before","sdk-after")){
            val run=uuid();var wire=Wire("extensions-fixture",run);val store=NativeInputStore(context,NativeInputBridge.namespace("extensions-fixture",run))
            try{val original=wire.ready();wire.call("create",JSONObject().put("creationId","source"));wire.call("create",JSONObject().put("creationId","target"));store.save("target",0,uuid(),"进程死亡时也保留目标草稿",emptyList());val request=route(wire,"独立转交的固定输入");wire.control(36,boundary.toString());val pending=wire.async("routing.send",request);var halted=JSONObject();until("$boundary actual owner barrier"){halted=wire.control(37);halted.optString("stage")==boundary};assertFalse(pending.isDone);val pid=halted.getInt("pid");assertEquals(original.getInt("pid"),pid);assertNotEquals(android.os.Process.myPid(),pid);assertEquals("uncertain",store.readSend(request.getString("actionId")).getString("delivery"))
                val domain=File(context.filesDir,"application-validation/$run");assertNull(StorageDomainLease.acquire(domain));wire.client.control(38);until("owner lease released",15000){StorageDomainLease.acquire(domain)?.let{it.close();true}?:false};wire.close();wire=Wire("extensions-fixture",run);val reopened=wire.ready();assertNotEquals(pid,reopened.getInt("pid"));settled(wire,"target");val status=wire.call("sendStatus",JSONObject().put("intentId",request.getString("actionId")));assertTrue(status.getBoolean("accepted"));assertEquals("acknowledged",store.readSend(request.getString("actionId")).getString("delivery"));assertEquals(2,history(wire,"target").length());assertEquals(0,history(wire,"source").length());assertEquals("进程死亡时也保留目标草稿",store.inspect("target").getString("text"));assertEquals(1,count(wire,false));val again=wire.call("routing.send",request);assertEquals(status.getJSONObject("receipt").toString(),again.getJSONObject("receipt").toString());assertEquals(1,count(wire,false));evidence("route-$boundary",JSONObject().put("halted",halted).put("reopened",reopened).put("status",status).put("history",history(wire,"target")).put("uniqueInput",true).put("sourceGenerationRetained",true))
            }finally{store.close();cleanup(wire)}
        }
    }
}
