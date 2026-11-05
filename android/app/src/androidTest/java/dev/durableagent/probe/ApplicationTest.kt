package dev.durableagent.probe

import android.content.Intent
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

@RunWith(AndroidJUnit4::class)
class ApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun intent(mode:String,run:String)=Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run)
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,android.os.Bundle().apply{putString("applicationEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        var disposed=false
        val connection=UUID.randomUUID().toString()
        val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        val states=LinkedBlockingQueue<JSONObject>()
        val events=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->
            if(what==12)states.offer(JSONObject(text))
            if(what==10){val value=JSONObject(text);if(value.optString("type")=="conversation")events.offer(value) else pending.remove(value.optString("requestId"))?.complete(value)}
        }.apply{connect()}
        fun raw(method:String,payload:JSONObject=JSONObject(),protocol:Int=1):JSONObject {
            val id=UUID.randomUUID().toString();val result=CompletableFuture<JSONObject>();pending[id]=result
            client.post(JSONObject().put("protocol",protocol).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",if(protocol==1)SubmissionTestDriver.payload(context,mode,run,method,payload) else payload).toString())
            return result.get(30,TimeUnit.SECONDS)
        }
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {
            val response=raw(method,payload);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")
        }
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Native state timeout")}
        fun ready():JSONObject {var last=JSONObject();until {last=state();if(last.optString("phase")=="failed")error(last.toString());last.optString("phase")=="ready"};return last}
        fun closeHost(){client.control(20,"close");until {val s=state();s.optString("phase")=="closed"&&!s.optBoolean("domainOwned")&&s.optInt("nativeOwners")==0}}
        override fun close(){disposed=true;client.disconnect()}
    }
    private fun until(timeout:Long=90000,predicate:()->Boolean){val deadline=System.currentTimeMillis()+timeout;while(!predicate()){assertTrue("Application test timed out",System.currentTimeMillis()<deadline);Thread.sleep(25)}}
    private fun payload(id:String)=JSONObject().put("id",id)
    private fun cleanup(wire:Wire){val active=if(wire.disposed)Wire("fixture",wire.run) else wire;try{active.closeHost()}catch(error:Throwable){evidence("cleanup-failure",JSONObject().put("error",error.toString()))}finally{active.close()}}
    private fun js(scenario:ActivityScenario<AgentActivity>,script:String):String {
        val value=CompletableFuture<String>();scenario.onActivity{activity->activity.webView?.evaluateJavascript(script){value.complete(it)}?:value.complete("null")};return value.get(10,TimeUnit.SECONDS)
    }
    private fun domReady(scenario:ActivityScenario<AgentActivity>){until{js(scenario,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}}
    private fun sendDom(scenario:ActivityScenario<AgentActivity>,text:String){
        until{js(scenario,"document.querySelector('[data-testid=message-input]')?.disabled===false && document.querySelector('[data-testid=create-conversation]')?.disabled===false && document.querySelector('[data-testid=conversation-status]')?.dataset.phase==='idle'")=="true"}
        js(scenario,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")
        until{js(scenario,"document.querySelector('[data-testid=send-message]')?.disabled===false")=="true"}
        js(scenario,"document.querySelector('[data-testid=send-message]').click()")
        until{js(scenario,"document.querySelector('[data-testid=conversation-status]')?.dataset.phase==='done'")=="true"}
    }
    @Test(timeout=180000) fun realReactTwoConversationsReconnectAndNativeReopen() {
        val run=UUID.randomUUID().toString();var scenario=ActivityScenario.launch<AgentActivity>(intent("fixture",run));var wire=Wire("fixture",run)
        try {
            val firstHost=wire.ready();domReady(scenario)
            js(scenario,"document.querySelector('[data-testid=create-conversation]').click()")
            until{js(scenario,"!!document.querySelector('[data-testid=message-input]')")=="true"};sendDom(scenario,"第一段独立输入")
            val first=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            js(scenario,"document.querySelector('[data-testid=create-conversation]').click()")
            until{wire.call("list").getJSONArray("conversations").length()==2};sendDom(scenario,"第二段独立输入")
            val items=wire.call("list").getJSONArray("conversations");val second=(0 until items.length()).map{items.getJSONObject(it).getString("id")}.first{it!=first}
            val a=wire.call("history",payload(first));val b=wire.call("history",payload(second))
            assertEquals(2,a.getJSONArray("items").length());assertEquals("第一段独立输入",a.getJSONArray("items").getJSONObject(0).getString("text"))
            assertEquals(2,b.getJSONArray("items").length());assertEquals("第二段独立输入",b.getJSONArray("items").getJSONObject(0).getString("text"))
            assertEquals("PROTOCOL_MISMATCH",wire.raw("send",payload(first),99).getJSONObject("error").getString("code"))
            // Release the observer binding: the UI is now the only client during recreation.
            wire.close();scenario.recreate();domReady(scenario)
            until{js(scenario,"document.querySelectorAll('[data-testid=history-message]').length===2")=="true"}
            wire=Wire("fixture",run);assertEquals(firstHost.getString("instance"),wire.ready().getString("instance"))
            assertEquals(2,wire.state().getJSONObject("metrics").getInt("modelRequests"))
            scenario.close();wire.closeHost();wire.close();wire=Wire("fixture",run);val reopened=wire.ready()
            assertNotEquals(firstHost.getString("instance"),reopened.getString("instance"))
            assertEquals(a.toString(),wire.call("history",payload(first)).toString());assertEquals(b.toString(),wire.call("history",payload(second)).toString())
            assertEquals(0,reopened.getJSONObject("metrics").optInt("modelRequests"))
            evidence("react-two-conversations",JSONObject().put("before",firstHost).put("reopened",reopened).put("first",a).put("second",b))
        }finally{scenario.close();cleanup(wire)}
    }
    @Test(timeout=120000) fun explicitStopAndDetachedUiPreserveInput() {
        val run=UUID.randomUUID().toString();val scenario=ActivityScenario.launch<AgentActivity>(intent("hang",run));val wire=Wire("hang",run)
        try {
            wire.ready();val id=wire.call("create",JSONObject().put("creationId","hang")).getJSONObject("conversation").getString("id")
            wire.call("subscribe",payload(id).put("subscriptionId","observer"));wire.call("send",payload(id).put("text","保留输入并停止").put("actionId","input"))
            until{wire.state().getJSONObject("metrics").optInt("modelRequests")==1}
            scenario.close();wire.call("unsubscribe",JSONObject().put("subscriptionId","observer"))
            assertEquals("running",wire.call("open",payload(id)).getString("phase"))
            assertEquals("INVALID_ARGUMENT",wire.raw("stop",payload(id)).getJSONObject("error").getString("code"))
            assertEquals("running",wire.call("open",payload(id)).getString("phase"))
            wire.call("stop",payload(id).put("actionId","stop"));val stopped=wire.call("open",payload(id));assertEquals("stopped",stopped.getString("phase"));assertEquals(1,stopped.getJSONArray("entries").length())
            evidence("stop-detached-ui",stopped)
        }finally{scenario.close();cleanup(wire)}
    }
    @Test(timeout=180000) fun realMimoProductConversationsPersistWithoutReplay() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        val run=UUID.randomUUID().toString();val scenario=ActivityScenario.launch<AgentActivity>(intent("real",run));var wire=Wire("real",run)
        try {
            wire.ready();val histories=mutableMapOf<String,String>()
            for(id in listOf("real-a","real-b")){
                wire.call("create",JSONObject().put("creationId",id).put("title","真实模型会话 $id"))
                wire.call("send",payload(id).put("text","请只回复一句简短中文问候，包含编号 $id。").put("actionId","input-$id"))
                until{val s=wire.call("open",payload(id));if(s.getString("phase")=="failed")error(s.toString());s.getString("phase")=="done"}
                val history=wire.call("history",payload(id));assertEquals(2,history.getJSONArray("items").length());histories[id]=history.toString()
            }
            val before=wire.state();assertEquals(2,before.getJSONObject("metrics").getInt("transportRequests"))
            scenario.close();wire.closeHost();wire.close();wire=Wire("fixture",run);val after=wire.ready()
            for((id,history)in histories)assertEquals(history,wire.call("history",payload(id)).toString())
            assertEquals(0,after.getJSONObject("metrics").optInt("modelRequests"));assertEquals(2,wire.call("list").getJSONArray("conversations").length())
            evidence("real-mimo-two-conversations",JSONObject().put("before",before).put("reopened",after).put("histories",JSONObject(histories)))
        }finally{scenario.close();cleanup(wire)}
    }
    @Test(timeout=180000) fun largeTextCrossesBinderFragmentsAndReactWithoutTruncation() {
        val run=UUID.randomUUID().toString();val scenario=ActivityScenario.launch<AgentActivity>(intent("fixture",run));val wire=Wire("fixture",run)
        val text="长文本🌍".repeat(18000)
        try {
            wire.ready();domReady(scenario);js(scenario,"document.querySelector('[data-testid=create-conversation]').click()")
            until{js(scenario,"!!document.querySelector('[data-testid=message-input]')")=="true"};sendDom(scenario,text)
            val id=wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
            val escaped="\u0001".repeat(90000)
            for(i in 1..5){wire.call("send",payload(id).put("text",if(i==1)escaped else text+i).put("actionId","large-$i"));until{wire.call("open",payload(id)).getString("phase")=="done"}}
            val history=wire.call("history",payload(id));assertEquals(text,history.getJSONArray("items").getJSONObject(0).getString("text"))
            assertEquals(escaped,history.getJSONArray("items").getJSONObject(2).getString("text"))
            val expected=listOf(text,escaped,text+2,text+3,text+4,text+5)
            assertEquals(expected,(0 until history.getJSONArray("items").length()).map{history.getJSONArray("items").getJSONObject(it)}.filter{it.getString("role")=="user"}.map{it.getString("text")})
            assertEquals(12,history.getJSONArray("items").length());assertTrue(history.toString().length*2>1024*1024)
            until{js(scenario,"document.querySelectorAll('[data-testid=history-message]').length===12")=="true"}
            assertEquals("true",js(scenario,"document.querySelector('[data-testid=history-message] [data-testid=toggle-long-message]')?.getAttribute('aria-expanded')==='false'"))
            js(scenario,"document.querySelector('[data-testid=history-message] [data-testid=toggle-long-message]').click()")
            until{js(scenario,"document.querySelector('[data-testid=history-message] [data-testid=toggle-long-message]')?.getAttribute('aria-expanded')==='true'")=="true"}
            assertEquals("true",js(scenario,"document.querySelector('[data-testid=history-message] [data-testid=message-text]')?.textContent===${JSONObject.quote(text)}"))
            scenario.recreate();domReady(scenario);until{js(scenario,"document.querySelectorAll('[data-testid=history-message]').length===12")=="true"}
            assertEquals("true",js(scenario,"document.querySelector('[data-testid=history-message] [data-testid=toggle-long-message]')?.getAttribute('aria-expanded')==='false'"))
            assertEquals(history.toString(),wire.call("history",payload(id)).toString());assertEquals(6,wire.state().getJSONObject("metrics").getInt("modelRequests"))
            evidence("large-react-ipc",JSONObject().put("charactersPerInput",text.length).put("historyUtf16Bytes",history.toString().length*2).put("historyCount",history.getJSONArray("items").length()).put("exactText",true))
        }finally{scenario.close();cleanup(wire)}
    }
}
