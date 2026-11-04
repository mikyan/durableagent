package dev.durableagent.probe

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Bundled React -> native input intent -> real SDK -> authenticated, actual Termux process. */
@RunWith(AndroidJUnit4::class)
class ExecutionApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun uuid()=UUID.randomUUID().toString()
    private fun target(id:String)=JSONObject().put("id",id)
    private fun until(timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Execution public state timed out",SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("executionEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private inner class Wire(val run:String):AutoCloseable {
        private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        private val busy=LinkedBlockingQueue<JSONObject>()
        private val connection=uuid()
        val client=ApplicationClient(context,"execution",run){what,text->if(what==12)states.offer(JSONObject(text));if(what==35)busy.offer(JSONObject(text));if(what==10){val value=JSONObject(text);pending.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {val id=uuid();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val result=future.get(35,TimeUnit.SECONDS);check(result.getBoolean("ok")){result.toString()};return result.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Host status timeout")}
        fun busyState():JSONObject{busy.clear();client.control(35);return busy.poll(3,TimeUnit.SECONDS)?:error("Independent native busy barrier timeout")}
        fun ready(){until{val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}}
        fun closeHost(){client.control(20,"close");until(15000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,code:String):String{val future=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(code){value->future.complete(value)}?:future.complete("null")};return future.get(10,TimeUnit.SECONDS)}
    private fun ready(page:ActivityScenario<AgentActivity>){until{js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until{js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun button(page:ActivityScenario<AgentActivity>,text:String){until{js(page,"(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSONObject.quote(text)});if(!b||b.disabled)return false;b.click();return true})()")=="true"}}
    private fun send(page:ActivityScenario<AgentActivity>,text:String){until{js(page,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"};js(page,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()");until{js(page,"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"};click(page,"[data-testid=send-message]")}
    private fun entriesText(snapshot:JSONObject):String {val entries=snapshot.getJSONArray("entries");return (0 until entries.length()).joinToString("\n"){entries.getJSONObject(it).optString("text","")}}
    private fun records(wire:Wire,id:String)=wire.call("execution.list",target(id)).getJSONArray("executions")
    private fun completed(wire:Wire,id:String,count:Int):JSONObject{var receipt=JSONObject();until{val rows=records(wire,id);if(rows.length()<count)return@until false;receipt=rows.getJSONObject(count-1);receipt.optString("state") in setOf("completed","stopped","not_started","unknown")&&wire.call("open",target(id)).optString("phase")=="done"};return receipt}

    @Test(timeout=180000) fun actualExecutionCanBeQueriedAndStoppedThroughUiWhileNodeOwnerIsBusy(){
        val run=uuid();val wire=Wire(run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run))
        try{
            wire.ready();ready(page);click(page,"[data-testid=create-conversation]")
            until{wire.call("list").getJSONArray("conversations").length()==1}
            val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            send(page,"EXEC_CANCEL")
            var executionId=""
            until{val rows=records(wire,id);if(rows.length()!=1)return@until false;executionId=rows.getJSONObject(0).getString("executionId");rows.getJSONObject(0).optString("state")=="running"}
            button(page,"查看本会话执行")
            until{js(page,"document.querySelector('[data-testid=execution-row]')?.dataset.state==='running'")=="true"}
            // Observe the actual public native responses while keeping React's receiver intact.
            js(page,"window.__busyExecutionReceipts=[];{const original=window.__durableReceive;window.__durableReceive=value=>{if(value.ok&&value.value?.executionId===${JSONObject.quote(executionId)})window.__busyExecutionReceipts.push(value.value);original(value)}}")
            wire.client.control(34,"15000")
            until{val value=wire.busyState();value.getLong("started")>0&&value.getLong("ended")==0L}
            button(page,"核验状态")
            until(6000){js(page,"window.__busyExecutionReceipts.some(x=>x.state==='running')")=="true"}
            val queryBarrier=wire.busyState()
            assertEquals("Native query must finish while the Node owner is still busy",0L,queryBarrier.getLong("ended"))
            button(page,"取消本次执行")
            until(8000){
                if(js(page,"window.__busyExecutionReceipts.some(x=>x.state==='stopped'&&x.scopeConfirmed===true)")=="true")true
                else{js(page,"(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='核验状态');if(b&&!b.disabled)b.click()})()");false}
            }
            val stoppedBarrier=wire.busyState()
            assertEquals("Confirmed scope stop must finish before the real busy loop ends",0L,stoppedBarrier.getLong("ended"))
            val stopped=JSONObject(JSONTokener(js(page,"JSON.stringify(window.__busyExecutionReceipts.find(x=>x.state==='stopped'&&x.scopeConfirmed===true))")).nextValue() as String)
            assertEquals(executionId,stopped.getString("executionId"))
            assertEquals("\"stopped\"",js(page,"document.querySelector('[data-testid=execution-row]').dataset.state"))
            until(20000){wire.busyState().getLong("ended")>0}
            assertEquals("stopped",completed(wire,id,1).getString("state"))
            send(page,"EXEC_VERIFY_CANCEL")
            val verified=completed(wire,id,2)
            assertEquals("completed",verified.getString("state"));assertEquals(0,verified.getInt("exitCode"))
            assertTrue(entriesText(wire.call("open",target(id))).contains("cancel-effect-absent"))
            evidence("native-control-while-node-busy",JSONObject().put("run",run).put("executionId",executionId).put("queryWhileBusy",queryBarrier).put("confirmedStopWhileBusy",stoppedBarrier).put("receipt",stopped).put("delayedFileEffectAbsent",true))
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }

    @Test(timeout=300000) fun pinnedSdkShellConformanceRunsThroughActualTermuxInFourAdoptedLocations(){
        val run=uuid();val wire=Wire(run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run))
        val names=listOf("exec reports the stream of every chunk in both forms","argv exec reports missing programs and empty argv as spawn errors","windowed exec keeps the exact tail and counts what it skips","argv exec distinguishes timeout from abort")
        try{
            wire.ready();ready(page);click(page,"[data-testid=create-conversation]")
            until{wire.call("list").getJSONArray("conversations").length()==1}
            val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            val initial=wire.call("projects.get",target(id));val defaultPath=initial.getJSONArray("workspaces").getJSONObject(0).getString("path")
            fun mutation(method:String,payload:JSONObject):JSONObject{
                val catalog=wire.call("projects.get",target(id))
                return wire.call(method,payload.put("operationId",uuid()).put("expectedVersion",catalog.getLong("version")))
            }
            fun waitForMarker(marker:String){until{val snapshot=wire.call("open",target(id));snapshot.optString("phase")=="done"&&entriesText(snapshot).contains(marker)}}
            send(page,"EXEC_CONFORMANCE_SETUP");waitForMarker("conformance-directories-ready")
            for(index in names.indices){
                val workspaceId="conformance-workspace-$index";val projectId="conformance-project-$index"
                val path="$defaultPath/.durableagent-t09-$run-conformance/$index"
                mutation("workspaces.create",JSONObject().put("id",workspaceId).put("name","SDK case $index").put("path",path))
                mutation("projects.create",JSONObject().put("id",projectId).put("name","SDK case $index").put("workspaceId",workspaceId))
                mutation("projects.select",target(id).put("projectId",projectId))
                val adopted=wire.call("projects.get",target(id)).getJSONObject("selection")
                assertEquals(workspaceId,adopted.getString("workspaceId"));assertEquals("available",adopted.getJSONObject("position").getString("state"))
                // Public association changed outside React; reopen to read the new native draft context.
                page.recreate();ready(page)
                send(page,"EXEC_CONFORMANCE_$index");waitForMarker("SDK-CONFORMANCE-PASS: "+names[index])
                evidence("sdk-shell-conformance-$index",JSONObject().put("run",run).put("caseName",names[index]).put("workspaceId",workspaceId).put("path",path).put("passed",true))
            }
            mutation("projects.select",target(id).put("projectId",JSONObject.NULL))
            page.recreate();ready(page);send(page,"EXEC_CONFORMANCE_CLEANUP");waitForMarker("conformance-directories-removed")
            evidence("sdk-shell-conformance-complete",JSONObject().put("run",run).put("cases",names.size).put("emptyFixtureDirectoriesRemoved",true))
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }

    @Test(timeout=300000) fun realReactSdkAndTermuxSuccessFailureLargeCancelTimeoutAndReconnect(){
        val run=uuid();val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run));var wire=Wire(run)
        try{
            wire.ready();ready(page);click(page,"[data-testid=create-conversation]");until{wire.call("list").getJSONArray("conversations").length()==1};val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            val catalog=wire.call("projects.get",target(id));assertTrue(catalog.getJSONObject("selection").isNull("projectId"));assertEquals("/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace",catalog.getJSONArray("workspaces").getJSONObject(0).getString("path"))
            send(page,"EXEC_SUCCESS");val success=completed(wire,id,1);assertEquals("completed",success.getString("state"));assertEquals(0,success.getInt("exitCode"));assertTrue(entriesText(wire.call("open",target(id))).contains("Termux SDK 世界"));button(page,"查看本会话执行");until{js(page,"document.querySelector('[data-testid=execution-row]')?.dataset.state==='completed'")=="true"}
            send(page,"EXEC_FAILURE");val failure=completed(wire,id,2);assertEquals("completed",failure.getString("state"));assertEquals(7,failure.getInt("exitCode"));assertTrue(entriesText(wire.call("open",target(id))).contains("expected failure"))
            send(page,"EXEC_LARGE");val large=completed(wire,id,3);assertEquals("completed",large.getString("state"));assertEquals(1200000,large.getInt("outputBytes"));assertFalse(large.getBoolean("captureIncomplete"));assertTrue(entriesText(wire.call("open",target(id))).contains(large.getString("outputRef")))
            var cursor=0;var bytes=0;var pages=0;while(cursor<large.getInt("outputCursor")){val output=wire.call("execution.readOutput",target(id).put("executionId",large.getString("executionId")).put("cursor",cursor));assertEquals(cursor,output.getInt("cursor"));val chunks=output.getJSONArray("chunks");var pageBytes=0;for(i in 0 until chunks.length()){val chunk=chunks.getJSONObject(i);assertEquals(++cursor,chunk.getInt("sequence"));pageBytes+=android.util.Base64.decode(chunk.getString("data"),android.util.Base64.DEFAULT).size};assertTrue(pageBytes in 1..16384);assertEquals(cursor,output.getInt("nextCursor"));bytes+=pageBytes;assertTrue(++pages<200)};assertEquals(1200000,bytes)
            send(page,"EXEC_CANCEL");until{val rows=records(wire,id);rows.length()==4&&rows.getJSONObject(3).optString("state")=="running"};button(page,"查看本会话执行");until{js(page,"document.querySelectorAll('[data-testid=execution-row]').length===4")=="true"};button(page,"取消本次执行");val cancelled=completed(wire,id,4);assertEquals("stopped",cancelled.getString("state"));assertTrue(cancelled.getBoolean("scopeConfirmed"))
            send(page,"EXEC_TIMEOUT");val timeout=completed(wire,id,5);assertEquals("stopped",timeout.getString("state"));assertEquals("timeout",timeout.getString("cancelReason"));assertTrue(timeout.getBoolean("scopeConfirmed"))
            send(page,"EXEC_RECONNECT");var reconnectId="";until{val rows=records(wire,id);if(rows.length()<6)return@until false;val row=rows.getJSONObject(5);reconnectId=row.getString("executionId");row.optString("state")=="running"};page.recreate();ready(page);val reconnected=completed(wire,id,6);assertEquals(reconnectId,reconnected.getString("executionId"));assertEquals("completed",reconnected.getString("state"));assertTrue(entriesText(wire.call("open",target(id))).contains("after-reconnect"))
            val history=wire.call("history",target(id)).toString();page.close();wire.closeHost();wire.close();wire=Wire(run);wire.ready();assertEquals(history,wire.call("history",target(id)).toString());assertEquals(6,records(wire,id).length());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            evidence("react-sdk-termux",JSONObject().put("run",run).put("conversationId",id).put("success",success).put("failure",failure).put("large",large).put("cancelled",cancelled).put("timeout",timeout).put("reconnected",reconnected).put("rawPageBytes",bytes).put("rawPages",pages).put("hostReopenNewRequests",0))
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }
}
