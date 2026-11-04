package dev.durableagent.probe

import android.content.Intent
import android.content.IntentFilter
import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.DocumentsContract
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Actual WebView/native storage and actual SDK; only synthetic test sources and isolated domains. */
@RunWith(AndroidJUnit4::class)
class InputApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun evidence(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("inputEvidence",JSONObject().put("case",name).put("result",value).toString())})}
    private inner class Wire(val mode:String,val run:String):AutoCloseable {
        val id=UUID.randomUUID().toString()
        private val responses=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>()
        private val busy=LinkedBlockingQueue<JSONObject>()
        private val imports=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->val value=JSONObject(text);when(what){10->responses.remove(value.optString("requestId"))?.complete(value);12->states.offer(value);31->imports.offer(value);35->busy.offer(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {
            val requestId=UUID.randomUUID().toString();val response=CompletableFuture<JSONObject>();responses[requestId]=response
            client.post(JSONObject().put("protocol",1).put("connectionId",id).put("requestId",requestId).put("method",method).put("payload",SubmissionTestDriver.payload(context,mode,run,method,payload)).toString())
            val result=response.get(30,TimeUnit.SECONDS);assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")
        }
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Native host state timeout")}
        fun busyState():JSONObject{busy.clear();client.control(35);return busy.poll(3,TimeUnit.SECONDS)?:error("Independent native busy barrier timeout")}
        fun ready(){until{val value=state();if(value.optString("phase")=="failed")error(value.toString());value.optString("phase")=="ready"}}
        fun closeHost(){client.control(20,"close");until{val value=state();value.optString("phase")=="closed"&&!value.optBoolean("domainOwned")}}
        fun importKey(target:String){imports.clear();client.control(31,JSONObject().put("target",target).put("expectedGeneration",0).toString());val result=imports.poll(10,TimeUnit.SECONDS)?:error("Encrypted import timeout");assertTrue(result.toString(),result.getBoolean("ok"))}
        override fun close(){client.disconnect()}
    }
    private fun until(timeout:Long=60000,condition:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Input public state timeout",SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)}}
    private fun scenario(mode:String,run:String)=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
    private fun js(scenario:ActivityScenario<AgentActivity>?,source:String):String{val value=CompletableFuture<String>();requireNotNull(scenario).onActivity{it.webView?.evaluateJavascript(source){result->value.complete(result)}?:value.complete("null")};return value.get(10,TimeUnit.SECONDS)}
    private fun click(scenario:ActivityScenario<AgentActivity>?,selector:String){until{js(scenario,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(scenario,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun open(scenario:ActivityScenario<AgentActivity>?,id:String){until{js(scenario,"!!document.querySelector('[aria-label=\"返回首页\"]')")=="true"};js(scenario,"document.querySelector('[aria-label=\"返回首页\"]').click()");click(scenario,"[data-conversation-id='$id']");until{js(scenario,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"}}
    private fun input(scenario:ActivityScenario<AgentActivity>?,text:String){js(scenario,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()")}
    private fun saved(scenario:ActivityScenario<AgentActivity>?){until{js(scenario,"document.querySelector('[data-testid=draft-status]')?.dataset.state")=="\"saved\""}}
    private fun create(wire:Wire,id:String){wire.call("create",JSONObject().put("creationId",id).put("title",id))}

    @Test(timeout=180000) fun nativeDraftsSaveThroughRealUiWhileNodeBusyAndNotStarted(){
        val run=UUID.randomUUID().toString();val wire=Wire("fixture",run);var page:ActivityScenario<AgentActivity>?=null
        val store=NativeInputStore(context,"input-$run")
        try{
            wire.ready();create(wire,"busy-draft");create(wire,"offline-draft")
            page=scenario("fixture",run);open(page,"busy-draft")
            wire.client.control(34,"10000");until{val state=wire.busyState();state.getLong("started")>0&&state.getLong("ended")==0L}
            val text="Node 忙循环期间，原生仍确认保存 🌍"
            input(page,text);until{store.read("busy-draft").getString("text")==text};saved(page)
            val during=wire.busyState();assertEquals("Save must complete before the real JS loop ends",0L,during.getLong("ended"));val confirmed=store.read("busy-draft")
            until{wire.busyState().getLong("ended")>0};assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            page.close();page=null;wire.closeHost()
            assertEquals(0,wire.state().getInt("nativeOwners"))
            page=scenario("input-only",run);open(page,"offline-draft");input(page,"Agent 从未启动的页面仍保存第二份草稿");saved(page)
            assertEquals("Agent 从未启动的页面仍保存第二份草稿",store.read("offline-draft").getString("text"))
            assertEquals(confirmed.getLong("revision"),store.read("busy-draft").getLong("revision"))
            assertEquals(0,wire.state().getInt("nativeOwners"))
            evidence("independent-native-save",JSONObject().put("busyBarrierAtReceipt",during).put("first",confirmed).put("second",store.read("offline-draft")).put("nativeOwnersWithoutAgent",0).put("modelRequests",0))
        }finally{page?.close();store.close();try{wire.closeHost()}finally{wire.close()}}
    }

    @Test(timeout=180000) fun twoDraftsRestoreAfterActivityRecreationAndFreshHostWithoutSend(){
        val run=UUID.randomUUID().toString();var wire=Wire("fixture",run);var page:ActivityScenario<AgentActivity>?=null;val store=NativeInputStore(context,"input-$run")
        try{
            wire.ready();create(wire,"first-draft");create(wire,"second-draft");page=scenario("fixture",run)
            open(page,"first-draft");input(page,"甲的已保存长文本 🌍\n".repeat(40));open(page,"second-draft") // navigation flush is the barrier
            input(page,"乙的独立草稿");saved(page);val first=store.read("first-draft");val second=store.read("second-draft")
            page.recreate();until{js(page,"document.querySelector('[data-testid=message-input]')?.value")==JSONObject.quote(second.getString("text"))}
            open(page,"first-draft");assertEquals(JSONObject.quote(first.getString("text")),js(page,"document.querySelector('[data-testid=message-input]').value"))
            page.close();page=null;wire.closeHost();wire.close();wire=Wire("fixture",run);wire.ready();page=scenario("fixture",run)
            open(page,"second-draft");assertEquals(JSONObject.quote(second.getString("text")),js(page,"document.querySelector('[data-testid=message-input]').value"))
            assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"));assertEquals(0,wire.call("history",JSONObject().put("id","first-draft")).getJSONArray("items").length())
            evidence("two-drafts-recreated",JSONObject().put("firstRevision",first.getLong("revision")).put("secondRevision",second.getLong("revision")).put("modelRequests",0))
        }finally{page?.close();store.close();try{wire.closeHost()}finally{wire.close()}}
    }

    @Test(timeout=180000) fun inputPolicyUsesActualAndroidNodeAndSqlite(){
        val wire=Wire("models-fixture",UUID.randomUUID().toString())
        try{wire.ready();wire.client.control(33);var state=JSONObject();until{state=wire.state();val metrics=state.getJSONObject("metrics");if(metrics.optString("inputPolicyState")=="failed")error(metrics.toString());metrics.optString("inputPolicyState")=="passed"};assertEquals(5,state.getJSONObject("metrics").getJSONArray("inputPolicyCases").length());evidence("actual-sdk-input-policy",state)}finally{try{wire.closeHost()}finally{wire.close()}}
    }

    private fun source(bytes:ByteArray,mime:String,name:String):Uri {
        val id=UUID.randomUUID().toString();context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.put",id,Bundle().apply{putByteArray("bytes",bytes);putString("mime",mime);putString("name",name)})
        return DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY,id)
    }
    private fun pickerFilter()=IntentFilter(Intent.ACTION_OPEN_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);addDataType("*/*")}
    @Test(timeout=30000) fun configuringNewUiBridgeDoesNotWaitForAnotherStoreLease(){
        val run=UUID.randomUUID().toString();val heldNamespace="input-held-$run";val store=NativeInputStore(context,heldNamespace).withLeaseWait(2000)
        var page:ActivityScenario<AgentActivity>?=null;var lease:StorageDomainLease?=null;var worker:Thread?=null
        val construction=CompletableFuture<NativeInputBridge>();val read=CompletableFuture<JSONObject>()
        try{
            store.rememberConversation(JSONObject().put("id","held-chat").put("title","held-chat").put("model",JSONObject().put("provider","fixture").put("modelId","text").put("name","文字")))
            page=scenario("input-only",run);var activity:AgentActivity?=null;page.onActivity{activity=it}
            until(10000){js(page,"typeof window.DurableNative==='object'")=="true"}
            lease=StorageDomainLease.acquire(java.io.File(context.noBackupFilesDir,heldNamespace))?:error("Fixture lease unavailable")
            worker=Thread({try{read.complete(store.inspect("held-chat"))}catch(error:Throwable){read.completeExceptionally(error)}},"HeldNativeInputReader").apply{start()}
            until(1000){worker.state==Thread.State.TIMED_WAITING}
            assertFalse(read.isDone)
            val started=SystemClock.elapsedRealtime()
            android.os.Handler(android.os.Looper.getMainLooper()).post{
                try{construction.complete(NativeInputBridge(requireNotNull(activity),"input-$run","input-only",run){})}catch(error:Throwable){construction.completeExceptionally(error)}
            }
            try{construction.get(500,TimeUnit.MILLISECONDS)}catch(_:java.util.concurrent.TimeoutException){fail("Configuring a new native UI bridge blocked behind another store's lease wait")}
            val elapsed=SystemClock.elapsedRealtime()-started
            assertFalse("The original native read must still be waiting for its OS lease",read.isDone)
            lease.close();lease=null
            assertEquals("held-chat",read.get(5,TimeUnit.SECONDS).getString("id"))
            evidence("native-ui-configuration",JSONObject().put("run",run).put("mainThreadConstructionMs",elapsed).put("oldReadWaitingAtConstruction",true).put("sdkOwnerOpened",false))
        }finally{
            lease?.close();worker?.join(5000)
            runCatching{construction.get(5,TimeUnit.SECONDS)}.getOrNull()?.let{bridge->instrumentation.runOnMainSync{bridge.close()}}
            page?.close();store.close()
        }
    }
    @Test(timeout=30000) fun publicInputFreezeWaitsForShortNativeLeaseWithoutRetryingTheAction(){
        val run=UUID.randomUUID().toString();val namespace="input-$run";val store=NativeInputStore(context,namespace);var page:ActivityScenario<AgentActivity>?=null;var lease:StorageDomainLease?=null
        try{
            val capability=JSONObject().put("version","lease-fixture-1").put("provider","fixture").put("modelId","text").put("source","validation").put("input",org.json.JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject())
            store.rememberConversation(JSONObject().put("id","lease-chat").put("title","原生输入短事务等待").put("model",JSONObject().put("provider","fixture").put("modelId","text").put("name","文字")),capability)
            store.save("lease-chat",0,"save-before-lease","one fixed input 世界",emptyList())
            page=scenario("input-only",run);open(page,"lease-chat");saved(page)
            js(page,"window.__leaseReplies=[];window.__leaseReceive=window.__durableReceive;window.__durableReceive=e=>{window.__leaseReceive(e);if(e.connectionId==='lease-test')window.__leaseReplies.push(e)}")
            fun post(requestId:String,method:String,payload:JSONObject){
                val envelope=JSONObject().put("protocol",1).put("connectionId","lease-test").put("requestId",requestId).put("method",method).put("payload",payload)
                js(page,"window.DurableNative.postMessage(${JSONObject.quote(envelope.toString())})")
            }
            fun reply(requestId:String):JSONObject{
                until(5000){js(page,"window.__leaseReplies.some(e=>e.requestId===${JSONObject.quote(requestId)})")=="true"}
                return JSONObject(JSONTokener(js(page,"JSON.stringify(window.__leaseReplies.find(e=>e.requestId===${JSONObject.quote(requestId)}))")).nextValue() as String)
            }
            // Use the real OS lease, held outside NativeInputStore's process-wide
            // monitor, to reproduce a competing owner without blocking the UI.
            lease=StorageDomainLease.acquire(java.io.File(context.noBackupFilesDir,namespace))?:error("Fixture lease unavailable")
            val start=SystemClock.elapsedRealtime()
            post("one-freeze","input.freeze",JSONObject().put("id","lease-chat").put("expectedRevision",1).put("operationId","one-freeze-operation"))
            Thread.sleep(150)
            assertEquals("Short native contention must not reject the one UI action", "0", js(page,"window.__leaseReplies.filter(e=>e.requestId==='one-freeze').length"))
            lease.close();lease=null
            val frozen=reply("one-freeze");assertTrue(frozen.toString(),frozen.getBoolean("ok"));val value=frozen.getJSONObject("value")
            assertEquals("one fixed input 世界",store.readFrozen(value.getString("token")).getString("text"));assertEquals(1L,store.inspect("lease-chat").getLong("revision"))
            assertEquals("1",js(page,"window.__leaseReplies.filter(e=>e.requestId==='one-freeze').length"))
            val completedMs=SystemClock.elapsedRealtime()-start
            lease=StorageDomainLease.acquire(java.io.File(context.noBackupFilesDir,namespace))?:error("Fixture lease unavailable")
            val boundedStart=SystemClock.elapsedRealtime()
            post("bounded-read","input.readControl",JSONObject().put("id","lease-chat"))
            val blocked=reply("bounded-read");assertFalse(blocked.getBoolean("ok"));assertEquals("INPUT_STORAGE_BUSY",blocked.getJSONObject("error").getString("code"))
            val boundedMs=SystemClock.elapsedRealtime()-boundedStart;assertTrue("Unreleased authority must return a bounded visible failure",boundedMs<5000)
            lease.close();lease=null
            assertEquals("one fixed input 世界",store.inspect("lease-chat").getString("text"));assertEquals(0,store.listSends(JSONObject().put("id","lease-chat")).getJSONArray("intents").length())
            evidence("native-ui-lease-acquisition",JSONObject().put("run",run).put("freezeRequests",1).put("freezeResponses",1).put("freezeElapsedMs",completedMs).put("unreleasedLeaseFailureMs",boundedMs).put("sdkOwnerOpened",false).put("modelRequests",0).put("sendIntents",0))
        }finally{lease?.close();page?.close();store.close()}
    }
    @Test(timeout=120000) fun lostSelectionReceiptReplaysThroughActualBridgeWithoutOpeningAnotherPicker(){
        val run=UUID.randomUUID().toString();val store=NativeInputStore(context,"input-$run");var page:ActivityScenario<AgentActivity>?=null
        val monitor=instrumentation.addMonitor(pickerFilter(),Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null),true)
        try{
            store.rememberConversation(JSONObject().put("id","picker-replay").put("title","选择回执验证").put("model",JSONObject().put("provider","fixture").put("modelId","text").put("name","文字")))
            val uri=source("已选择的合成正文".toByteArray(),"text/plain","retained.txt")
            val committed=store.selectSource("picker-replay",0,"original-picker-operation",uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"text")
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.delete",DocumentsContract.getDocumentId(uri),null)
            page=scenario("input-only",run);open(page,"picker-replay")
            js(page,"window.__inputReplies=[];window.__inputOriginalReceive=window.__durableReceive;window.__durableReceive=e=>{window.__inputOriginalReceive(e);if(e.connectionId==='bridge-replay-test')window.__inputReplies.push(e)}")
            fun select(requestId:String,operationId:String,revision:Long):JSONObject {
                val request=JSONObject().put("protocol",1).put("connectionId","bridge-replay-test").put("requestId",requestId).put("method","input.select").put("payload",JSONObject().put("id","picker-replay").put("kind","file").put("operationId",operationId).put("expectedRevision",revision))
                js(page,"window.DurableNative.postMessage(${JSONObject.quote(request.toString())})")
                until{js(page,"window.__inputReplies.some(e=>e.requestId===${JSONObject.quote(requestId)})")=="true"}
                return JSONObject(JSONTokener(js(page,"JSON.stringify(window.__inputReplies.find(e=>e.requestId===${JSONObject.quote(requestId)}))")).nextValue() as String)
            }
            val replay=select("replayed","original-picker-operation",0);assertTrue(replay.toString(),replay.getBoolean("ok"));assertEquals(committed.toString(),replay.getJSONObject("value").toString());assertEquals(0,monitor.hits)
            val cancelled=select("fresh","fresh-picker-operation",store.inspect("picker-replay").getLong("revision"));assertFalse(cancelled.getBoolean("ok"));assertEquals("INPUT_PICKER_CANCELLED",cancelled.getJSONObject("error").getString("code"));assertEquals("Positive control: a new explicit selection reaches the picker",1,monitor.hits)
            evidence("bridge-selection-replay",JSONObject().put("replayedRevision",committed.getLong("revision")).put("replayPickerLaunches",0).put("freshExplicitPickerLaunches",1).put("originalSourceDeleted",true))
        }finally{instrumentation.removeMonitor(monitor);page?.close();store.close()}
    }
    private fun picture(code:String):ByteArray {
        val bitmap=Bitmap.createBitmap(560,220,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);canvas.drawColor(Color.WHITE)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=120f;typeface=Typeface.MONOSPACE;textAlign=Paint.Align.CENTER}
        canvas.drawText(code,280f,155f,paint)
        return ByteArrayOutputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it);bitmap.recycle();it.toByteArray()}
    }
    @Test(timeout=60000) fun saturatedSourceWorkersDoNotDelayThirdSelectionCommitOrTextSave(){
        val run=UUID.randomUUID().toString();val store=NativeInputStore(context,"input-$run");var page:ActivityScenario<AgentActivity>?=null
        val uris=(0..2).map{index->
            val id=UUID.randomUUID().toString();context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.put",id,Bundle().apply{putByteArray("bytes","来源 $index 的完整正文".toByteArray());putString("mime","text/plain");putString("name","source-$index.txt");putBoolean("metadataBlocked",index<2)})
            DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY,id)
        }
        try{
            store.rememberConversation(JSONObject().put("id","saturated").put("title","附件并行保存验证").put("model",JSONObject().put("provider","fixture").put("modelId","text").put("name","文字")))
            page=scenario("input-only",run);open(page,"saturated")
            js(page,"window.__poolReplies=[];window.__poolReceive=window.__durableReceive;window.__durableReceive=e=>{window.__poolReceive(e);if(e.connectionId==='pool-test')window.__poolReplies.push(e)}")
            fun request(id:String,method:String,payload:JSONObject):JSONObject {
                val envelope=JSONObject().put("protocol",1).put("connectionId","pool-test").put("requestId",id).put("method",method).put("payload",payload)
                js(page,"window.DurableNative.postMessage(${JSONObject.quote(envelope.toString())})")
                val deadline=SystemClock.elapsedRealtime()+2000
                while(js(page,"window.__poolReplies.some(e=>e.requestId===${JSONObject.quote(id)})")!="true"){assertTrue("Native commit receipt timed out for $id while source workers are held",SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)}
                val reply=JSONObject(JSONTokener(js(page,"JSON.stringify(window.__poolReplies.find(e=>e.requestId===${JSONObject.quote(id)}))")).nextValue() as String)
                assertTrue(reply.toString(),reply.getBoolean("ok"));return reply.getJSONObject("value")
            }
            var draft=JSONObject();val started=SystemClock.elapsedRealtime()
            for(index in 0..2){
                val monitor=instrumentation.addMonitor(pickerFilter(),Instrumentation.ActivityResult(Activity.RESULT_OK,Intent().setData(uris[index]).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)),true)
                try{draft=request("select-$index","input.select",JSONObject().put("id","saturated").put("kind","file").put("expectedRevision",index).put("operationId","select-$index"));assertEquals(1,monitor.hits)}finally{instrumentation.removeMonitor(monitor)}
                if(index<2){until(2000){context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.metadata-state",DocumentsContract.getDocumentId(uris[index]),null)?.getBoolean("entered")==true};evidence("saturated-source-held",JSONObject().put("acknowledgedSelection",index).put("revision",draft.getLong("revision")).put("providerMetadataEntered",true))}
            }
            val ids=org.json.JSONArray();for(index in 0 until draft.getJSONArray("selections").length())ids.put(draft.getJSONArray("selections").getJSONObject(index).getString("id"))
            val saved=request("save","input.save",JSONObject().put("id","saturated").put("operationId","save-after-third").put("expectedRevision",3).put("text","两个来源仍阻塞，第三个选择和文字均已提交 🌍").put("selectionIds",ids))
            assertEquals(4L,saved.getLong("revision"));assertEquals(saved.getString("text"),store.inspect("saturated").getString("text"));assertEquals(3,saved.getJSONArray("selections").length())
            evidence("saturated-source-admission",JSONObject().put("heldSourceWorkers",2).put("committedSelections",3).put("savedRevision",4).put("allReceiptsWithinMs",SystemClock.elapsedRealtime()-started).put("modelRequests",0))
        }finally{
            for(uri in uris.take(2))context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.release-metadata",DocumentsContract.getDocumentId(uri),null)
            page?.close();store.close()
        }
    }
    @Test(timeout=240000) fun realMimoReadsFrozenImageAndUtf8ChallengesAfterOriginalChanges(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        val run=UUID.randomUUID().toString();var wire=Wire("models",run);val store=NativeInputStore(context,"input-$run")
        try{
            wire.ready();wire.call("models.create",JSONObject().put("creationId","vision").put("expectedVersion",0).put("name","图像验证").put("protocol","mimo-cn").put("endpoint","https://token-plan-cn.xiaomimimo.com/v1"));wire.importKey("vision")
            wire.call("models.setDefault",JSONObject().put("expectedVersion",1).put("selection",JSONObject().put("provider","vision").put("modelId","mimo-v2.6-flash")));create(wire,"image-challenge")
            val random=SecureRandom();val alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";val code=(1..4).map{alphabet[random.nextInt(alphabet.length)]}.joinToString("")
            val uri=source(picture(code),"image/png","image.png")
            var draft=store.selectSource("image-challenge",0,"select-image",uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val selection=draft.getJSONArray("selections").getJSONObject(0).getString("id")
            draft=store.prepare("image-challenge",selection,"prepare-image");assertEquals("ready",draft.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            val prompt="请读取图片中央的四位英文大写或数字代码，仅输出该代码，不要附加其他内容。"
            assertFalse(prompt.contains(code));draft=store.save("image-challenge",draft.getLong("revision"),"save-prompt",prompt,listOf(selection))
            val frozen=store.freeze("image-challenge",draft.getLong("revision"),"freeze-image");val representation=frozen.getJSONArray("representations").getJSONObject(0)
            assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.update",DocumentsContract.getDocumentId(uri),Bundle().apply{putByteArray("bytes",picture(if(code=="ZZ99")"YY88" else "ZZ99"))})
            wire.call("send",JSONObject().put("id","image-challenge").put("inputToken",frozen.getString("token")).put("actionId","explicit-image-challenge"))
            until(90000){val value=wire.call("open",JSONObject().put("id","image-challenge"));if(value.getString("phase")=="failed")error(value.optString("reason"));value.getString("phase")=="done"}
            val history=wire.call("history",JSONObject().put("id","image-challenge"));val answer=history.getJSONArray("items").getJSONObject(1).getString("text");assertTrue("Model must read the undisclosed image challenge",answer.contains(code))
            val before=wire.state();val transmitted=before.getJSONObject("metrics").getJSONObject("lastInput").getJSONArray("images");assertEquals(1,transmitted.length());assertEquals(representation.getString("sha256"),transmitted.getJSONObject(0).getString("sha256"));assertEquals(1,before.getJSONObject("metrics").getInt("modelRequests"))
            wire.closeHost();wire.close();wire=Wire("models",run);wire.ready();assertEquals(history.toString(),wire.call("history",JSONObject().put("id","image-challenge")).toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            evidence("real-fixed-image",JSONObject().put("challenge",code).put("answer",answer).put("frozen",frozen).put("requestInput",before.getJSONObject("metrics").getJSONObject("lastInput")).put("originalChangedAfterFreeze",true).put("requestsBeforeSend",0).put("explicitRequests",1).put("reopenRequests",0))
            create(wire,"text-challenge")
            val textCode=(1..8).map{alphabet[random.nextInt(alphabet.length)]}.joinToString("")
            val fullText="\uFEFF完整 UTF-8 验证资料 🌍\n唯一校验码：$textCode\n资料结束。\n"
            val textBytes=fullText.toByteArray(Charsets.UTF_8);val textUri=source(textBytes,"text/plain","input.txt")
            var textDraft=store.selectSource("text-challenge",0,"select-text",textUri,Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val textSelection=textDraft.getJSONArray("selections").getJSONObject(0).getString("id")
            textDraft=store.prepare("text-challenge",textSelection,"prepare-text");assertEquals("ready",textDraft.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            val textPrompt="请读取随附资料中唯一校验码，仅输出校验码，不要附加其他内容。"
            assertFalse(textPrompt.contains(textCode));textDraft=store.save("text-challenge",textDraft.getLong("revision"),"save-text-prompt",textPrompt,listOf(textSelection))
            val fixedText=store.freeze("text-challenge",textDraft.getLong("revision"),"freeze-text");val textRepresentation=fixedText.getJSONArray("representations").getJSONObject(0)
            assertArrayEquals(textBytes,store.readObjectBytes(fixedText.getString("token"),textRepresentation.getString("objectId")))
            assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.update",DocumentsContract.getDocumentId(textUri),Bundle().apply{putByteArray("bytes","已修改原件，唯一校验码：CHANGED9".toByteArray(Charsets.UTF_8))})
            wire.call("send",JSONObject().put("id","text-challenge").put("inputToken",fixedText.getString("token")).put("actionId","explicit-text-challenge"))
            until(90000){val value=wire.call("open",JSONObject().put("id","text-challenge"));if(value.getString("phase")=="failed")error(value.optString("reason"));value.getString("phase")=="done"}
            val textHistory=wire.call("history",JSONObject().put("id","text-challenge"));val textAnswer=textHistory.getJSONArray("items").getJSONObject(1).getString("text")
            assertTrue("Model must read the undisclosed frozen UTF-8 challenge",textAnswer.contains(textCode))
            assertTrue(textHistory.getJSONArray("items").getJSONObject(0).getString("text").contains(fullText))
            val textState=wire.state();val textInput=textState.getJSONObject("metrics").getJSONObject("lastInput");val textParts=textInput.getJSONArray("textParts")
            assertTrue("Actual SDK serialized text contains every original UTF-8 byte",(0 until textParts.length()).any{val part=textParts.getJSONObject(it);part.getString("sha256")==textRepresentation.getString("sha256")&&part.getInt("byteLength")==textBytes.size})
            assertEquals(0,textInput.getJSONArray("images").length());assertEquals(1,textState.getJSONObject("metrics").getInt("modelRequests"))
            wire.closeHost();wire.close();wire=Wire("models",run);wire.ready()
            assertEquals(history.toString(),wire.call("history",JSONObject().put("id","image-challenge")).toString());assertEquals(textHistory.toString(),wire.call("history",JSONObject().put("id","text-challenge")).toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            evidence("real-fixed-text",JSONObject().put("challenge",textCode).put("answer",textAnswer).put("frozen",fixedText).put("requestInput",textInput).put("originalChangedAfterFreeze",true).put("completeUtf8IncludingBom",true).put("requestsBeforeSend",0).put("explicitRequests",1).put("reopenRequests",0))
        }finally{store.close();try{wire.closeHost()}finally{wire.close()}}
    }

    /** Opt-in: root drives the actual system picker while this instrumented case waits. */
    @Test(timeout=240000) fun actualSystemPickerImportsSyntheticText(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("systemPicker")=="true")
        val run=UUID.randomUUID().toString();val wire=Wire("fixture",run);var page:ActivityScenario<AgentActivity>?=null;val store=NativeInputStore(context,"input-$run")
        try{
            val external=InstrumentationRegistry.getArguments().getString("pickerSource")=="external"
            val bytes=if(external)ExternalInputFixture.TEXT_BYTES else "系统选择器测试资料：完整 UTF-8 正文 🌍\n".toByteArray(Charsets.UTF_8)
            if(external){ExternalInputFixture.control(context,"reset");ExternalInputFixture.control(context,"revoke")}else source(bytes,"text/plain","input-test.txt")
            wire.ready();create(wire,"picker-draft");page=scenario("fixture",run);open(page,"picker-draft");click(page,"[data-testid=add-attachment]")
            js(page,"[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent==='选择文件').click()")
            evidence("picker-waiting",JSONObject().put("rootTitle",if(external)"DurableAgent 外部测试资料"else"DurableAgent 测试资料").put("filename",if(external)"fixture-note.txt"else"input-test.txt"))
            var draft=JSONObject();until(150000){draft=store.read("picker-draft");draft.getJSONArray("selections").length()==1&&draft.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state")=="ready"}
            val frozen=store.freeze("picker-draft",draft.getLong("revision"),"picker-freeze")
            assertArrayEquals(bytes,store.readObjectBytes(frozen.getString("token"),frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")))
            assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"));evidence("actual-picker-ready",JSONObject().put("draft",draft).put("persistedReadGrants",context.contentResolver.persistedUriPermissions.count{it.isReadPermission}).put("modelRequests",0))
        }finally{page?.close();store.close();try{wire.closeHost()}finally{wire.close()}}
    }
}
