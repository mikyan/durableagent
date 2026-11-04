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
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real rendered reconnect button and OS domain lock; no input is submitted. */
@RunWith(AndroidJUnit4::class)
class HostReconnectApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=20000,test:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!test()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(40)}}
    private inner class Wire(run:String):AutoCloseable {
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,"fixture",run){what,text->if(what==10){val value=JSONObject(text);replies.remove(value.optString("requestId"))?.complete(value)}else if(what==12)states.offer(JSONObject(text))}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val key=id();val future=CompletableFuture<JSONObject>();replies[key]=future;client.post(JSONObject().put("protocol",1).put("connectionId","reconnect-observer").put("requestId",key).put("method",method).put("payload",payload).toString());val result=future.get(15,TimeUnit.SECONDS);assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(5,TimeUnit.SECONDS)?:error("Native status timeout")}
        fun closeHost(){client.control(20,"close");until("Fixture host closes"){state().optString("phase")=="closed"}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,source:String):String{val value=CompletableFuture<String>();page.onActivity{it.webView!!.evaluateJavascript(source,value::complete)};return value.get(5,TimeUnit.SECONDS)}
    private fun clickReconnect(page:ActivityScenario<AgentActivity>){assertEquals("true",js(page,"(()=>{const b=[...document.querySelectorAll('.connection-notice button')].find(b=>b.textContent==='重新连接'&&b.getClientRects().length);if(!b)return false;b.click();return true})()"))}
    @Test(timeout=120000) fun renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend(){
        val run=id();val product="retained-conversation";val domain=File(context.filesDir,"application-validation/$run");val wire=Wire(run)
        var page:ActivityScenario<AgentActivity>?=null;var held:StorageDomainLease?=null
        NativeInputStore(context,"input-$run").withLeaseWait(1000).use{store->try{
            until("Initial fixture owner ready"){wire.state().optString("phase")=="ready"}
            val created=wire.call("create",JSONObject().put("creationId",product).put("title","保留的会话"))
            val before=wire.call("open",JSONObject().put("id",product));val sdkId=before.getJSONObject("conversation").getJSONObject("submissionContext").getLong("sdkConversationId")
            val draft=store.save(product,0,id(),"重连后仍保留的草稿",emptyList());wire.closeHost()
            val database=File(domain,"application.sqlite");val beforeBytes=database.readBytes()
            held=StorageDomainLease.acquire(domain)?:error("Fixture could not acquire the actual owner lease")
            page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run))
            until("Rendered page reports actual domain ownership failure"){js(page!!,"document.querySelector('.connection-notice')?.textContent.includes('Application storage already owned')")=="true"}
            val failure=wire.state();assertEquals("failed",failure.getString("phase"));assertFalse(failure.getBoolean("domainOwned"));assertEquals(0,failure.getInt("nativeOwners"))
            clickReconnect(page!!);Thread.sleep(350);assertEquals("failed",wire.state().getString("phase"));assertNull("Reconnect cannot replace the actor holding the domain",StorageDomainLease.acquire(domain));assertArrayEquals(beforeBytes,database.readBytes())
            held!!.close();held=null
            clickReconnect(page!!)
            until("Rendered reconnect must reopen the native owner after the OS lease is released",10000){js(page!!,"!!document.querySelector('.nav-foot .ready')")=="true"}
            val ready=wire.state();assertEquals("ready",ready.getString("phase"));assertTrue(ready.getBoolean("domainOwned"));assertEquals(1,ready.getInt("nativeOwners"));assertEquals(0,ready.getJSONObject("metrics").optInt("modelRequests"))
            val after=wire.call("open",JSONObject().put("id",product));assertEquals(sdkId,after.getJSONObject("conversation").getJSONObject("submissionContext").getLong("sdkConversationId"));assertEquals(1,wire.call("list").getJSONArray("conversations").length());assertEquals(0,wire.call("history",JSONObject().put("id",product)).getJSONArray("items").length())
            assertEquals(draft.getLong("revision"),store.read(product).getLong("revision"));assertEquals("重连后仍保留的草稿",store.read(product).getString("text"));assertEquals(0,store.listSends().getJSONArray("intents").length())
            // A healthy reconnect uses the same native owner, including its lease.
            js(page!!,"document.querySelector('[aria-label=\"打开会话列表\"]').click()")
            assertEquals("true",js(page!!,"(()=>{const b=[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='设置'&&b.getClientRects().length);if(!b)return false;b.click();return true})()"))
            until("Settings reconnect is rendered"){js(page!!,"!!document.querySelector('[data-testid=preferences-page]')")=="true"}
            assertEquals("true",js(page!!,"(()=>{const b=[...document.querySelectorAll('[data-testid=preferences-page] button')].find(b=>b.textContent==='重新连接');if(!b)return false;b.click();return true})()"))
            until("Healthy reconnect stays ready"){js(page!!,"document.querySelector('[data-testid=preferences-page]')?.textContent.includes('运行宿主已连接。')")=="true"}
            val same=wire.state();assertEquals(ready.getString("instance"),same.getString("instance"));assertEquals(ready.getInt("pid"),same.getInt("pid"));assertEquals(1,same.getInt("nativeOwners"))
            instrumentation.sendStatus(0,Bundle().apply{putString("hostReconnectEvidence",JSONObject().put("run",run).put("sdkId",sdkId).put("failed",failure).put("reopened",ready).put("sameOwnerAfterHealthyReconnect",true).put("draftRetained",true).put("sends",0).put("modelRequests",0).toString())})
        }finally{held?.close();page?.close();try{wire.closeHost()}finally{wire.close()}}}
    }
}
