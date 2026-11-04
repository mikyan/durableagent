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
    @Test(timeout=30000) fun originalTextChangesExposeCanonicalBoundedDiffFromActualBytes(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"));control("replace")
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires actual previous system-picker grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val namespace="document-diff-$run";val inputs="input-document-$run"
        NativeInputStore(context,inputs).use{store->store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic actual text diff")
            .put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic document"))
            .put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),
            JSONObject().put("version","document-fixture-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",org.json.JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}
        NativeDocumentStore(context,namespace,inputs).use{store->
            val selected=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            fun write(id:String,before:ByteArray,after:ByteArray):JSONObject {
                val prepared=store.prepare(JSONObject().put("operationId",id).put("resourceId",selected.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101)
                    .put("expectedDigest",NativeInputStore.sha256(before)).put("contentDigest",NativeInputStore.sha256(after)).put("byteLength",after.size))
                store.stage(JSONObject().put("operationId",id).put("offset",0).put("base64",Base64.encodeToString(after,Base64.NO_WRAP)))
                val receipt=store.start(JSONObject().put("operationId",id).put("requestDigest",prepared.getString("requestDigest")))
                assertEquals("completed",receipt.getString("state"));assertTrue(receipt.getBoolean("scopeConfirmed"))
                assertArrayEquals(after,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
                return receipt
            }
            val changed="changed\n".toByteArray()
            val small=write("small-$run","NEW\n".toByteArray(),changed);val difference=small.getJSONObject("diff")
            evidence(JSONObject().put("stage","actual-text-diff-before-protocol-check").put("receipt",small))
            assertTrue("Available diff requires canonical boolean",difference.getBoolean("available"))
            assertEquals("--- original\n+++ updated\n-NEW\n-\n+changed\n+",difference.getString("text"))
            val large=write("large-$run",changed,"x".repeat(17000).toByteArray());val bounded=large.getJSONObject("diff")
            assertFalse(bounded.getBoolean("available"));assertEquals("text_budget",bounded.getString("reason"));assertFalse(bounded.has("text"))
            assertEquals(small.toString(),store.query("small-$run").toString())
            evidence(JSONObject().put("stage","actual-text-diff-bounded").put("small",small).put("large",large).put("providerUid",fixture.getInt("providerUid")))
        }
    }
    @Test(timeout=30000) fun revokedUriGrantBlocksFreshReadsAndFurtherUseOfAnOpenedReader(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val granted=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires an actual prior picker grant; reacquire it before repeating this trace",granted?.isReadPermission==true&&granted.isWritePermission)
        NativeDocumentStore(context,"document-revoked-"+UUID.randomUUID()).use{store->
            val selected=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val id=selected.getString("resourceId");val opened=store.open(id);val reader=opened.getString("readerId")
            ParcelFileDescriptor.AutoCloseInputStream(context.contentResolver.openFileDescriptor(uri,"r")!!).use{platformProbe->
                control("revoke")
                assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,context.checkUriPermission(uri,android.os.Process.myPid(),android.os.Process.myUid(),Intent.FLAG_GRANT_READ_URI_PERMISSION))
                val platformBytes=try{platformProbe.readBytes()}catch(_:Exception){null}
                evidence(JSONObject().put("stage","actual-grant-revoked").put("platformHeldFdStillReadable",platformBytes?.contentEquals(expected)==true).put("applicationPolicy","reject-further-original-reads-after-current-uri-grant-revocation"))
                assertEquals("permission_required",store.describe(id).getString("availability"))
                fun denied(action:()->Unit){try{action();fail("Application original capability must reject reads after current URI grant revocation")}
                    catch(error:NativeDocumentException){assertEquals("DOCUMENT_PERMISSION_REQUIRED",error.code)}}
                denied{store.open(id)}
                denied{store.read(id,0,32768)}
                denied{store.readReader(reader,0,32768)}
                denied{store.closeRead(reader)}
                assertArrayEquals(expected,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
                evidence(JSONObject().put("stage","revoked-capability-denied-including-held-reader").put("resourceId",id))
            }
        }
    }
    @Test(timeout=30000) fun trustedJavetChannelReadsActualOriginalThroughBoundedRequests(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires an actual previous system-picker persisted grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val namespace="document-channel-$run"
        val resource=NativeDocumentStore(context,namespace).use{it.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)}
        NativeDocumentAccess(context,namespace,"input-document-$run").use{access->
            com.caoccao.javet.interop.V8Host.getNodeI18nInstance().createV8Runtime<com.caoccao.javet.interop.NodeRuntime>().use{runtime->
                runtime.createV8ValueObject().use{value->value.bind(access);runtime.globalObject.set("__nativeDocuments",value)}
                fun request(method:String,payload:JSONObject):JSONObject {
                    val begun=JSONObject(runtime.getExecutor("__nativeDocuments.beginJson("+JSONObject.quote(method)+","+JSONObject.quote(payload.toString())+")").executeString())
                    assertTrue("Trusted original channel must admit the real capability: $begun",begun.getBoolean("ok"))
                    val token=begun.getJSONObject("value").getString("operationId");var result:JSONObject?=null
                    until("Native original channel response",10000){
                        val polled=JSONObject(runtime.getExecutor("__nativeDocuments.pollJson("+JSONObject.quote(token)+")").executeString())
                        assertTrue(polled.toString(),polled.getBoolean("ok"));val value=polled.getJSONObject("value")
                        if(!value.getBoolean("pending")){result=value.getJSONObject("result");true}else false
                    }
                    assertTrue(result.toString(),result!!.getBoolean("ok"));return result!!.getJSONObject("value")
                }
                val opened=request("open",JSONObject().put("resourceId",resource.getString("resourceId")))
                val body=request("read",JSONObject().put("readerId",opened.getString("readerId")).put("offset",0).put("maxBytes",32768))
                assertArrayEquals(expected,Base64.decode(body.getString("base64"),Base64.DEFAULT));assertTrue(body.getBoolean("eof"))
                val closed=request("closeRead",JSONObject().put("readerId",opened.getString("readerId")))
                assertTrue(closed.getBoolean("unchanged"));assertEquals(opened.getString("contentDigest"),closed.getString("currentDigest"))
                evidence(JSONObject().put("stage","actual-javet-native-original-read").put("resourceId",resource.getString("resourceId")).put("digest",closed.getString("currentDigest")))
            }
        }
    }
    @Test(timeout=45000) fun cancellationProvesNoStartOnlyBeforeOriginalIoAndKeepsActiveScopeUnconfirmed(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires an actual previous system-picker persisted grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val namespace="document-cancel-$run";val inputs="input-document-$run"
        NativeInputStore(context,inputs).use{store->store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic original cancel")
            .put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic document"))
            .put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),
            JSONObject().put("version","document-fixture-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",org.json.JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}
        NativeDocumentStore(context,namespace,inputs).use{store->
            val resource=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val changed="changed\n".toByteArray()
            fun prepare(id:String):JSONObject {
                val plan=store.prepare(JSONObject().put("operationId",id).put("resourceId",resource.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101)
                    .put("expectedDigest",NativeInputStore.sha256(expected)).put("contentDigest",NativeInputStore.sha256(changed)).put("byteLength",changed.size))
                store.stage(JSONObject().put("operationId",id).put("offset",0).put("base64",Base64.encodeToString(changed,Base64.NO_WRAP)))
                return JSONObject().put("operationId",id).put("requestDigest",plan.getString("requestDigest"))
            }
            val queued=prepare("queued-$run")
            val cancelled=store.cancel(queued)
            assertEquals("not_started",cancelled.getString("state"));assertTrue(cancelled.getBoolean("scopeConfirmed"))
            assertEquals(cancelled.toString(),store.start(queued).toString())
            assertEquals(0,control("read").getInt("writeOpens"));assertArrayEquals(expected,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
            NativeInputStore(context,inputs).use{native->val indexed=native.requireEffect(queued.getString("operationId"));assertEquals("not_started",indexed.getString("state"));assertTrue(indexed.getBoolean("scopeConfirmed"))}
            val active=prepare("active-$run");control("hold-readback")
            val pending=CompletableFuture.supplyAsync{store.start(active)}
            try{
                until("Independent Provider sees original effect before readback",10000){val actual=control("read");actual.getInt("writeOpens")==1&&Base64.decode(actual.getString("base64"),Base64.DEFAULT).contentEquals(changed)}
                assertFalse(pending.isDone)
                assertEquals("running",store.query(active.getString("operationId")).getString("state"))
                val stopping=store.cancel(active)
                assertEquals("stop_requested",stopping.getString("state"));assertFalse(stopping.getBoolean("scopeConfirmed"))
                assertFalse(store.query(active.getString("operationId")).getBoolean("scopeConfirmed"))
                control("release")
                val completed=pending.get(10,TimeUnit.SECONDS)
                assertEquals("completed",completed.getString("state"));assertTrue(completed.getBoolean("scopeConfirmed"))
                assertEquals(1,control("read").getInt("writeOpens"))
                evidence(JSONObject().put("stage","queued-no-start-active-unconfirmed").put("queued",cancelled).put("activeWhileHeld",stopping).put("afterActualReadback",completed))
            }finally{control("release");pending.get(10,TimeUnit.SECONDS)}
        }
    }
    @Test(timeout=30000) fun originalWriteHasImmutableIdentityAndIndependentReadbackAfterReopen(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires an actual previous system-picker persisted grant",grant?.isReadPermission==true&&grant.isWritePermission)
        val run=UUID.randomUUID().toString();val namespace="document-write-$run";val inputs="input-document-$run"
        NativeInputStore(context,inputs).use{store->store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic original write")
            .put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic document"))
            .put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),
            JSONObject().put("version","document-fixture-1").put("provider","fixture").put("modelId","test").put("source","validation").put("input",org.json.JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))}
        val changed="changed\n".toByteArray();val operation="write-$run";lateinit var fixed:JSONObject
        NativeDocumentStore(context,namespace,inputs).use{store->
            val selected=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val resourceId=selected.getString("resourceId");val opened=store.open(resourceId);assertTrue(store.closeRead(opened.getString("readerId")).getBoolean("unchanged"))
            val plan=JSONObject().put("operationId",operation).put("resourceId",resourceId).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101)
                .put("expectedDigest",opened.getString("contentDigest")).put("contentDigest",NativeInputStore.sha256(changed)).put("byteLength",changed.size)
            val accepted=store.prepare(plan);assertEquals("accepted_not_started",accepted.getString("state"));assertFalse(accepted.getBoolean("scopeConfirmed"))
            assertTrue(accepted.getString("requestDigest").matches(Regex("[a-f0-9]{64}")))
            assertEquals(accepted.toString(),store.prepare(plan).toString())
            try{store.prepare(JSONObject(plan.toString()).put("expectedDigest","0".repeat(64)));fail("Operation identity must be immutable")}
            catch(error:NativeDocumentException){assertEquals("DOCUMENT_OPERATION_CONFLICT",error.code)}
            val first=JSONObject().put("operationId",operation).put("offset",0).put("base64",Base64.encodeToString(changed.copyOfRange(0,2),Base64.NO_WRAP))
            assertEquals(2,store.stage(first).getInt("nextOffset"))
            val staged=store.stage(JSONObject().put("operationId",operation).put("offset",2).put("base64",Base64.encodeToString(changed.copyOfRange(2,changed.size),Base64.NO_WRAP)))
            assertEquals(changed.size,staged.getInt("nextOffset"));assertTrue(staged.getBoolean("sealed"))
            assertTrue(store.stage(first).getBoolean("sealed"))
            store.start(JSONObject().put("operationId",operation).put("requestDigest",accepted.getString("requestDigest")))
            until("Original write receipt",10000){store.query(operation).optString("state") in setOf("completed","not_started","unknown")}
            fixed=store.query(operation)
            assertEquals("completed",fixed.getString("state"));assertTrue(fixed.getBoolean("scopeConfirmed"));assertTrue(fixed.getBoolean("original"))
            for(key in listOf("operationId","resourceId","productId","controlGeneration","sdkConversationId","expectedDigest","contentDigest","byteLength"))assertEquals(plan.get(key),fixed.get(key))
            assertEquals(accepted.getString("requestDigest"),fixed.getString("requestDigest"));assertEquals(selected.getString("namespace"),fixed.getString("namespace"));assertEquals(uri.toString(),fixed.getString("uri"))
            assertEquals("unavailable",fixed.getJSONObject("diff").getString("state"))
            assertArrayEquals(changed,Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
        }
        NativeDocumentStore(context,namespace,inputs).use{store->
            assertEquals(fixed.toString(),store.query(operation).toString())
            control("replace")
            assertEquals(fixed.toString(),store.start(JSONObject().put("operationId",operation).put("requestDigest",fixed.getString("requestDigest"))).toString())
            assertArrayEquals(byteArrayOf(78,69,87,10),Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
            evidence(JSONObject().put("stage","original-write-immutable-reopened").put("receipt",fixed).put("providerUid",fixture.getInt("providerUid")))
        }
    }
    @Test(timeout=30000) fun retainedReaderStaysOnOriginalObjectAfterProviderReplacement(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("retainedGrant")=="true")
        val fixture=control("reset");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
        val uri=android.net.Uri.parse("content://$FIXTURE.documents/document/original")
        val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        assertTrue("Requires an actual previous system-picker persisted grant",grant?.isReadPermission==true&&grant.isWritePermission)
        NativeDocumentStore(context,"document-reader-"+UUID.randomUUID()).use{store->
            val resource=store.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val id=resource.getString("resourceId");val opened=store.open(id);val reader=opened.getString("readerId")
            assertEquals(9,opened.getInt("byteLength"))
            assertArrayEquals(expected.copyOfRange(0,4),Base64.decode(store.readReader(reader,0,4).getString("base64"),Base64.DEFAULT))
            control("replace")
            assertArrayEquals(byteArrayOf(78,69,87,10),Base64.decode(control("read").getString("base64"),Base64.DEFAULT))
            val tail=store.readReader(reader,4,32768)
            assertTrue(tail.getBoolean("eof"));assertEquals(5,tail.getInt("bytesRead"))
            assertArrayEquals(expected.copyOfRange(4,9),Base64.decode(tail.getString("base64"),Base64.DEFAULT))
            val final=store.closeRead(reader)
            assertTrue(final.getBoolean("unchanged"));assertEquals(opened.getString("contentDigest"),final.getString("currentDigest"))
            try{store.readReader(reader,0,10);fail("A lost reader must not silently reopen the URI")}
            catch(error:NativeDocumentException){assertEquals("DOCUMENT_READER_LOST",error.code)}
            val replacement=store.open(id);assertNotEquals(opened.getString("contentDigest"),replacement.getString("contentDigest"))
            assertArrayEquals(byteArrayOf(78,69,87,10),Base64.decode(store.readReader(replacement.getString("readerId"),0,10).getString("base64"),Base64.DEFAULT))
            assertTrue(store.closeRead(replacement.getString("readerId")).getBoolean("unchanged"))
            evidence(JSONObject().put("stage","retained-reader-original-inode").put("oldDigest",opened.getString("contentDigest")).put("newDigest",replacement.getString("contentDigest")).put("providerUid",fixture.getInt("providerUid")))
        }
    }
    @Test(timeout=240000) fun actualSystemPickerRetainsOriginalCapabilityAndBinaryBytesAcrossReopen(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("systemPicker")=="true")
        val fixture=control(if(InstrumentationRegistry.getArguments().getString("sharedOriginal")=="true")"create-shared" else "reset");control("revoke");assertNotEquals(android.os.Process.myUid(),fixture.getInt("providerUid"))
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
            evidence(JSONObject().put("stage","original-retained").put("resource",resource).put("providerUid",fixture.getInt("providerUid")).put("appUid",android.os.Process.myUid()).put("binaryBytes",expected.size).put("shared",fixture.optJSONObject("shared")))
        }finally{page.close()}
    }
    companion object {const val FIXTURE="dev.durableagent.documentsfixture"}
}
