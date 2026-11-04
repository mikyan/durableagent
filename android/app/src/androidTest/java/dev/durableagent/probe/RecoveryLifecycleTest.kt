package dev.durableagent.probe

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.os.UserManager
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

/** Root drives real networking/reboot/keyguard/force-stop between these explicit stages.
 * No synthetic broadcasts, credential imports, default changes or new work during observation. */
@RunWith(AndroidJUnit4::class)
class RecoveryLifecycleTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val arguments=InstrumentationRegistry.getArguments()
    private fun id()=UUID.randomUUID().toString()
    private fun run():String=(arguments.getString("lifecycleRun")?:error("Root must supply a unique lifecycleRun")).also{require(it.matches(Regex("[a-zA-Z0-9-]{1,80}")))}
    private fun product(run:String)="lifecycle-$run"
    private fun prompt(run:String)="这是恢复验证。只回复 T12-LIFECYCLE-$run，不调用工具。"
    private fun until(label:String,timeout:Long=120000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    @Suppress("DEPRECATION") private fun service()=context.getSystemService(ActivityManager::class.java).getRunningServices(Int.MAX_VALUE).find{it.service.className==ApplicationService::class.java.name}
    private inner class Wire:AutoCloseable {
        private val connection=id();private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val states=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,"product",null){what,text->if(what==10){val value=JSONObject(text);replies.remove(value.optString("requestId"))?.complete(value)}else if(what==12)states.offer(JSONObject(text))}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val key=id();val future=CompletableFuture<JSONObject>();replies[key]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",key).put("method",method).put("payload",payload).toString());val response=future.get(35,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Product lifecycle state unavailable")}
        fun ready(){until("Product owner ready"){val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}}
        override fun close(){client.disconnect()}
    }
    @Test(timeout=180000) fun prepareOneOfflineProductInputAndLeaveAllClients(){
        assumeTrue(arguments.getString("realProvider")=="true")
        val run=run();val product=product(run);val connection=arguments.getString("productConnection")?:error("Existing product connection required")
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java));val wire=Wire();var created=false;var success=false
        NativeInputStore(context,"input-v1").withLeaseWait(1000).use{store->try{
            wire.ready();val before=wire.state();assertEquals("Root must disable actual connectivity before preparing", "offline",before.getJSONObject("recovery").getString("network"))
            val products=wire.call("list").getJSONArray("conversations");assertTrue("No other product work may be active",(0 until products.length()).none{products.getJSONObject(it).optString("phase") in setOf("running","waiting")});assertTrue("Never resend an existing lifecycle run",(0 until products.length()).none{products.getJSONObject(it).getString("id")==product})
            val connections=wire.call("models.get").getJSONArray("connections");val selected=(0 until connections.length()).map{connections.getJSONObject(it)}.single{it.getString("id")==connection};assertEquals("mimo-cn",selected.getString("protocol"));assertTrue(selected.getBoolean("enabled"));assertTrue(selected.getJSONObject("credential").getBoolean("configured"))
            wire.call("create",JSONObject().put("creationId",product));created=true;wire.call("models.select",JSONObject().put("id",product).put("selection",JSONObject().put("provider",connection).put("modelId","mimo-v2.6-flash")))
            val expected=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
            val saved=store.save(product,0,id(),prompt(run),emptyList());val fixed=store.freeze(product,saved.getLong("revision"),id())
            val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",expected).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))
            var waiting=JSONObject();until("The same accepted input visibly waits for actual network"){waiting=wire.call("open",JSONObject().put("id",product));waiting.optJSONObject("recovery")?.optString("reason")=="network-offline"}
            val status=wire.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId")));assertTrue(status.has("receipt"));val after=wire.state();assertEquals(before.getJSONObject("metrics").optInt("modelRequests"),after.getJSONObject("metrics").optInt("modelRequests"))
            page.close();wire.close();instrumentation.waitForIdleSync();assertTrue("Pending product has an actual started foreground lifetime",service()?.let{it.started&&it.foreground}==true)
            instrumentation.sendStatus(0,Bundle().apply{putString("lifecyclePrepared",JSONObject().put("run",run).put("product",product).put("intentId",intent.getString("intentId")).put("admission",status.getJSONObject("receipt")).put("credentialGeneration",selected.getJSONObject("credential").getLong("generation")).put("pid",after.getInt("pid")).put("modelRequestsDuringPreparation",0).put("waiting",waiting.getJSONObject("recovery")).put("allClientsClosed",true).toString())});success=true
        }finally{
            if(!success&&created){val control=store.readControl(product);NativeStopController.request(context,"product",null,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",control.getLong("version")))}
            page.close();wire.close()
        }}
    }
    @Test(timeout=180000) fun observeDurableCompletionWithoutOpeningTheProductOwner(){
        assumeTrue(arguments.getString("realProvider")=="true")
        val run=run();val product=product(run);assertTrue(context.getSystemService(UserManager::class.java).isUserUnlocked)
        val locked=arguments.getString("requireKeyguardLocked")=="true";if(locked)assertTrue("Root must actually lock the device after first unlock",context.getSystemService(KeyguardManager::class.java).isDeviceLocked)
        NativeRecoveryStore(context,"input-v1").use{store->var found=JSONObject();until("Durable result exists before any observer binds or starts the owner"){
            if(locked)assertTrue("Device remains locked while completing",context.getSystemService(KeyguardManager::class.java).isDeviceLocked)
            try{val values=store.readProjection().getJSONArray("completions");val matches=(0 until values.length()).map{values.getJSONObject(it)}.filter{it.getString("conversationId")==product};if(matches.isEmpty())false else{assertEquals(1,matches.size);found=matches.single();true}}catch(error:IllegalStateException){if(error.message=="RECOVERY_STORAGE_BUSY")false else throw error}
        };instrumentation.sendStatus(0,Bundle().apply{putString("lifecycleUnboundCompletion",JSONObject().put("run",run).put("product",product).put("completion",found).put("ownerNotOpened",true).put("credentialNotResolvedByObserver",true).put("deviceLocked",context.getSystemService(KeyguardManager::class.java).isDeviceLocked).toString())})}
    }
    @Test(timeout=180000) fun verifyTheOriginalCompletedInputThroughThePublicInterface(){
        assumeTrue(arguments.getString("realProvider")=="true")
        val run=run();val product=product(run);val intentId=arguments.getString("lifecycleIntent")?:error("Original lifecycle intent required");val wire=Wire()
        try{wire.ready();var status=JSONObject();until("Original admitted work is done"){status=wire.call("sendStatus",JSONObject().put("intentId",intentId));status.optJSONObject("submission")?.optString("status")=="done"}
            val history=wire.call("history",JSONObject().put("id",product)).getJSONArray("items");val items=(0 until history.length()).map{history.getJSONObject(it)};assertEquals(listOf(prompt(run)),items.filter{it.optString("role")=="user"}.map{it.getString("text")});assertTrue(items.filter{it.optString("role")=="assistant"}.last().getString("text").contains("T12-LIFECYCLE-$run"));assertEquals(0,wire.call("execution.list",JSONObject().put("id",product)).getJSONArray("executions").length())
            instrumentation.sendStatus(0,Bundle().apply{putString("lifecycleVerified",JSONObject().put("run",run).put("product",product).put("intentId",intentId).put("admission",status.getJSONObject("receipt")).put("userInputs",1).put("toolExecutions",0).put("completeHttpCountObserved",false).toString())})
        }finally{wire.close()}
    }
}
