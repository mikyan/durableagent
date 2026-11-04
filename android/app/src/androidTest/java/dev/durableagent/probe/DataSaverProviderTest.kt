package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DataSaverProviderTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private fun expect(code:String,action:()->Unit){try{action();fail("Expected $code")}catch(error:NativeInputException){assertEquals(code,error.code)}}
    @Test fun nativeProviderProjectionMakesUndispatchedEvidenceExplicitAcrossReopen(){
        val namespace="provider-dispatch-${UUID.randomUUID()}";val network=DataSaverNetwork("metered",true,true)
        val descriptor=JSONObject().put("kind","metadata").put("documentNamespace","provider-test").put("uri","content://synthetic.documents/document/original")
        NativeDataSaverStore(context,namespace).use{store->
            store.configure(true,0,network)
            val prepared=store.registerProvider("fixed-observation",descriptor,network)
            assertEquals("The native public contract must explicitly prove no dispatch",false,prepared.opt("dispatched"));assertEquals("waiting",prepared.getString("phase"))
        }
        NativeDataSaverStore(context,namespace).use{store->
            val reopened=store.decision("fixed-observation",network)
            assertEquals(false,reopened.opt("dispatched"))
            val granted=store.grant("fixed-observation",reopened.getString("requestDigest"),reopened.getLong("period"),network)
            assertEquals(false,granted.opt("dispatched"));assertEquals("granted",granted.getString("phase"))
            assertEquals(true,store.requireStart("fixed-observation",granted.getString("finalDigest"),network).opt("dispatched"))
        }
        NativeDataSaverStore(context,namespace).use{store->assertEquals("A reopened dispatched scope must not acquire false evidence",true,store.decision("fixed-observation",network).opt("dispatched"))}
    }
    @Test fun oneUnknownProviderObservationWaitsThenReconcilesLostReplyWithoutAnotherIo(){
        val namespace="provider-policy-${UUID.randomUUID()}";val network=DataSaverNetwork("metered",true,true)
        NativeDataSaverStore(context,namespace).use{it.configure(true,0,network)}
        val descriptor=JSONObject().put("kind","metadata").put("documentNamespace","provider-test").put("uri","content://synthetic.documents/document/original")
        var calls=0
        NativeProviderPolicy(context,namespace,{network}).use{policy->
            val prepared=policy.prepare("original-observation",descriptor);assertEquals("waiting",prepared.getString("phase"));assertTrue(prepared.isNull("productId"))
            expect("DATA_SAVER_WAIT"){policy.execute("original-observation"){calls++;JSONObject().put("name","original")}};assertEquals(0,calls)
            policy.grant("original-observation",prepared.getString("requestDigest"),prepared.getLong("period"))
            assertEquals("original",policy.execute("original-observation"){calls++;JSONObject().put("name","original")}.getString("name"));assertEquals(1,calls)
        }
        NativeProviderPolicy(context,namespace,{network}).use{policy->
            assertEquals("original",policy.execute("original-observation"){calls++;error("Completed observation must use its durable result")}.getString("name"));assertEquals(1,calls)
            expect("DATA_SAVER_IDENTITY_CONFLICT"){policy.prepare("original-observation",JSONObject(descriptor.toString()).put("uri","content://synthetic.documents/document/other"))}
        }
    }
    @Test fun selectedOriginalWaitsWithoutReadingProviderAndExplicitResumeKeepsTheSameObservation(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue("Requires the real retained system picker grant",context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission})
        val run=UUID.randomUUID().toString();val namespace="provider-selected-$run";val network=DataSaverNetwork("metered",true,true)
        NativeDataSaverStore(context,namespace).use{it.configure(true,0,network)}
        NativeDocumentStore(context,"document-$run",namespace,{network}).use{documents->
            val selected=documents.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            assertEquals("Selection keeps the real original but does not read Provider metadata while waiting","not-observed",selected.getString("freshness"))
            val pending=selected.getJSONObject("observation");assertEquals("waiting",pending.getString("phase"))
            val id=selected.getString("resourceId");assertEquals(uri.toString(),selected.getString("uri"))
            val cached=documents.list().getJSONArray("resources").getJSONObject(0);assertEquals("cached",cached.getString("freshness"));assertEquals(id,cached.getString("resourceId"))
            val observed=documents.resumeObservation(id,pending.getString("executionId"),pending.getString("requestDigest"),pending.getLong("period"))
            assertEquals("original.bin",observed.getString("displayName"));assertEquals("observed",observed.getString("freshness"));assertEquals("terminal",observed.getJSONObject("observation").getString("phase"))
            val replay=documents.resumeObservation(id,pending.getString("executionId"),pending.getString("requestDigest"),pending.getLong("period"))
            assertEquals("The same observation is a cached result, not a fresh metadata query",observed.getLong("observedAt"),replay.getLong("observedAt"))
        }
    }

    @Test fun aProviderReadRequiresItsOwnGrantAndReopenUsesOnlyTheFixedSnapshot(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue(context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission})
        val expected=context.contentResolver.openInputStream(uri)!!.use{it.readBytes()};assertTrue(expected.size<1024*1024)
        val run=UUID.randomUUID().toString();val input="provider-read-$run";val document="document-$run";val network=DataSaverNetwork("metered",true,true)
        NativeInputStore(context,input).use{it.rememberConversation(JSONObject().put("id","chat").put("title","chat").put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","synthetic")).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","fixture"))),null)}
        var request=JSONObject();var original=JSONObject()
        NativeDocumentStore(context,document,input,{network}).use{store->
            val selected=store.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            NativeDataSaverStore(context,input).use{it.configure(true,0,network)}
            request=JSONObject().put("operationId","fixed-read").put("resourceId",selected.getString("resourceId")).put("owner",JSONObject().put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101).put("taskId",201).put("callId","call").put("bindingId","fixture"))
            val waiting=store.observeRead(request);assertEquals("waiting",waiting.getJSONObject("observation").getString("phase"));assertFalse(waiting.has("snapshot"))
            val decision=waiting.getJSONObject("observation");NativeProviderPolicy(context,input,{network}).use{it.grant("fixed-read",decision.getString("requestDigest"),decision.getLong("period"))}
            original=store.observeRead(request).getJSONObject("snapshot");assertEquals(NativeInputStore.sha256(expected),original.getString("contentDigest"))
        }
        NativeDocumentStore(context,document,input,{network}).use{store->
            val reopened=store.observeRead(request).getJSONObject("snapshot");assertEquals(original.toString(),reopened.toString())
            val output=java.io.ByteArrayOutputStream();var offset=0
            while(offset<expected.size){val page=store.readSnapshot(JSONObject().put("operationId","fixed-read").put("offset",offset).put("maxBytes",32768));val bytes=android.util.Base64.decode(page.getString("base64"),android.util.Base64.DEFAULT);output.write(bytes);offset+=bytes.size}
            assertArrayEquals(expected,output.toByteArray())
        }
    }

    @Test fun interruptedProviderScopeStaysUnconfirmedWithoutCallingTheTermuxCanceller(){
        val namespace="provider-interrupted-${UUID.randomUUID()}";var network=DataSaverNetwork("unmetered",true,false)
        NativeDataSaverStore(context,namespace).use{it.configure(true,0,network)}
        val descriptor=JSONObject().put("kind","metadata").put("documentNamespace","fixture").put("uri","content://synthetic/document/original")
        NativeProviderPolicy(context,namespace,{network}).use{policy->
            policy.prepare("provider-operation",descriptor)
            expect("DATA_SAVER_INTERRUPTED"){policy.execute("provider-operation"){network=DataSaverNetwork("metered",true,true);JSONObject().put("name","late observation")}}
        }
        NativeDataSaverStore(context,namespace,{network}).use{store->
            var termuxCalls=0;NativeDataSaverSweep(store,{network}){termuxCalls++;throw IllegalStateException("A Provider is not a Termux process")}.run()
            assertEquals("Provider operations must not be sent to command cancellation",0,termuxCalls)
            val status=store.decision("provider-operation",network);assertEquals("result-unverified",status.getString("phase"));assertFalse(status.optBoolean("scopeConfirmed"))
        }
    }

    @Test fun aWriteHasASeparateFixedGrantAndWaitingDoesNotConsumeTheOriginalPlan(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue(context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission&&it.isWritePermission})
        val before=context.contentResolver.openInputStream(uri)!!.use{it.readBytes()};assertTrue(before.size<1024*1024)
        val run=UUID.randomUUID().toString();val input="provider-write-$run";val network=DataSaverNetwork("metered",true,true)
        val after=("T13 fixed original write $run\n").toByteArray(Charsets.UTF_8)
        NativeInputStore(context,input).use{it.rememberConversation(JSONObject().put("id","chat").put("title","chat").put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","synthetic")).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","fixture"))),null)}
        NativeDocumentStore(context,"document-$run",input,{network}).use{store->
            val selected=store.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            NativeDataSaverStore(context,input).use{it.configure(true,0,network)}
            val plan=store.prepare(JSONObject().put("operationId","fixed-write").put("resourceId",selected.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101).put("expectedDigest",NativeInputStore.sha256(before)).put("contentDigest",NativeInputStore.sha256(after)).put("byteLength",after.size))
            store.stage(JSONObject().put("operationId","fixed-write").put("offset",0).put("base64",android.util.Base64.encodeToString(after,android.util.Base64.NO_WRAP)))
            val start=JSONObject().put("operationId","fixed-write").put("requestDigest",plan.getString("requestDigest"))
            expect("DATA_SAVER_WAIT"){store.start(start)}
            assertEquals("A pre-I/O wait must keep the same staged plan usable","accepted_not_started",store.query("fixed-write").getString("state"))
            assertArrayEquals(before,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
            val decision=store.writePolicy(start);NativeProviderPolicy(context,input,{network}).use{it.grant("fixed-write",decision.getString("requestDigest"),decision.getLong("period"))}
            val completed=store.start(start);assertEquals("completed",completed.getString("state"));assertTrue(completed.getBoolean("scopeConfirmed"))
            assertArrayEquals(after,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
            assertEquals(completed.toString(),store.start(start).toString())
        }
    }

    @Test fun aDispatchedObservationWithoutALiveOwnerIsUnverifiedButAnActiveOwnerIsNot(){
        val namespace="provider-owner-${UUID.randomUUID()}";val network=DataSaverNetwork("metered",true,true)
        NativeDataSaverStore(context,namespace).use{it.configure(true,0,network)}
        val descriptor=JSONObject().put("kind","metadata").put("documentNamespace","fixture").put("uri","content://synthetic/document/original")
        NativeProviderPolicy(context,namespace,{network}).use{policy->
            val orphan=policy.prepare("orphan",descriptor);policy.grant("orphan",orphan.getString("requestDigest"),orphan.getLong("period"))
            // Public durable boundary: process loss after dispatch commit, before a result.
            NativeDataSaverStore(context,namespace).use{it.requireStart("orphan",orphan.getString("finalDigest"),network)}
            assertEquals("Missing ownership is not an active grant","result-unverified",policy.status("orphan").getString("phase"))
            val live=policy.prepare("live",descriptor);policy.grant("live",live.getString("requestDigest"),live.getLong("period"))
            policy.execute("live"){assertEquals("An actually held OS scope must not be labelled orphaned","granted",policy.status("live").getString("phase"));JSONObject().put("value","complete")}
        }
    }

    @Test fun completedOriginalReceiptRepairsLostPolicyAcknowledgementWithoutAnotherProviderWrite(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue(context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission&&it.isWritePermission})
        val before=context.contentResolver.openInputStream(uri)!!.use{it.readBytes()};val run=UUID.randomUUID().toString()
        val input="provider-ack-$run";val document="document-$run";val network=DataSaverNetwork("metered",true,true)
        val after=("T13 completed receipt $run\n").toByteArray(Charsets.UTF_8)
        NativeInputStore(context,input).use{it.rememberConversation(JSONObject().put("id","chat").put("title","chat").put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","synthetic")).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","fixture"))),null)}
        var start=JSONObject();var completed=JSONObject();var injections=0
        NativeDocumentStore(context,document,input,{network},{injections++;throw NativeInputException("DATA_SAVER_STORAGE_BUSY","Synthetic policy ACK loss")}).use{store->
            val selected=store.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            NativeDataSaverStore(context,input).use{it.configure(true,0,network)}
            val plan=store.prepare(JSONObject().put("operationId","fixed-write").put("resourceId",selected.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101).put("expectedDigest",NativeInputStore.sha256(before)).put("contentDigest",NativeInputStore.sha256(after)).put("byteLength",after.size))
            store.stage(JSONObject().put("operationId","fixed-write").put("offset",0).put("base64",android.util.Base64.encodeToString(after,android.util.Base64.NO_WRAP)))
            start=JSONObject().put("operationId","fixed-write").put("requestDigest",plan.getString("requestDigest"))
            val decision=store.writePolicy(start);NativeProviderPolicy(context,input,{network}).use{it.grant("fixed-write",decision.getString("requestDigest"),decision.getLong("period"))}
            expect("DATA_SAVER_STORAGE_BUSY"){store.start(start)}
            completed=store.query("fixed-write");assertEquals("completed",completed.getString("state"));assertTrue(completed.getBoolean("scopeConfirmed"))
            NativeProviderPolicy(context,input,{network}).use{assertEquals("result-unverified",it.status("fixed-write").getString("phase"))}
            assertArrayEquals(after,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
        }
        NativeDocumentStore(context,document,input,{network}).use{store->
            assertEquals("terminal",store.writePolicy(start).getString("phase"))
            assertEquals(completed.toString(),store.start(start).toString())
            assertArrayEquals(after,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()});assertEquals(1,injections)
        }
    }

    @Test fun aDeniedCloseStillReleasesTheOriginalReaderDescriptor(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue(context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission})
        val run=UUID.randomUUID().toString();val input="provider-fd-$run";var network=DataSaverNetwork("wifi",true,false)
        fun descriptors():Map<String,Int> = java.io.File("/proc/self/fd").listFiles().orEmpty().mapNotNull{runCatching{android.system.Os.readlink(it.path)}.getOrNull()}.filter{it.startsWith("/")&&!it.contains("/proc/")}.groupingBy{it}.eachCount()
        NativeDocumentStore(context,"document-$run",input,{network}).use{store->
            val selected=store.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);val before=descriptors()
            val opened=store.open(selected.getString("resourceId"));val after=descriptors();val added=after.keys.filter{after.getValue(it)>before.getOrDefault(it,0)}
            assertEquals("One original reader adds one identifiable file descriptor",1,added.size);val target=added.single()
            network=DataSaverNetwork("metered",true,true);NativeDataSaverStore(context,input).use{it.configure(true,0,network)}
            expect("DATA_SAVER_WAIT"){store.closeRead(opened.getString("readerId"))}
            assertEquals("Policy refusal must close the removed reader, not leak its original FD",before.getOrDefault(target,0),descriptors().getOrDefault(target,0))
        }
    }

    @Test fun originalVerificationWaitsForItsOwnObservationGrantAndDoesNotGrantAWrite(){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue(context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission})
        val before=context.contentResolver.openInputStream(uri)!!.use{it.readBytes()};val run=UUID.randomUUID().toString();val input="provider-verify-$run";val network=DataSaverNetwork("metered",true,true)
        NativeInputStore(context,input).use{it.rememberConversation(JSONObject().put("id","chat").put("title","chat").put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","synthetic")).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","fixture"))),null)}
        NativeDocumentStore(context,"document-$run",input,{network}).use{store->
            val selected=store.select(uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);NativeDataSaverStore(context,input).use{it.configure(true,0,network)}
            val digest=NativeInputStore.sha256(before);val plan=store.prepare(JSONObject().put("operationId","original-plan").put("resourceId",selected.getString("resourceId")).put("productId","chat").put("controlGeneration",1).put("sdkConversationId",101).put("expectedDigest",digest).put("contentDigest",digest).put("byteLength",before.size))
            val waiting=store.verify("original-plan");val verification=waiting.getJSONObject("verification")
            assertEquals("Policy waiting is not a Provider availability failure","waiting",verification.getString("status"));assertEquals("DATA_SAVER_WAIT",verification.getString("reasonCode"))
            val observation=verification.getJSONObject("observation");assertNotEquals("original-plan",observation.getString("executionId"))
            val result=store.resumeVerification("original-plan",observation.getString("executionId"),observation.getString("requestDigest"),observation.getLong("period"))
            assertEquals("read",result.getJSONObject("verification").getString("status"));assertEquals(digest,result.getJSONObject("verification").getString("currentDigest"));assertFalse(result.getBoolean("scopeConfirmed"))
            val replay=store.resumeVerification("original-plan",observation.getString("executionId"),observation.getString("requestDigest"),observation.getLong("period"));assertEquals(result.getJSONObject("verification").getLong("observedAt"),replay.getJSONObject("verification").getLong("observedAt"))
            assertEquals("waiting",store.writePolicy(JSONObject().put("operationId","original-plan").put("requestDigest",plan.getString("requestDigest"))).getString("phase"));assertArrayEquals(before,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
        }
    }

}
