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

/** Public React/native intent/SDK file Interface against the separately owned actual Termux UID. */
@RunWith(AndroidJUnit4::class)
class FileApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun uuid()=UUID.randomUUID().toString()
    private fun target(id:String)=JSONObject().put("id",id)
    private fun until(timeout:Long=120000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Public file contract did not settle",SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("fileEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private inner class Wire(val run:String):AutoCloseable {
        private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        private val connection=uuid()
        val client=ApplicationClient(context,"execution",run){what,text->if(what==12)states.offer(JSONObject(text));if(what==10){val value=JSONObject(text);pending.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {val id=uuid();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val result=future.get(35,TimeUnit.SECONDS);check(result.getBoolean("ok")){result.toString()};return result.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("File host status timeout")}
        fun ready(){until{val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}}
        fun closeHost(){client.control(20,"close");until(15000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,code:String):String{val future=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(code){value->future.complete(value)}?:future.complete("null")};return future.get(10,TimeUnit.SECONDS)}
    private fun ready(page:ActivityScenario<AgentActivity>){until{js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until{js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun button(page:ActivityScenario<AgentActivity>,text:String){until{js(page,"(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSONObject.quote(text)});if(!b||b.disabled)return false;b.click();return true})()")=="true"}}
    private fun send(page:ActivityScenario<AgentActivity>,text:String,wire:Wire,id:String){
        until{js(page,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"}
        js(page,"window.__fileSendTrace={clicks:0,submits:0,replies:[]};if(!window.__fileSendObserver){window.__fileSendObserver=true;document.addEventListener('click',e=>{if(e.target.closest('[data-testid=send-message]'))window.__fileSendTrace.clicks++},true);document.addEventListener('submit',()=>window.__fileSendTrace.submits++,true);const receive=window.__durableReceive;window.__durableReceive=value=>{if(value.type==='response'&&window.__fileSendTrace.replies.length<80)window.__fileSendTrace.replies.push({ok:value.ok,code:value.error?.code,revision:value.value?.revision,frozen:typeof value.value?.token==='string',intent:typeof value.value?.intentId==='string'});receive(value)}}")
        js(page,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")
        until{js(page,"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'")=="true"}
        val before=wire.call("sendList",target(id)).getJSONArray("items").length();click(page,"[data-testid=send-message]")
        try{until(10000){wire.call("sendList",target(id)).getJSONArray("items").length()>before}}
        catch(error:Throwable){val trace=js(page,"JSON.stringify({trace:window.__fileSendTrace,draftState:document.querySelector('[data-testid=draft-status]')?.dataset.state,textarea:document.querySelector('[data-testid=message-input]')?.value,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})");val draft=NativeInputStore(context,NativeInputBridge.namespace("execution",wire.run)).use{it.inspect(id)};evidence("send-not-admitted",JSONObject().put("run",wire.run).put("input",text).put("draft",draft).put("uiTraceJson",trace));throw error}
    }
    private fun texts(value:JSONObject):String {val rows=value.getJSONArray("entries");return (0 until rows.length()).joinToString("\n"){rows.getJSONObject(it).optString("text","")}}
    private fun latestUser(value:JSONObject):String {val rows=value.getJSONArray("entries");for(i in rows.length()-1 downTo 0){val row=rows.getJSONObject(i);if(row.optString("role")=="user")return row.optString("text","")};return ""}
    private fun marker(wire:Wire,id:String,prefix:String):JSONObject {var result=JSONObject();val expected=if(prefix=="FILE-ROUNDTRIP-PASS:")"FILE_ROUNDTRIP" else "FILE_DEPENDENCY";until{val value=wire.call("open",target(id));if(value.optString("phase")!="done"||latestUser(value)!=expected)return@until false;val rows=value.getJSONArray("entries");for(i in rows.length()-1 downTo 0){val text=rows.getJSONObject(i).optString("text","");if(text.startsWith(prefix)){result=JSONObject(text.removePrefix(prefix));return@until true}};error("Completed file tool has no success marker: "+texts(value))};return result}

    @Test(timeout=420000) fun originalFilesRoundtripAndPinnedSdkContractsThroughActualTermux(){
        val run=uuid();var wire=Wire(run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run))
        try{
            wire.ready();ready(page);click(page,"[data-testid=create-conversation]")
            until{wire.call("list").getJSONArray("conversations").length()==1};val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            val catalog=wire.call("projects.get",target(id));val defaultPath=catalog.getJSONArray("workspaces").getJSONObject(0).getString("path")
            assertTrue(catalog.getJSONObject("selection").isNull("projectId"))
            if(InstrumentationRegistry.getArguments().getString("fileContractsOnly")!="true"){
            send(page,"FILE_ROUNDTRIP",wire,id);val roundtrip=marker(wire,id,"FILE-ROUNDTRIP-PASS:")
            assertEquals(11,roundtrip.getInt("finalBytes"));assertEquals("polling",roundtrip.getString("watchMode"));assertTrue(roundtrip.getString("canonical").startsWith("$defaultPath/.durableagent-t10-$run/"))
            val changes=wire.call("files.list",target(id)).getJSONArray("changes");assertTrue(changes.length()>=8)
            var realDiff=false;for(i in 0 until changes.length()){val row=changes.getJSONObject(i);assertTrue(row.getBoolean("original"));assertTrue(row.getBoolean("scopeConfirmed"));assertEquals("completed",row.getString("state"));if(row.getJSONObject("diff").optString("text").contains("+真实修改-after"))realDiff=true};assertTrue(realDiff)
            click(page,"button[aria-label=会话详情]");button(page,"文件变更与执行");button(page,"查看文件变更");until{js(page,"document.querySelector('.file-changes')?.textContent.includes('+真实修改-after')")=="true"}
            evidence("original-roundtrip",JSONObject().put("run",run).put("conversationId",id).put("result",roundtrip).put("changes",changes).put("uiActualDiff",true))
            send(page,"FILE_DEPENDENCY",wire,id);val dependency=marker(wire,id,"FILE-DEPENDENCY-PASS:");evidence("independent-dependency-artifact",dependency)
            }
            send(page,"EXEC_CONFORMANCE_SETUP",wire,id);until{val value=wire.call("open",target(id));value.optString("phase")=="done"&&texts(value).contains("conformance-directories-ready")}
            val names=listOf("binary reader reads byte ranges of the opened file","binary reader scans lines like decoding the whole file","binary reader keeps reading the file it opened after a rename","directory reader refuses missing paths and files")
            fun mutate(method:String,payload:JSONObject):JSONObject{val current=wire.call("projects.get",target(id));return wire.call(method,payload.put("operationId",uuid()).put("expectedVersion",current.getLong("version")))}
            val firstCase=(InstrumentationRegistry.getArguments().getString("fileContractStart")?:"0").toInt();require(firstCase in names.indices)
            for(index in firstCase until names.size){
                val workspaceId="file-workspace-$index";val projectId="file-project-$index";val path="$defaultPath/.durableagent-t09-$run-conformance/$index"
                mutate("workspaces.create",JSONObject().put("id",workspaceId).put("name","File case $index").put("path",path));mutate("projects.create",JSONObject().put("id",projectId).put("name","File case $index").put("workspaceId",workspaceId));mutate("projects.select",target(id).put("projectId",projectId));page.recreate();ready(page)
                send(page,"FILE_CONFORMANCE_$index",wire,id);until{val value=wire.call("open",target(id));if(value.optString("phase")!="done"||latestUser(value)!="FILE_CONFORMANCE_$index")false else{assertTrue(texts(value),texts(value).contains("SDK-CONFORMANCE-PASS: "+names[index]));true}}
                evidence("pinned-file-contract-$index",JSONObject().put("run",run).put("name",names[index]).put("path",path).put("passed",true))
            }
            val history=wire.call("history",target(id)).toString();page.close();wire.closeHost();wire.close();wire=Wire(run);wire.ready();assertEquals(history,wire.call("history",target(id)).toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            evidence("file-host-reopen",JSONObject().put("run",run).put("newModelRequests",0).put("fixtureFilesRetained",true))
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }
}
