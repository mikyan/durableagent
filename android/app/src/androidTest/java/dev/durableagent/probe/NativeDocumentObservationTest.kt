package dev.durableagent.probe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real bundled React/native bridge and real Node busy loop. No model request is needed. */
@RunWith(AndroidJUnit4::class)
class NativeDocumentObservationTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private fun until(timeout:Long=60000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!check()){assertTrue("Document observation timed out",SystemClock.elapsedRealtime()<end);Thread.sleep(25)}}
    private inner class Wire(run:String):AutoCloseable {
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val states=LinkedBlockingQueue<JSONObject>();private val busy=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,"fixture",run){what,text->val value=JSONObject(text);when(what){12->states.offer(value);35->busy.offer(value);10->replies.remove(value.optString("requestId"))?.complete(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {val id=UUID.randomUUID().toString();val result=CompletableFuture<JSONObject>();replies[id]=result;client.post(JSONObject().put("protocol",1).put("connectionId","document-observer").put("requestId",id).put("method",method).put("payload",payload).toString());val reply=result.get(30,TimeUnit.SECONDS);assertTrue(reply.toString(),reply.getBoolean("ok"));return reply.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(10,TimeUnit.SECONDS)?:error("Host state timeout")}
        fun busy():JSONObject{busy.clear();client.control(35);return busy.poll(3,TimeUnit.SECONDS)?:error("Native busy barrier timeout")}
        fun closeHost(){client.control(20,"close");until(20000){state().optString("phase")=="closed"}}
        override fun close(){client.disconnect()}
    }
    private fun js(page:ActivityScenario<AgentActivity>,script:String):String{val result=CompletableFuture<String>();page.onActivity{it.webView!!.evaluateJavascript(script){reply->result.complete(reply)}};return result.get(5,TimeUnit.SECONDS)}
    @Test(timeout=120000) fun originalPanelAndReceiptRespondWhileActualNodeOwnerIsBusy(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val uri=Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires genuine prior picker grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val wire=Wire(run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","fixture").putExtra("validationRun",run))
        try{
            until{val state=wire.state();check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"}
            until{js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}
            until{js(page,"document.querySelector('[data-testid=create-conversation]')?.disabled===false")=="true"}
            js(page,"document.querySelector('[data-testid=create-conversation]').click()")
            var product=JSONObject();until{val rows=wire.call("list").getJSONArray("conversations");if(rows.length()!=1)false else{product=rows.getJSONObject(0);true}}
            val id=product.getString("id");val snapshot=wire.call("open",JSONObject().put("id",id));val conversation=snapshot.getJSONObject("conversation")
            val adopted=conversation.getJSONObject("submissionContext")
            NativeInputStore(context,"input-$run").use{it.rememberConversation(conversation,JSONObject().put("version","document-observer-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}
            val operation="observation-$run"
            val expected=NativeDocumentStore(context,"document-$run","input-$run").use{store->
                val original=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                val reader=store.open(original.getString("resourceId"));assertTrue(store.closeRead(reader.getString("readerId")).getBoolean("unchanged"))
                val prepared=store.prepare(JSONObject().put("operationId",operation).put("resourceId",original.getString("resourceId")).put("productId",id).put("controlGeneration",1).put("sdkConversationId",adopted.getLong("sdkConversationId"))
                    .put("expectedDigest",reader.getString("contentDigest")).put("contentDigest",NativeInputStore.sha256(byteArrayOf())).put("byteLength",0))
                store.cancel(JSONObject().put("operationId",operation).put("requestDigest",prepared.getString("requestDigest")))
            }
            until{js(page,"Boolean(document.querySelector('.original-documents summary'))")=="true"}
            val request=JSONObject().put("protocol",1).put("connectionId","native-document-observation").put("requestId","receipt-while-busy").put("method","document.query").put("payload",JSONObject().put("operationId",operation))
            js(page,"window.__originalReceipt=null;{const previous=window.__durableReceive;window.__durableReceive=value=>{if(value.requestId==='receipt-while-busy')window.__originalReceipt=value;previous(value)}}")
            wire.client.control(34,"15000");until(5000){val value=wire.busy();value.getLong("started")>0&&value.getLong("ended")==0L}
            js(page,"document.querySelector('.original-documents summary').click();window.DurableNative.postMessage("+JSONObject.quote(request.toString())+")")
            until(6000){js(page,"Boolean(window.__originalReceipt&&document.querySelector('[data-testid=original-document]'))")=="true"}
            val barrier=wire.busy();assertEquals("Native observation must finish before actual Node loop ends",0L,barrier.getLong("ended"))
            val response=JSONObject(JSONTokener(js(page,"JSON.stringify(window.__originalReceipt)")).nextValue() as String);assertTrue(response.toString(),response.getBoolean("ok"))
            assertEquals(expected.toString(),response.getJSONObject("value").toString())
            val panel=JSONTokener(js(page,"document.querySelector('[data-testid=original-document]').innerText")).nextValue() as String
            assertTrue(panel.contains("original.bin"));assertTrue(panel.contains("原件"));assertTrue(panel.contains(uri.toString()))
            instrument.sendStatus(0,Bundle().apply{putString("documentEvidence",JSONObject().put("stage","native-original-observation-while-node-busy").put("run",run).put("barrier",barrier).put("receipt",response.getJSONObject("value")).put("panel",panel).toString())})
            until(20000){wire.busy().getLong("ended")>0};assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
        }finally{page.close();try{wire.closeHost()}finally{wire.close()}}
    }
}
