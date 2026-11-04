package dev.durableagent.probe

import android.content.*
import android.os.*
import android.util.Base64
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
import java.util.concurrent.TimeUnit

/** Real system picker, persisted platform grant and independently owned synthetic original. */
@RunWith(AndroidJUnit4::class)
class NativeDocumentTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private val expected=byteArrayOf(83,65,70,0,10,255.toByte(),65,66,67)
    private fun control(operation:String):JSONObject {
        val reply=CompletableFuture<JSONObject>()
        context.sendOrderedBroadcast(Intent().setComponent(ComponentName(FIXTURE,"$FIXTURE.ControlReceiver")).putExtra("operation",operation).putExtra("targetPackage",context.packageName),null,
            object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(resultCode==0)reply.complete(JSONObject(resultData?:"{}"))else reply.completeExceptionally(IllegalStateException("Fixture $operation failed: $resultCode"))}},
            Handler(Looper.getMainLooper()),-99,null,null)
        return reply.get(10,TimeUnit.SECONDS)
    }
    private fun js(page:ActivityScenario<AgentActivity>,script:String):String {
        val reply=CompletableFuture<String>();page.onActivity{it.webView!!.evaluateJavascript(script){value->reply.complete(value)}}
        return reply.get(5,TimeUnit.SECONDS)
    }
    private fun until(label:String,timeout:Long=150000,check:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!check()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(50)}}
    private fun evidence(value:JSONObject)=instrument.sendStatus(0,Bundle().apply{putString("documentEvidence",value.toString())})
    @Test(timeout=240000) fun actualSystemPickerRetainsOriginalCapabilityAndBinaryBytesAcrossReopen(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("systemPicker")=="true")
        val fixture=control("reset");control("revoke");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        assertArrayEquals(expected,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
        val run=UUID.randomUUID().toString();val namespace=NativeDocumentBridge.namespace("input-only",run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","input-only").putExtra("validationRun",run))
        try{
            until("Bundled page ready",15000){js(page,"Boolean(window.DurableNative&&window.__durableReceive)")=="true"}
            val request=JSONObject().put("protocol",1).put("connectionId","document-picker").put("requestId","select-original").put("method","document.select").put("payload",JSONObject())
            js(page,"window.__documentResult=null;window.__documentPrevious=window.__durableReceive;window.__durableReceive=function(value){if(value.requestId==='select-original')window.__documentResult=value;window.__documentPrevious?.(value)};window.DurableNative.postMessage("+JSONObject.quote(request.toString())+")")
            evidence(JSONObject().put("stage","picker-waiting").put("rootTitle","DurableAgent 原文件测试").put("filename","original.bin").put("run",run))
            until("Actual system selection returned"){js(page,"Boolean(window.__documentResult)")=="true"}
            val encoded=js(page,"JSON.stringify(window.__documentResult)")
            val result=JSONObject(org.json.JSONTokener(encoded).nextValue() as String)
            assertTrue("Original selection must retain real capability: $result",result.getBoolean("ok"))
            val resource=result.getJSONObject("value");val resourceId=resource.getString("resourceId")
            assertTrue(resource.getBoolean("original"));assertEquals("saf",resource.getString("source"))
            assertEquals("content://$FIXTURE.documents/document/original",resource.getString("uri"))
            assertTrue(resource.getJSONObject("grant").getBoolean("persistedRead"));assertTrue(resource.getJSONObject("grant").getBoolean("persistedWrite"))
            NativeDocumentStore(context,namespace).use{store->assertArrayEquals(expected,Base64.decode(store.read(resourceId,0,32768).getString("base64"),Base64.DEFAULT))}
            NativeDocumentStore(context,namespace).use{store->
                assertEquals(1,store.list().getJSONArray("resources").length())
                assertEquals(resourceId,store.describe(resourceId).getString("resourceId"))
                assertArrayEquals(expected,Base64.decode(store.read(resourceId,0,32768).getString("base64"),Base64.DEFAULT))
            }
            assertArrayEquals(expected,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
            evidence(JSONObject().put("stage","original-retained").put("resource",resource).put("providerUid",fixture.getInt("providerUid")).put("appUid",android.os.Process.myUid()).put("binaryBytes",expected.size))
        }finally{page.close()}
    }
    companion object {const val FIXTURE="dev.durableagent.documentsfixture"}
}
