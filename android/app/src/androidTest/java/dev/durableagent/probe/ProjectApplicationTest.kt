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

/** Real React / native intent authority / SDK storage. Directory configuration is never file-access evidence. */
@RunWith(AndroidJUnit4::class)
class ProjectApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun uuid()=UUID.randomUUID().toString()
    private fun target(id:String)=JSONObject().put("id",id)
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("projectEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private fun until(timeout:Long=90000,condition:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Project public state timed out",SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)}}
    private fun launch(mode:String,run:String)=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        private val connection=uuid()
        private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,mode,run){what,text->if(what==12)states.offer(JSONObject(text));if(what==10){val response=JSONObject(text);pending.remove(response.optString("requestId"))?.complete(response)}else if(what>12)controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(JSONObject(text))}.apply{connect()}
        val busyReads=JSONObject()
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{
            val started=SystemClock.elapsedRealtime()
            while(true){
                val id=uuid();val response=CompletableFuture<JSONObject>();pending[id]=response
                client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString())
                val result=response.get(30,TimeUnit.SECONDS)
                if(result.getBoolean("ok"))return result.getJSONObject("value")
                val query=method in setOf("sendStatus","open","list","history","projects.get")
                if(!query||result.optJSONObject("error")?.optString("code")!="INPUT_STORAGE_BUSY")error(result.toString())
                busyReads.put(method,busyReads.optInt(method)+1)
                if(SystemClock.elapsedRealtime()-started>2000)error("Public observation remained busy: $method ${result}")
                Thread.sleep(25)
            }
        }
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Project host state timeout")}
        fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("Project control $what timeout")}
        fun ready():JSONObject{var value=JSONObject();until{value=state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready"};return value}
        fun closeHost(){client.control(20,"close");until(15000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private inner class Observer(private val store:NativeInputStore){
        val busyReads=JSONObject()
        fun read(name:String,operation:()->JSONObject):JSONObject{val started=SystemClock.elapsedRealtime();while(true){try{return operation()}catch(error:NativeInputException){if(error.code!="INPUT_STORAGE_BUSY")throw error;busyReads.put(name,busyReads.optInt(name)+1);if(SystemClock.elapsedRealtime()-started>2000)throw AssertionError("Native read remained busy: $name",error);Thread.sleep(25)}}}
        fun draft(id:String)=read("inspect"){store.inspect(id)}
        fun intents(id:String)=read("listSends"){store.listSends(target(id))}.getJSONArray("intents")
        fun intent(id:String)=read("readSend"){store.readSend(id)}
    }
    private fun js(page:ActivityScenario<AgentActivity>,source:String):String{val response=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(source){value->response.complete(value)}?:response.complete("null")};return response.get(10,TimeUnit.SECONDS)}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until{js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun change(page:ActivityScenario<AgentActivity>,selector:String,value:String){until{js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"(()=>{const e=document.querySelector(${JSONObject.quote(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSONObject.quote(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()")}
    private fun ready(page:ActivityScenario<AgentActivity>){until{js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun history(wire:Wire,id:String)=wire.call("history",target(id)).getJSONArray("items")
    private fun settled(wire:Wire,intentId:String){
        var status=JSONObject();until{status=wire.call("sendStatus",JSONObject().put("intentId",intentId));status.optJSONObject("submission")?.optString("status")=="done"}
        val id=status.getJSONObject("intent").getString("id");val snapshot=wire.call("open",target(id))
        evidence("input-settled-before-run-check",JSONObject().put("intentId",intentId).put("phase",snapshot.optString("phase")).put("metrics",wire.state().getJSONObject("metrics")).put("history",history(wire,id)))
        // Submission settlement can precede SDK tool completion and its follow-up generation.
        // The request count/witness assertions below require the whole observed run to finish.
        until{val current=wire.call("open",target(id));if(current.optString("phase")=="failed")error(current.toString());current.optString("phase")=="done"}
    }
    private fun requests(wire:Wire,real:Boolean)=wire.state().getJSONObject("metrics").optInt(if(real)"transportRequests" else "modelRequests")
    private fun assertWitness(value:JSONObject,receipt:JSONObject,path:String,projectId:String?){
        val expected=receipt.getJSONObject("context")
        assertEquals(receipt.getString("bindingId"),value.getString("bindingId"));assertEquals(expected.getJSONObject("location").getString("workspaceId"),value.getString("workspaceId"));assertEquals(expected.getJSONObject("location").getLong("version"),value.getLong("version"));assertEquals(path,value.getString("path"));assertEquals("validation-directory:$path",value.getString("actualIdentity"))
        if(projectId==null)assertTrue(value.isNull("projectId")) else assertEquals(projectId,value.getString("projectId"))
        if(value.has("sdkConversationId")){assertEquals(expected.getLong("sdkConversationId"),value.getLong("sdkConversationId"));assertTrue(value.getLong("toolTaskId")>0)}
    }

    @Test(timeout=240000) fun actualAndroidSharedProjectPolicy(){
        val run=uuid();val page=launch("fixture",run);val wire=Wire("fixture",run)
        try{
            wire.ready();wire.client.control(42);var state=JSONObject()
            until(150000){state=wire.state();val phase=state.getJSONObject("metrics").optString("projectPolicyState");if(phase=="failed")error(state.toString());phase=="passed"}
            val cases=state.getJSONObject("metrics").getJSONArray("projectPolicyCases");assertEquals("Expected the full shared policy registration",16,cases.length());for(index in 0 until cases.length())assertTrue(cases.getJSONObject(index).getBoolean("passed"))
            evidence("shared-project-policy",state)
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }

    @Test(timeout=240000) fun realReactProjectSelectionSharedRenameAndStableReopen(){flow(false)}
    @Test(timeout=300000) fun realMimoBusyRefusalAndExplicitNewLocation(){assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true");flow(true)}

    private fun flow(real:Boolean){
        val mode=if(real)"real" else "fixture";val run=uuid();var page:ActivityScenario<AgentActivity>?=launch(mode,run);var wire=Wire(mode,run)
        val store=NativeInputStore(context,NativeInputBridge.namespace(mode,run));val observer=Observer(store)
        val firstMarker="T08-A-"+uuid().take(8);val secondMarker="T08-B-"+uuid().take(8)
        val firstText=if(real)"请先调用 location_witness 工具读取本次采用的位置，再回复一句简短中文问候并原样包含 $firstMarker。" else "旧默认位置的输入🌍"
        val secondText=if(real)"请先调用 location_witness 工具读取本次采用的位置，再回复一句简短中文问候并原样包含 $secondMarker。" else "显式项目位置的新输入🌍"
        val configuredPath="/validation/project-$run"
        try{
            val originalHost=wire.ready();wire.control(41,"witness");ready(page!!);click(page!!,"[data-testid=create-conversation]")
            until{wire.call("list").getJSONArray("conversations").length()==1};val productId=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            val initial=wire.call("projects.get",target(productId));assertTrue(initial.getJSONObject("selection").isNull("projectId"));assertEquals("default",initial.getJSONObject("selection").getString("workspaceId"));assertEquals(1,initial.getJSONArray("workspaces").length());val defaultPath=initial.getJSONArray("workspaces").getJSONObject(0).getString("path")
            click(page!!,"[data-testid=open-project-settings]");change(page!!,"[data-testid=workspace-name]","共享资料目录");change(page!!,"[data-testid=workspace-path]",configuredPath);click(page!!,"[data-testid=workspace-create]")
            until{wire.call("projects.get").getJSONArray("workspaces").length()==2};val workspaces=wire.call("projects.get").getJSONArray("workspaces");val workspace=(0 until workspaces.length()).map{workspaces.getJSONObject(it)}.first{it.getString("id")!="default"};val workspaceId=workspace.getString("id")
            change(page!!,"[data-testid=project-name]","持续工作项目");change(page!!,"[data-testid=project-workspace]",workspaceId);click(page!!,"[data-testid=project-create]")
            until{wire.call("projects.get").getJSONArray("projects").length()==1};val projectId=wire.call("projects.get").getJSONArray("projects").getJSONObject(0).getString("id")
            until{js(page!!,"document.querySelector('[data-testid=conversation-project]')?.disabled===false")=="true"}
            // Establish a prior explicit native send. UI idle alone cannot authorize changing its location.
            val before=observer.draft(productId);val saved=store.save(productId,before.getLong("revision"),uuid(),firstText,emptyList());val fixed=store.freeze(productId,saved.getLong("revision"),uuid())
            val pending=store.createSend(JSONObject().put("actionId",uuid()).put("id",productId).put("inputToken",fixed.getString("token")).put("expectedContext",observer.draft(productId).getJSONObject("submissionContext")).put("expectedControlVersion",observer.read("readControl"){store.readControl(productId)}.getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            val firstIntent=pending.getString("intentId");change(page!!,"[data-testid=conversation-project]",projectId);click(page!!,"[data-testid=conversation-project-apply]")
            until{js(page!!,"!!document.querySelector('[data-testid=project-settings] [role=alert]')")=="true"};assertTrue(wire.call("projects.get",target(productId)).getJSONObject("selection").isNull("projectId"))
            val refusal=js(page!!,"document.querySelector('[data-testid=project-settings] [role=alert]').textContent")
            val first=wire.call("send",JSONObject().put("intentId",firstIntent));settled(wire,firstIntent);val firstRequestCount=requests(wire,real);assertEquals(2,firstRequestCount)
            val firstWitnesses=wire.state().getJSONObject("metrics").getJSONArray("projectToolWitnesses");assertEquals(1,firstWitnesses.length());assertWitness(firstWitnesses.getJSONObject(0),first.getJSONObject("receipt"),defaultPath,null)
            if(real)assertTrue((0 until history(wire,productId).length()).map{history(wire,productId).getJSONObject(it)}.any{it.getString("role")=="assistant"&&it.getString("text").contains(firstMarker)})
            click(page!!,"[data-testid=refresh-projects]");until{js(page!!,"document.querySelector('[data-testid=refresh-projects]')?.disabled===false")=="true"};assertTrue(wire.call("projects.get",target(productId)).getJSONObject("selection").isNull("projectId"))
            click(page!!,"[data-testid=conversation-project-apply]");until{wire.call("projects.get",target(productId)).getJSONObject("selection").optString("projectId")==projectId}
            until{observer.draft(productId).getJSONObject("submissionContext").getInt("associationVersion")==2}
            until{js(page!!,"document.querySelector('[data-testid=current-workspace-path]')?.textContent===${JSONObject.quote(configuredPath)}")=="true"}
            val selected=wire.call("projects.get",target(productId));assertEquals(workspaceId,selected.getJSONObject("selection").getString("workspaceId"))
            assertEquals(first.getJSONObject("receipt").toString(),wire.call("send",JSONObject().put("intentId",firstIntent)).getJSONObject("receipt").toString());assertEquals(firstRequestCount,requests(wire,real))
            click(page!!,"[aria-label='返回会话']");change(page!!,"[data-testid=message-input]",secondText)
            // The earlier native-only intent/ACK may have advanced the draft behind this UI.
            // Exercise the existing explicit recovery control; never bypass CAS or replay Send.
            var recoveredDraftConflict=false;var draftState=""
            until{draftState=js(page!!,"document.querySelector('[data-testid=draft-status]')?.dataset.state");if(draftState=="\"failed\"")error(js(page!!,"document.querySelector('.draft-error')?.textContent"));draftState=="\"conflict\""||draftState=="\"saved\""&&observer.draft(productId).getString("text")==secondText}
            assertEquals("true",js(page!!,"document.querySelector('[data-testid=message-input]').value===${JSONObject.quote(secondText)}"))
            if(draftState=="\"conflict\""){
                assertEquals("true",js(page!!,"(()=>{const button=[...document.querySelectorAll('.draft-recovery button')].find(e=>e.textContent==='保留本地内容并重试');if(!button||button.disabled)return false;button.click();return true;})()"))
                recoveredDraftConflict=true
            }
            until{js(page!!,"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"&&observer.draft(productId).getString("text")==secondText}
            assertEquals("true",js(page!!,"document.querySelector('[data-testid=message-input]').value===${JSONObject.quote(secondText)}"))
            click(page!!,"[data-testid=send-message]")
            until{observer.intents(productId).length()==2};val secondIntent=observer.intents(productId).getJSONObject(0).getString("intentId");settled(wire,secondIntent)
            val second=wire.call("sendStatus",JSONObject().put("intentId",secondIntent));assertEquals(workspaceId,second.getJSONObject("receipt").getJSONObject("context").getJSONObject("location").getString("workspaceId"));assertEquals(2,second.getJSONObject("receipt").getJSONObject("context").getInt("associationVersion"));assertNotEquals(first.getJSONObject("receipt").getString("bindingId"),second.getJSONObject("receipt").getString("bindingId"));val finalRequestCount=requests(wire,real);assertEquals(4,finalRequestCount)
            val witnessMetrics=wire.state().getJSONObject("metrics");val witnesses=witnessMetrics.getJSONArray("projectToolWitnesses");assertEquals(2,witnesses.length());assertWitness(witnesses.getJSONObject(0),first.getJSONObject("receipt"),defaultPath,null);assertWitness(witnesses.getJSONObject(1),second.getJSONObject("receipt"),configuredPath,projectId);assertNotEquals(witnesses.getJSONObject(0).getLong("toolTaskId"),witnesses.getJSONObject(1).getLong("toolTaskId"))
            val environments=witnessMetrics.getJSONArray("projectEnvironments");assertTrue(environments.length()>=2);for(index in 0 until environments.length()){val value=environments.getJSONObject(index);if(value.getString("bindingId")==first.getJSONObject("receipt").getString("bindingId"))assertWitness(value,first.getJSONObject("receipt"),defaultPath,null)else assertWitness(value,second.getJSONObject("receipt"),configuredPath,projectId)}
            assertEquals(2,(0 until history(wire,productId).length()).count{history(wire,productId).getJSONObject(it).getString("role")=="user"})
            if(real)assertTrue((0 until history(wire,productId).length()).map{history(wire,productId).getJSONObject(it)}.any{it.getString("role")=="assistant"&&it.getString("text").contains(secondMarker)})
            // Another product references the same project; its name is shared current metadata.
            val other="shared-other";wire.call("create",JSONObject().put("creationId",other));val catalog=wire.call("projects.get")
            wire.call("projects.select",JSONObject().put("operationId",uuid()).put("expectedVersion",catalog.getLong("version")).put("id",other).put("projectId",projectId))
            click(page!!,"[data-testid=open-project-settings]");change(page!!,"[data-project-id='$projectId'] [data-testid=project-rename]","共享项目当前名称");click(page!!,"[data-project-id='$projectId'] [data-testid=project-rename-apply]")
            until{wire.call("projects.get",target(other)).getJSONArray("projects").getJSONObject(0).getString("name")=="共享项目当前名称"}
            assertEquals(second.getJSONObject("receipt").toString(),wire.call("sendStatus",JSONObject().put("intentId",secondIntent)).getJSONObject("receipt").toString())
            val beforeHistory=history(wire,productId).toString();val recreate=InstrumentationRegistry.getArguments().getString("recreateActivity","true")=="true"
            if(recreate){page!!.recreate();ready(page!!);assertEquals(finalRequestCount,requests(wire,real))}
            if(!real){page!!.close();page=null;wire.closeHost();wire.close();wire=Wire("fixture",run);val reopened=wire.ready();assertNotEquals(originalHost.getString("instance"),reopened.getString("instance"));assertEquals(0,requests(wire,false))}
            assertEquals(beforeHistory,history(wire,productId).toString())
            val recovered=wire.call("projects.get",target(productId));assertEquals(projectId,recovered.getJSONObject("selection").getString("projectId"));assertEquals("共享项目当前名称",recovered.getJSONArray("projects").getJSONObject(0).getString("name"));assertEquals(second.getJSONObject("receipt").toString(),wire.call("sendStatus",JSONObject().put("intentId",secondIntent)).getJSONObject("receipt").toString())
            evidence(if(real)"real-mimo-project-flow" else "react-project-flow",JSONObject().put("firstReceipt",first.getJSONObject("receipt")).put("secondReceipt",second.getJSONObject("receipt")).put("refusedReason",refusal).put("selected",selected).put("recovered",recovered).put("projectToolWitnesses",witnesses).put("projectEnvironments",environments).put("activityRecreated",recreate).put("hostReopened",!real).put("explicitModelRequests",finalRequestCount).put("fileAccessVerified",false).put("nativeObserverBusyReads",observer.busyReads).put("interfaceObserverBusyReads",wire.busyReads).put("recoveredDraftConflict",recoveredDraftConflict).apply{if(!real)put("reopenAddedModelRequests",0)})
        }finally{page?.close();store.close();try{wire.closeHost()}finally{wire.close()}}
    }
}
