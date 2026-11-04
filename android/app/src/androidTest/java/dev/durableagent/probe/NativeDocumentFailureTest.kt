package dev.durableagent.probe

import android.content.*
import android.net.Uri
import android.os.*
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeDocumentFailureTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private val expected=byteArrayOf(83,65,70,0,10,255.toByte(),65,66,67)
    private val fixture="dev.durableagent.documentsfixture"
    private val uri=Uri.parse("content://$fixture.documents/document/original")
    private fun control(operation:String):JSONObject {
        val result=CompletableFuture<JSONObject>()
        context.sendOrderedBroadcast(Intent().setComponent(ComponentName(fixture,"$fixture.ControlReceiver")).putExtra("operation",operation).putExtra("targetPackage",context.packageName),null,
            object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(resultCode==0)result.complete(JSONObject(resultData?:"{}"))else result.completeExceptionally(IllegalStateException("Synthetic control failed: $operation"))}},Handler(Looper.getMainLooper()),-99,null,null)
        return result.get(10,TimeUnit.SECONDS)
    }
    private fun failure(code:String,action:()->Unit){try{action();fail("Expected explicit $code") }catch(error:NativeDocumentException){assertEquals(code,error.code)}}
    @Test(timeout=45000) fun actualProviderFailuresAndChangedOriginalNeverBecomeCachedSuccess(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val initial=control("reset");assertNotEquals(Process.myUid(),initial.getInt("providerUid"))
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires a genuine prior picker grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val inputs="input-document-$run"
        NativeInputStore(context,inputs).use{store->store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic Provider failures")
            .put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic document"))
            .put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),
            JSONObject().put("version","document-fixture-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}
        NativeDocumentStore(context,"document-failure-$run",inputs).use{store->
            val selected=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION);val id=selected.getString("resourceId")
            try{
                control("move-away")
                assertEquals("not_found",store.describe(id).getString("availability"));failure("DOCUMENT_NOT_FOUND"){store.open(id)}
                control("reset");control("fault-unavailable")
                assertEquals("unavailable",store.describe(id).getString("availability"));failure("DOCUMENT_UNAVAILABLE"){store.open(id)}
                control("fault-pipe");failure("DOCUMENT_UNSUPPORTED"){store.open(id)}
                control("fault-clear")
                val bytes="must not overwrite\n".toByteArray()
                fun prepare(name:String):JSONObject {
                    val plan=store.prepare(JSONObject().put("operationId",name).put("resourceId",id).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101)
                        .put("expectedDigest",NativeInputStore.sha256(expected)).put("contentDigest",NativeInputStore.sha256(bytes)).put("byteLength",bytes.size))
                    store.stage(JSONObject().put("operationId",name).put("offset",0).put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)))
                    return JSONObject().put("operationId",name).put("requestDigest",plan.getString("requestDigest"))
                }
                val unsupported=prepare("unsupported-$run");control("fault-readonly")
                val rejected=store.start(unsupported);assertEquals("not_started",rejected.getString("state"));assertTrue(rejected.getBoolean("scopeConfirmed"));assertEquals("DOCUMENT_UNSUPPORTED",rejected.getString("reason"))
                assertEquals(0,control("read").getInt("writeOpens"));assertArrayEquals(expected,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
                control("fault-clear");val stale=prepare("stale-$run");control("replace")
                val conflict=store.start(stale);assertEquals("not_started",conflict.getString("state"));assertTrue(conflict.getBoolean("scopeConfirmed"));assertEquals("DOCUMENT_PRECONDITION_CONFLICT",conflict.getString("reason"))
                assertEquals(0,control("read").getInt("writeOpens"));assertArrayEquals("NEW\n".toByteArray(),Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
                assertEquals(conflict.toString(),store.start(stale).toString())
                instrument.sendStatus(0,Bundle().apply{putString("documentEvidence",JSONObject().put("stage","actual-provider-failures-no-write").put("providerUid",initial.getInt("providerUid")).put("unsupported",rejected).put("stale",conflict).put("writeOpens",0).toString())})
            }finally{control("fault-clear")}
        }
    }
}
