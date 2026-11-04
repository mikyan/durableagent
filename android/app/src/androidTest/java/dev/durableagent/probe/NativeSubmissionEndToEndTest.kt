package dev.durableagent.probe

import android.content.*
import android.os.*
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

/** Native process kills use the real SDK association/receipt and the same two durable databases. */
@RunWith(AndroidJUnit4::class)
class NativeSubmissionEndToEndTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun payload(id:String)=JSONObject().put("id",id)
    private fun until(condition:()->Boolean){val end=SystemClock.elapsedRealtime()+30000;while(!condition()){assertTrue("Combined native/SDK state timeout",SystemClock.elapsedRealtime()<end);Thread.sleep(20)}}
    private fun evidence(stage:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("submissionEndToEndEvidence",JSONObject().put("stage",stage).put("result",value).toString())})}
    private inner class Wire(val run:String):AutoCloseable {
        private val connection=id();private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
        val client=ApplicationClient(context,"fixture",run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value) else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
        fun call(method:String,value:JSONObject=JSONObject()):JSONObject {val request=id();val result=CompletableFuture<JSONObject>();replies[request]=result;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",request).put("method",method).put("payload",value).toString());val response=result.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("Control response timeout $what")}
        fun state()=control(12)
        fun ready(){until{val state=state();if(state.optString("phase")=="failed")error(state.toString());state.optString("phase")=="ready"}}
        fun fault(value:String){control(36,value)}
        fun closeHost(){client.control(20,"close");until{val state=state();state.optString("phase")=="closed"&&!state.optBoolean("domainOwned")}}
        override fun close(){client.disconnect()}
    }
    private fun kill(namespace:String,stage:String,request:JSONObject):JSONObject {
        val connected=CompletableFuture<IBinder>();val reached=CompletableFuture<JSONObject>();val died=CompletableFuture<Unit>()
        val receiver=Messenger(Handler(Looper.getMainLooper()){message->reached.complete(JSONObject(message.data.getString("value")!!));true})
        val connection=object:ServiceConnection {override fun onServiceConnected(name:ComponentName,binder:IBinder){binder.linkToDeath({died.complete(Unit)},0);connected.complete(binder)};override fun onServiceDisconnected(name:ComponentName){died.complete(Unit)}}
        check(context.bindService(Intent(context,SubmissionFaultProbeService::class.java),connection,Context.BIND_AUTO_CREATE))
        try{val remote=Messenger(connected.get(10,TimeUnit.SECONDS));remote.send(Message.obtain(null,1).apply{replyTo=receiver;data=Bundle().apply{putString("namespace",namespace);putString("stage",stage);putString("request",request.toString())}})
            val result=reached.get(15,TimeUnit.SECONDS);assertEquals(stage,result.optString("stage"));assertNotEquals(Process.myPid(),result.getInt("pid"));remote.send(Message.obtain(null,2));died.get(10,TimeUnit.SECONDS);return result.put("deathObserved",true)
        }finally{context.unbindService(connection)}
    }
    private fun prepare(store:NativeInputStore,product:String):JSONObject {
        val draft=store.inspect(product);val saved=store.save(product,draft.getLong("revision"),id(),"固定原输入 北京🌍",emptyList());val fixed=store.freeze(product,saved.getLong("revision"),id())
        return JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",saved.getJSONObject("submissionContext")).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start"))
    }
    private fun settled(wire:Wire,product:String){until{val state=wire.call("open",payload(product));if(state.optString("phase")=="failed")error(state.toString());state.optString("phase")=="done"}}
    private fun assertOne(wire:Wire,product:String,intent:String,expected:JSONObject?=null):JSONObject {
        val status=wire.call("sendStatus",JSONObject().put("intentId",intent));assertTrue(status.getBoolean("accepted"));val receipt=status.getJSONObject("receipt");if(expected!=null)assertEquals(expected.toString(),receipt.toString())
        val history=wire.call("history",payload(product)).getJSONArray("items");assertEquals(2,history.length());assertEquals("固定原输入 北京🌍",history.getJSONObject(0).getString("text"));assertEquals(1,wire.state().getJSONObject("metrics").optInt("modelRequests"));return receipt
    }
    @Test(timeout=240000) fun nativeIntentCommitDeathsRecoverOneRealSdkSubmissionAndKeepLaterDraft(){
        for(stage in listOf("send.intent.beforeCommit","send.intent.afterCommit")){
            val run="test-"+id();val namespace="input-$run";val product="native-intent";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run));val wire=Wire(run);val store=NativeInputStore(context,namespace)
            try{wire.ready();wire.call("create",JSONObject().put("creationId",product));val request=prepare(store,product);val death=kill(namespace,stage,request);assertEquals(if(stage.endsWith("beforeCommit"))0 else 1,store.listSends(payload(product)).getJSONArray("intents").length());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
                val current=store.inspect(product);store.save(product,current.getLong("revision"),id(),"之后的未发送草稿 🌍",emptyList());val intent=store.createSend(request);wire.call("send",JSONObject().put("intentId",intent.getString("intentId")));settled(wire,product);val receipt=assertOne(wire,product,intent.getString("intentId"));wire.call("send",JSONObject().put("intentId",intent.getString("intentId")));assertOne(wire,product,intent.getString("intentId"),receipt);assertEquals("之后的未发送草稿 🌍",store.inspect(product).getString("text"));assertEquals(1,store.listSends(payload(product)).getJSONArray("intents").length());wire.call("create",JSONObject().put("creationId",product));assertEquals(1,wire.call("list").getJSONArray("conversations").length())
                evidence(stage,JSONObject().put("death",death).put("receipt",receipt).put("nativeIntent",store.readSend(intent.getString("intentId"))).put("draft",store.inspect(product)).put("modelRequests",1).put("userEntries",1).put("productCount",1))
            }finally{page.close();store.close();try{wire.closeHost()}finally{wire.close()}}
        }
    }
    @Test(timeout=240000) fun nativeAckCommitDeathsVerifyTheRealSdkReceiptWithoutAnotherRequest(){
        for(stage in listOf("send.ack.beforeCommit","send.ack.afterCommit")){
            val run="test-"+id();val namespace="input-$run";val product="native-ack";val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run));val wire=Wire(run);val store=NativeInputStore(context,namespace)
            try{wire.ready();wire.call("create",JSONObject().put("creationId",product));val intent=store.createSend(prepare(store,product));val intentId=intent.getString("intentId");wire.fault("ack-drop");wire.call("send",JSONObject().put("intentId",intentId));settled(wire,product);val receipt=assertOne(wire,product,intentId);assertEquals("uncertain",store.readSend(intentId).getString("delivery"));val draft=store.inspect(product);val newer=store.save(product,draft.getLong("revision"),id(),"保留新草稿 A→B→A 🌍",emptyList());val death=kill(namespace,stage,JSONObject().put("intentId",intentId).put("receipt",receipt));assertEquals(if(stage.endsWith("beforeCommit"))"uncertain" else "acknowledged",store.readSend(intentId).getString("delivery"))
                wire.fault("off");val confirmed=wire.call("send",JSONObject().put("intentId",intentId));assertFalse(confirmed.getJSONObject("acknowledgement").getBoolean("draftCleared"));assertOne(wire,product,intentId,receipt);assertEquals("acknowledged",store.readSend(intentId).getString("delivery"));assertEquals(newer.getLong("revision"),store.inspect(product).getLong("revision"));assertEquals(newer.getString("text"),store.inspect(product).getString("text"))
                evidence(stage,JSONObject().put("death",death).put("receipt",receipt).put("nativeIntent",store.readSend(intentId)).put("draft",store.inspect(product)).put("modelRequests",1).put("userEntries",1).put("repeatAddedRequests",0))
            }finally{page.close();store.close();try{wire.closeHost()}finally{wire.close()}}
        }
    }
}
