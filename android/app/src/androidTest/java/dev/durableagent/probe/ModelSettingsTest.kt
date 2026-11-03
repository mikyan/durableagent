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

/** Actual React controls -> separate native credential boundary -> Keystore -> request-time SDK. */
@RunWith(AndroidJUnit4::class)
class ModelSettingsTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,android.os.Bundle().apply{putString("modelEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        val id=UUID.randomUUID().toString();val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        val states=LinkedBlockingQueue<JSONObject>();val imports=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->val value=JSONObject(text);when(what){12->states.offer(value);31->imports.offer(value);10->pending.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {val requestId=UUID.randomUUID().toString();val result=CompletableFuture<JSONObject>();pending[requestId]=result;client.post(JSONObject().put("protocol",1).put("connectionId",id).put("requestId",requestId).put("method",method).put("payload",payload).toString());val response=result.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Native state timeout")}
        fun ready(){until{val value=state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready"}}
        fun importKey(target:String,generation:Long){imports.clear();client.control(31,JSONObject().put("target",target).put("expectedGeneration",generation).toString());val result=imports.poll(10,TimeUnit.SECONDS)?:error("Encrypted import timeout");assertTrue(result.toString(),result.getBoolean("ok"))}
        fun closeHost(){client.control(20,"close");until{val s=state();s.optString("phase")=="closed"&&!s.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private fun until(timeout:Long=90000,condition:()->Boolean){val end=System.currentTimeMillis()+timeout;while(!condition()){assertTrue("Model settings state timeout",System.currentTimeMillis()<end);Thread.sleep(25)}}
    private fun js(scenario:ActivityScenario<AgentActivity>,source:String):String{val result=CompletableFuture<String>();scenario.onActivity{it.webView?.evaluateJavascript(source){value->result.complete(value)}?:result.complete("null")};return result.get(10,TimeUnit.SECONDS)}
    private fun click(scenario:ActivityScenario<AgentActivity>,id:String){until{js(scenario,"document.querySelector('[data-testid=$id]')?.disabled===false")=="true"};js(scenario,"document.querySelector('[data-testid=$id]').click()")}
    private fun input(scenario:ActivityScenario<AgentActivity>,id:String,value:String,tag:String="HTMLInputElement"){js(scenario,"(()=>{const e=document.querySelector('[data-testid=$id]');Object.getOwnPropertyDescriptor($tag.prototype,'value').set.call(e,${JSONObject.quote(value)});e.dispatchEvent(new Event('${if(tag=="HTMLSelectElement")"change" else "input"}',{bubbles:true}));})()")}
    private fun settings(scenario:ActivityScenario<AgentActivity>){js(scenario,"(()=>{const menu=document.querySelector('[aria-label=\"打开会话列表\"]');if(menu&&getComputedStyle(menu).display!=='none')menu.click();})()");click(scenario,"open-model-settings");until{js(scenario,"!!document.querySelector('[data-testid=connection-name]') && document.querySelector('[data-testid=connection-name]').disabled===false")=="true"}}
    private fun add(scenario:ActivityScenario<AgentActivity>,wire:Wire):String{input(scenario,"connection-name","设备验证连接");click(scenario,"add-connection");until{wire.call("models.get").getJSONArray("connections").length()==1};return wire.call("models.get").getJSONArray("connections").getJSONObject(0).getString("id")}
    private fun chooseDefault(scenario:ActivityScenario<AgentActivity>,wire:Wire,target:String){input(scenario,"default-model",org.json.JSONArray(listOf(target,"mimo-v2.6-flash")).toString(),"HTMLSelectElement");click(scenario,"default-model-apply");until{wire.call("models.get").optJSONObject("defaultModel")?.optString("provider")==target}}
    private fun createSend(scenario:ActivityScenario<AgentActivity>,wire:Wire,text:String):String {
        js(scenario,"document.querySelector('[aria-label=\"返回会话\"]')?.click()")
        click(scenario,"create-conversation");until{js(scenario,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"}
        input(scenario,"message-input",text,"HTMLTextAreaElement");click(scenario,"send-message")
        until{val phase=js(scenario,"document.querySelector('[data-testid=conversation-status]')?.dataset.phase");if(phase=="\"failed\"")error(wire.call("list").toString());phase=="\"done\""}
        return wire.call("list").getJSONArray("conversations").getJSONObject(0).getString("id")
    }
    @Test(timeout=180000) fun settingsSaveRotateReopenThroughRealReactAndNativeVault(){
        val run=UUID.randomUUID().toString();val mode="models-fixture";var wire=Wire(mode,run);val scenario=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
        try{wire.ready();settings(scenario);val target=add(scenario,wire)
            input(scenario,"credential-input","synthetic-device-first-key-001");click(scenario,"credential-save");until{wire.call("models.get").getJSONArray("connections").getJSONObject(0).getJSONObject("credential").getLong("generation")==1L};assertEquals("\"\"",js(scenario,"document.querySelector('[data-testid=credential-input]').value"))
            chooseDefault(scenario,wire,target);val chat=createSend(scenario,wire,"实际设置入口中文🌍");val first=wire.call("history",JSONObject().put("id",chat));assertEquals("你好🌍",first.getJSONArray("items").getJSONObject(1).getString("text"));assertEquals(1,wire.state().getJSONObject("metrics").getInt("lastCredentialGeneration"))
            settings(scenario);input(scenario,"credential-input","synthetic-device-second-key-002");click(scenario,"credential-save");until{wire.call("models.get").getJSONArray("connections").getJSONObject(0).getJSONObject("credential").getLong("generation")==2L};val before=wire.call("models.get")
            scenario.close();wire.closeHost();wire.close();wire=Wire(mode,run);wire.ready();assertEquals(before.toString(),wire.call("models.get").toString());assertEquals(first.toString(),wire.call("history",JSONObject().put("id",chat)).toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            wire.call("send",JSONObject().put("id",chat).put("text","轮转后的下一次请求").put("actionId","after-rotation"));until{wire.call("open",JSONObject().put("id",chat)).getString("phase")=="done"};assertEquals(2,wire.state().getJSONObject("metrics").getInt("lastCredentialGeneration"))
            evidence("settings-rotate-reopen",JSONObject().put("configuration",before).put("state",wire.state()).put("history",wire.call("history",JSONObject().put("id",chat))))
        }finally{scenario.close();try{wire.closeHost()}finally{wire.close()}}
    }
    @Test(timeout=180000) fun realMimoUsesSavedVaultCredentialAndReopensWithoutReplay(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        val run=UUID.randomUUID().toString();val mode="models";var wire=Wire(mode,run);val scenario=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
        try{wire.ready();settings(scenario);val target=add(scenario,wire);wire.importKey(target,0);click(scenario,"refresh-models");chooseDefault(scenario,wire,target);val chat=createSend(scenario,wire,"请只回复一句简短中文问候，包含模型设置验证。");val history=wire.call("history",JSONObject().put("id",chat));assertEquals(2,history.getJSONArray("items").length());val before=wire.state();assertEquals(1,before.getJSONObject("metrics").getInt("modelRequests"));val configuration=wire.call("models.get");scenario.close();wire.closeHost();wire.close();wire=Wire(mode,run);wire.ready();assertEquals(history.toString(),wire.call("history",JSONObject().put("id",chat)).toString());assertEquals(configuration.toString(),wire.call("models.get").toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"));evidence("real-mimo-vault",JSONObject().put("before",before).put("reopened",wire.state()).put("configuration",configuration).put("history",history))
        }finally{scenario.close();try{wire.closeHost()}finally{wire.close()}}
    }
    @Test(timeout=180000) fun modelPolicyMatrixUsesActualAndroidNodeAndSqlite(){
        val wire=Wire("models-fixture",UUID.randomUUID().toString())
        try{wire.ready();wire.client.control(32);var state=JSONObject();until{state=wire.state();val metrics=state.getJSONObject("metrics");if(metrics.optString("modelPolicyState")=="failed")error(metrics.toString());metrics.optString("modelPolicyState")=="passed"};assertEquals(13,state.getJSONObject("metrics").getJSONArray("modelPolicyCases").length());evidence("android-model-policy",state)}finally{try{wire.closeHost()}finally{wire.close()}}
    }
}
