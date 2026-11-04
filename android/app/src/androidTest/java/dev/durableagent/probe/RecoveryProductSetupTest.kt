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

/** Explicit root-only empty-domain setup; one public connection + native encrypted capsule, no input. */
@RunWith(AndroidJUnit4::class)
class RecoveryProductSetupTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun until(label:String,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+60000;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    @Test(timeout=120000) fun initializeOnlyAnEmptyProductConfigurationWithoutSendingWork(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("initializeEmptyProduct")=="true")
        val responses=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();val states=LinkedBlockingQueue<JSONObject>();val imports=LinkedBlockingQueue<JSONObject>();val connection=UUID.randomUUID().toString()
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","product"))
        val client=ApplicationClient(context,"product",null){what,text->val value=JSONObject(text);when(what){10->responses.remove(value.optString("requestId"))?.complete(value);12->states.offer(value);31->imports.offer(value)}}.apply{connect()}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(30,TimeUnit.SECONDS)?:error("Product setup owner status timed out")}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=UUID.randomUUID().toString();val future=CompletableFuture<JSONObject>();responses[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val response=future.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        try{
            until("Empty product owner ready"){val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}
            val prior=call("models.get");val products=call("list").getJSONArray("conversations")
            if(prior.getLong("version")!=0L||!prior.isNull("defaultModel")||prior.getJSONArray("connections").length()!=0||products.length()!=0){instrumentation.sendStatus(0,Bundle().apply{putString("productRecoverySetup",JSONObject().put("initialized",false).put("preservedExistingState",true).put("configurationVersion",prior.getLong("version")).put("connectionCount",prior.getJSONArray("connections").length()).put("productCount",products.length()).toString())});return}
            call("models.create",JSONObject().put("creationId","recovery-validation").put("expectedVersion",0).put("name","Recovery validation").put("protocol","mimo-cn").put("endpoint","https://token-plan-cn.xiaomimimo.com/v1"))
            client.control(31,JSONObject().put("target","recovery-validation").put("expectedGeneration",0).toString());val imported=imports.poll(15,TimeUnit.SECONDS)?:error("Initial encrypted capsule import timed out");assertTrue(imported.toString(),imported.getBoolean("ok"))
            val configured=call("models.setDefault",JSONObject().put("expectedVersion",1).put("selection",JSONObject().put("provider","recovery-validation").put("modelId","mimo-v2.6-flash")))
            assertEquals(0,call("list").getJSONArray("conversations").length());assertEquals(0,state().getJSONObject("metrics").optInt("modelRequests"))
            instrumentation.sendStatus(0,Bundle().apply{putString("productRecoverySetup",JSONObject().put("initialized",true).put("connection","recovery-validation").put("configurationVersion",configured.getLong("version")).put("defaultModel",configured.getJSONObject("defaultModel")).put("credential",CredentialVault(context).metadata("recovery-validation").toJson()).put("productCount",0).put("modelRequests",0).toString())})
        }finally{page.close();client.control(20,"close");try{until("Setup owner closes naturally"){state().optString("phase")=="closed"}}finally{client.disconnect()}}
    }
}
