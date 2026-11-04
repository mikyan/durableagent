package dev.durableagent.probe

import android.app.Notification
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

/** Actual Android owner/SQLite/SDK/NotificationManager. Controlled model transport only. */
@RunWith(AndroidJUnit4::class)
class RecoveryApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val notifications=context.getSystemService(NotificationManager::class.java)
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(25)}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        private val responses=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->if(what==10){val value=JSONObject(text);responses.remove(value.optString("requestId"))?.complete(value)}else if(what==12)states.offer(JSONObject(text))}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {val key=id();val future=CompletableFuture<JSONObject>();responses[key]=future;client.post(JSONObject().put("protocol",1).put("connectionId","recovery-validation").put("requestId",key).put("method",method).put("payload",payload).toString());val response=future.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(90,TimeUnit.SECONDS)?:error("Recovery owner status timed out")}
        fun ready(){until("Recovery owner ready"){val value=state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready"}}
        fun stopHost(){client.control(20,"close");until("Recovery owner closes"){state().optString("phase")=="closed"}}
        override fun close(){client.disconnect()}
    }
    private fun send(wire:Wire,store:NativeInputStore,product:String):JSONObject {
        wire.call("create",JSONObject().put("creationId",product))
        val expectation=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
        val saved=store.save(product,0,id(),"one durable recovery validation input",emptyList());val fixed=store.freeze(product,saved.getLong("revision"),id())
        val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",expectation).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
        wire.call("send",JSONObject().put("intentId",intent.getString("intentId")));return intent
    }
    @Test(timeout=240000) fun ongoingNotificationRetainsNativeStopAfterUiLeaves(){
        val mode="recovery-hang";val run=id();val product="recovery-${id()}";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run)
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->
            try{
                wire.ready();send(wire,store,product)
                until("An actual foreground notification accompanies SDK work"){notifications.activeNotifications.any{it.id==18012&&(it.notification.flags and Notification.FLAG_FOREGROUND_SERVICE)!=0}}
                val notification=notifications.activeNotifications.single{it.id==18012}
                assertNotNull(notification.notification.contentIntent);assertTrue(notification.notification.actions.isNotEmpty())
                page.close();notification.notification.actions.first().actionIntent.send()
                until("Native notification stop settles same SDK input"){wire.call("open",JSONObject().put("id",product)).getString("phase")=="stopped"}
                until("Running foreground notification exits"){notifications.activeNotifications.none{it.id==18012}}
                assertTrue(store.readControl(product).getLong("stoppedThrough")>=1)
                instrumentation.sendStatus(0,Bundle().apply{putString("recoveryEvidence",wire.state().toString())})
            }finally{page.close();wire.stopHost();wire.close()}
        }
    }
    @Test(timeout=240000) fun completedInputNotificationKeepsOneStablePostAcrossOwnerReopen(){
        val mode="recovery-fixture";val run=id();val product="completion-${id()}";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));var wire=Wire(mode,run)
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->
            try{
                assertEquals("Fixture requires actual Android notification permission and channels", "visible",NativeRecoveryNotifications.visibility(context))
                wire.ready();val original=send(wire,store,product)
                val prefix=NativeInputBridge.namespace(mode,run)+":answer:"
                until("Durable completion creates Android notification"){notifications.activeNotifications.any{it.id==18013&&it.tag?.startsWith(prefix)==true}}
                val before=notifications.activeNotifications.single{it.id==18013&&it.tag?.startsWith(prefix)==true}
                val first=wire.call("sendStatus",JSONObject().put("intentId",original.getString("intentId"))).getJSONObject("receipt")
                wire.stopHost();wire.close();wire=Wire(mode,run);wire.ready()
                val after=notifications.activeNotifications.single{it.id==18013&&it.tag==before.tag}
                assertEquals(before.postTime,after.postTime)
                assertEquals(first.toString(),wire.call("sendStatus",JSONObject().put("intentId",original.getString("intentId"))).getJSONObject("receipt").toString())
                assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
                instrumentation.sendStatus(0,Bundle().apply{putString("recoveryEvidence",JSONObject().put("tag",before.tag).put("postTime",after.postTime).put("state",wire.state()).toString())})
            }finally{page.close();wire.stopHost();wire.close()}
        }
    }
    @Test(timeout=180000) fun completedInputStaysVisibleWhenAndroidNotificationDeliveryIsRestricted(){
        val expected=InstrumentationRegistry.getArguments().getString("notificationVisibility")
        assumeTrue(expected in setOf("permission-denied","channel-disabled"))
        assertEquals(expected,NativeRecoveryNotifications.visibility(context))
        if(expected=="channel-disabled")assertEquals(NotificationManager.IMPORTANCE_NONE,notifications.getNotificationChannel(NativeRecoveryNotifications.COMPLETION_CHANNEL).importance)
        val mode="recovery-fixture";val run=id();val product="restricted-${id()}";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run)
        NativeInputStore(context,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->NativeRecoveryStore(context,NativeInputBridge.namespace(mode,run)).use{recovery->
            try{
                wire.ready();val original=send(wire,store,product)
                until("A denied notification does not cancel the SDK result"){wire.call("sendStatus",JSONObject().put("intentId",original.getString("intentId"))).optJSONObject("submission")?.optString("status")=="done"}
                var completion=JSONObject();until("Native durable completion retained without a posting attempt"){
                    try{val values=recovery.readProjection().getJSONArray("completions");if(values.length()==0)false else{completion=values.getJSONObject(0);true}}catch(error:IllegalStateException){if(error.message=="RECOVERY_STORAGE_BUSY")false else throw error}
                }
                assertEquals("pending",recovery.pendingCompletion(completion.getString("identity"),product).getString("state"))
                val tag=NativeInputBridge.namespace(mode,run)+":"+completion.getString("identity");assertTrue(notifications.activeNotifications.none{it.id==18013&&it.tag==tag})
                val history=wire.call("history",JSONObject().put("id",product)).getJSONArray("items");assertTrue((0 until history.length()).any{history.getJSONObject(it).optString("role")=="assistant"&&history.getJSONObject(it).optString("text").isNotEmpty()})
                assertEquals(expected,NativeRecoveryNotifications.visibility(context))
                instrumentation.sendStatus(0,Bundle().apply{putString("restrictedNotificationEvidence",JSONObject().put("visibility",expected).put("run",run).put("product",product).put("completion",completion).put("sdkDone",true).put("systemCompletionPosted",false).toString())})
            }finally{page.close();wire.stopHost();wire.close()}
        }}
    }
}
