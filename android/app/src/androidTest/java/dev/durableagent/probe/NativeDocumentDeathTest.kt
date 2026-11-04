package dev.durableagent.probe

import android.content.*
import android.net.Uri
import android.os.*
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Two root-orchestrated phases. Only root kills the dedicated synthetic writer process. */
@RunWith(AndroidJUnit4::class)
class NativeDocumentDeathTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private val changed="written before host death\n".toByteArray()
    private val original=byteArrayOf(83,65,70,0,10,255.toByte(),65,66,67)
    private fun run():String {
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeDeath")=="true")
        return InstrumentationRegistry.getArguments().getString("documentDeathRun")?.takeIf{it.matches(Regex("[A-Za-z0-9-]{1,60}"))}?:error("Root must supply a fixed documentDeathRun")
    }
    private fun control(operation:String):JSONObject {
        val reply=CompletableFuture<JSONObject>()
        context.sendOrderedBroadcast(Intent().setComponent(ComponentName(NativeDocumentTest.FIXTURE,NativeDocumentTest.FIXTURE+".ControlReceiver")).putExtra("operation",operation).putExtra("targetPackage",context.packageName),null,
            object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(resultCode==0)reply.complete(JSONObject(resultData?:"{}"))else reply.completeExceptionally(IllegalStateException("Fixture $operation failed: $resultCode"))}},Handler(Looper.getMainLooper()),-99,null,null)
        return reply.get(10,TimeUnit.SECONDS)
    }
    private fun evidence(value:JSONObject)=instrument.sendStatus(0,Bundle().apply{putString("documentEvidence",value.toString())})
    private fun seed(namespace:String){NativeInputStore(context,namespace).use{store->store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic native writer death")
        .put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic document"))
        .put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),
        JSONObject().put("version","document-fixture-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",org.json.JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}}
    @Test(timeout=180000) fun originalChangedThenWaitForRootToKillWriterBeforeReadback(){
        val run=run();val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=Uri.parse("content://"+NativeDocumentTest.FIXTURE+".documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires a genuine previous picker grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val namespace="document-death-$run";val inputs="input-document-$run";val operation="death-$run";seed(inputs)
        NativeDocumentStore(context,namespace,inputs).use{store->
            val selected=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val receipt=store.prepare(JSONObject().put("operationId",operation).put("resourceId",selected.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101)
                .put("expectedDigest",NativeInputStore.sha256(original)).put("contentDigest",NativeInputStore.sha256(changed)).put("byteLength",changed.size))
            store.stage(JSONObject().put("operationId",operation).put("offset",0).put("base64",Base64.encodeToString(changed,Base64.NO_WRAP)))
            NativeDocumentAccess(context,namespace,inputs).use{channel->
                control("hold-readback-long")
                try{
                    val admitted=JSONObject(channel.beginJson("start",JSONObject().put("operationId",operation).put("requestDigest",receipt.getString("requestDigest")).toString()))
                    assertTrue(admitted.toString(),admitted.getBoolean("ok"))
                    val end=SystemClock.elapsedRealtime()+10000
                    while(true){val actual=control("read");if(actual.getInt("writeOpens")==1&&Base64.decode(actual.getString("base64"),Base64.DEFAULT).contentEquals(changed))break;assertTrue("Actual original effect must precede kill window",SystemClock.elapsedRealtime()<end);Thread.sleep(20)}
                    val running=store.query(operation);assertEquals("running",running.getString("state"));assertFalse(running.getBoolean("scopeConfirmed"))
                    evidence(JSONObject().put("stage","kill-window-original-modified").put("run",run).put("writerPid",android.os.Process.myPid()).put("receipt",running).put("providerUid",fixture.getInt("providerUid")))
                    Thread.sleep(125000)
                    fail("Root did not kill this dedicated writer in its actual held readback window")
                }finally{control("release")}
            }
        }
    }
    @Test(timeout=30000) fun reopenedUnknownIsNotReleasedByMatchingBytesAndNeverRewrites(){
        val run=run();control("release")
        val namespace="document-death-$run";val inputs="input-document-$run";val operation="death-$run"
        NativeDocumentStore(context,namespace,inputs).use{store->
            val unknown=store.query(operation)
            assertEquals("unknown",unknown.getString("state"));assertFalse(unknown.getBoolean("scopeConfirmed"));assertEquals("DOCUMENT_HOST_LOST",unknown.getString("reason"))
            assertArrayEquals(changed,Base64.decode(control("read").getString("base64"),Base64.DEFAULT));assertEquals(1,control("read").getInt("writeOpens"))
            val attempted=store.start(JSONObject().put("operationId",operation).put("requestDigest",unknown.getString("requestDigest")))
            assertEquals("unknown",attempted.getString("state"));assertFalse(attempted.getBoolean("scopeConfirmed"))
            val observed=store.verify(operation)
            assertEquals("unknown",observed.getString("state"));assertFalse(observed.getBoolean("scopeConfirmed"))
            assertEquals(unknown.getLong("sequence"),observed.getLong("sequence"))
            assertEquals("read",observed.getJSONObject("verification").getString("status"));assertTrue(observed.getJSONObject("verification").getBoolean("matchesContent"))
            assertEquals(NativeInputStore.sha256(changed),observed.getJSONObject("verification").getString("currentDigest"))
            NativeInputStore(context,inputs).use{native->val indexed=native.requireEffect(operation);assertEquals("unknown",indexed.getString("state"));assertFalse(indexed.getBoolean("scopeConfirmed"))}
            assertEquals(1,control("read").getInt("writeOpens"));assertArrayEquals(changed,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
            evidence(JSONObject().put("stage","reopened-unknown-original-matches-no-rewrite").put("receipt",observed))
        }
    }
}
