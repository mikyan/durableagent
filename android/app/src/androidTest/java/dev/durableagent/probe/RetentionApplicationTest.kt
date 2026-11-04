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

/** Actual APK runtime, Pi SDK and SQLite. Model protocol is controlled; no real key is provisioned. */
@RunWith(AndroidJUnit4::class)
class RetentionApplicationTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private fun until(timeout:Long=90000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!check()){assertTrue("Retention host timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(40)}}
    private inner class Wire(run:String):AutoCloseable {
        private val connection=UUID.randomUUID().toString()
        private val states=LinkedBlockingQueue<JSONObject>()
        private val requests=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        val client=ApplicationClient(context,"fixture",run){what,text->if(what==12)states.offer(JSONObject(text)) else if(what==10){val value=JSONObject(text);requests.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(15,TimeUnit.SECONDS)?:error("Retention host status timeout")}
        fun response(method:String,payload:JSONObject=JSONObject()):JSONObject {
            val id=UUID.randomUUID().toString();val promise=CompletableFuture<JSONObject>();requests[id]=promise
            client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString())
            return promise.get(30,TimeUnit.SECONDS)
        }
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val value=response(method,payload);assertTrue(value.toString(),value.getBoolean("ok"));return value.getJSONObject("value")}
        fun closeHost(){client.control(20,"close");until(20000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    @Test(timeout=240000) fun incompatibleRecordReopensThroughNativeBridgeAsReadOnlyHistory() {
        val run=UUID.randomUUID().toString();var page:ActivityScenario<AgentActivity>?=ActivityScenario.launch(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run))
        var wire=Wire(run);val id="retained-native-chat";val text="Original retained native history 北京🌍"
        val store=NativeInputStore(context,NativeInputBridge.namespace("fixture",run))
        try {
            until{val value=wire.state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready"}
            wire.call("create",JSONObject().put("creationId",id).put("title","Retained native history"))
            val draft=store.save(id,0,"save",text,emptyList());val frozen=store.freeze(id,draft.getLong("revision"),"freeze")
            val intent=store.createSend(JSONObject().put("id",id).put("actionId","send-once").put("inputToken",frozen.getString("token")).put("expectedContext",store.inspect(id).getJSONObject("submissionContext")).put("expectedControlVersion",0).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))
            until{wire.call("open",JSONObject().put("id",id)).optString("phase")=="done"}
            val prior=wire.call("history",JSONObject().put("id",id)).getJSONArray("items");assertEquals(2,prior.length());assertEquals(text,prior.getJSONObject(0).getString("text"))
            wire.client.control(54)
            var seeded=JSONObject();val seedDeadline=SystemClock.elapsedRealtime()+30000
            do {seeded=wire.state();val value=seeded.getJSONObject("metrics");if(value.optString("retentionFutureState")=="failed")error(seeded.toString());assertTrue("Future-record fixture did not finish: $seeded",SystemClock.elapsedRealtime()<seedDeadline);Thread.sleep(40)}while(seeded.getJSONObject("metrics").optString("retentionFutureState")!="seeded")
            wire.closeHost();wire.close();page!!.recreate();wire=Wire(run)
            var reopened=JSONObject();val reopenDeadline=SystemClock.elapsedRealtime()+30000
            do {reopened=wire.state();assertTrue("Native reopen did not reach a terminal startup state: $reopened",SystemClock.elapsedRealtime()<reopenDeadline);Thread.sleep(40)}while(reopened.optString("phase") !in listOf("failed","ready"))
            assertTrue("Native bridge must keep compatible retained history accessible: $reopened",reopened.optBoolean("readOnly"))
            assertTrue(reopened.getBoolean("domainOwned"));assertEquals(0,reopened.getJSONObject("metrics").optInt("modelRequests"))
            assertEquals("Retained native history",wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("title"))
            val restored=wire.call("history",JSONObject().put("id",id)).getJSONArray("items");assertEquals(prior.toString(),restored.toString())
            assertFalse(wire.response("send",JSONObject().put("intentId",intent.getString("intentId"))).getBoolean("ok"))
            assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            assertEquals(frozen.getString("digest"),store.readFrozen(frozen.getString("token")).getString("digest"))
            instrument.sendStatus(0,Bundle().apply{putString("retentionEvidence",JSONObject().put("case","native-readonly-reopen").put("state",reopened).put("history",restored).put("newModelRequests",0).toString())})
        }finally{page?.close();store.close();try{wire.closeHost()}finally{wire.close()}}
    }
    @Test(timeout=240000) fun actualAndroidSdkRetentionMigrationCapacityAndReadOnlyPolicy() {
        val instrument=InstrumentationRegistry.getInstrumentation();val context=instrument.targetContext;val run=UUID.randomUUID().toString()
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run))
        val states=LinkedBlockingQueue<JSONObject>();val client=ApplicationClient(context,"fixture",run){what,text->if(what==12)states.offer(JSONObject(text))}.apply{connect()}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(15,TimeUnit.SECONDS)?:error("Retention host status timeout")}
        fun until(timeout:Long=150000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!check()){assertTrue("Retention policy timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(40)}}
        try {
            until { val value=state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready" }
            client.control(53);var result=JSONObject()
            until {result=state();val policy=result.getJSONObject("metrics").optString("retentionPolicyState");if(policy=="failed")error(result.toString());policy=="passed"}
            val checks=result.getJSONObject("metrics").getJSONArray("retentionPolicyCases");assertEquals(7,checks.length());for(index in 0 until checks.length())assertTrue(checks.getJSONObject(index).getBoolean("passed"))
            instrument.sendStatus(0,Bundle().apply{putString("retentionEvidence",result.put("build",android.os.Build.FINGERPRINT).toString())})
        }finally{
            page.close();try{client.control(20,"close");until(20000){val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}finally{client.disconnect()}
        }
    }
}
