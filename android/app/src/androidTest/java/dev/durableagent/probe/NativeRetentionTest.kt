package dev.durableagent.probe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Public input/maintenance Interface with real platform SQLite and synthetic source bytes. */
@RunWith(AndroidJUnit4::class)
class NativeRetentionTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val original="T16 synthetic unique recovery material 北京🌍".toByteArray()
    private fun fixture(store:NativeInputStore):JSONObject {
        store.rememberConversation(JSONObject().put("id","retained-chat").put("title","retained").put("model",JSONObject().put("provider","validation").put("modelId","text-image").put("name","Validation")),
            JSONObject().put("version","validation-1").put("provider","validation").put("modelId","text-image").put("source","validation").put("input",JSONArray(listOf("text","image"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))
        val id="fixture-${UUID.randomUUID()}"
        context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.put",id,Bundle().apply{putByteArray("bytes",original);putString("mime","text/plain");putString("name","synthetic retention input")})
        val selected=store.selectSource("retained-chat",0,"select",DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY,id),Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val prepared=store.prepare("retained-chat",selected.getJSONArray("selections").getJSONObject(0).getString("id"),"prepare")
        return store.freeze("retained-chat",prepared.getLong("revision"),"freeze")
    }
    private fun orphan(store:NativeInputStore,frozen:JSONObject) {
        store.clear("retained-chat",frozen.getLong("revision"),"clear")
        store.discard(frozen.getString("token"),"discard")
    }
    @Test fun aNewDurableOwnerInvalidatesAnEarlierCleanupCandidateAcrossReopen() {
        val namespace="retention-${UUID.randomUUID()}";lateinit var candidate:JSONObject
        NativeInputStore(context,namespace).use { store ->
            val frozen=fixture(store);orphan(store,frozen)
            candidate=store.scanCleanup().getJSONArray("candidates").getJSONObject(0)
            store.retainContent("sdk-history:entry-1",candidate.getString("objectId"),candidate.getString("fingerprint"))
            assertEquals("held",store.reclaim(candidate).getString("state"))
        }
        NativeInputStore(context,namespace).use { store ->
            assertArrayEquals(original,store.readRetainedContent("sdk-history:entry-1",candidate.getString("objectId")))
            assertEquals(0,store.gc().getInt("reclaimed"))
            assertArrayEquals(original,store.readRetainedContent("sdk-history:entry-1",candidate.getString("objectId")))
        }
    }
    @Test fun interruptedQuarantineRejectsANewReferenceAndSafelyFinishesAfterReopen() {
        val namespace="retention-${UUID.randomUUID()}";lateinit var candidate:JSONObject
        NativeInputStore(context,namespace).use { store ->val frozen=fixture(store);orphan(store,frozen);candidate=store.scanCleanup().getJSONArray("candidates").getJSONObject(0)}
        NativeInputStore(context,namespace,boundary={if(it=="retention.quarantined")throw IllegalStateException("synthetic interruption")}).use { store ->
            try{store.reclaim(candidate);fail("Expected interrupted quarantine")}catch(_:NativeInputException){}
        }
        NativeInputStore(context,namespace).use { store ->
            try{store.retainContent("late-sdk-owner",candidate.getString("objectId"),candidate.getString("fingerprint"));fail("Quarantined content must not be published")}catch(error:NativeInputException){assertEquals("INPUT_CONTENT_RETRY",error.code)}
            assertEquals("reclaimed",store.reclaim(candidate).getString("state"))
            assertEquals(0,store.scanCleanup().getJSONArray("candidates").length())
            assertEquals("",store.read("retained-chat").getString("text"))
        }
    }
    @Test fun sdkHandoffKeepsOriginalFrozenOwnerUntilBothAuthoritiesCanBeVerified() {
        val namespace="retention-${UUID.randomUUID()}";lateinit var frozen:JSONObject
        NativeInputStore(context,namespace).use { store ->
            frozen=fixture(store);store.retainFrozen("sdk-admission:stable-send",frozen.getString("token"))
            store.clear("retained-chat",frozen.getLong("revision"),"clear")
        }
        NativeInputStore(context,namespace).use { store ->
            assertEquals(frozen.getString("digest"),store.readFrozen(frozen.getString("token")).getString("digest"))
            try{store.discard(frozen.getString("token"),"premature-discard");fail("Cannot discard a handoff hold")}catch(error:NativeInputException){assertEquals("INPUT_IN_USE",error.code)}
            assertEquals(0,store.gc().getInt("reclaimed"))
            val id=frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")
            assertArrayEquals(original,store.readObjectBytes(frozen.getString("token"),id))
        }
    }
    @Test fun contentCapacityFailureIsVisibleWithoutDestroyingPreviouslyFrozenBytes() {
        val namespace="retention-content-full-${UUID.randomUUID()}";lateinit var fixed:JSONObject
        NativeInputStore(context,namespace).use{fixed=fixture(it)}
        NativeInputStore(context,namespace,boundary={if(it=="content.beforeWrite")throw android.system.ErrnoException("synthetic-content-write",android.system.OsConstants.ENOSPC)}).use{store->
            val before=store.inspect("retained-chat");val capability=before.getJSONObject("capability").put("version","validation-2")
            store.rememberConversation(JSONObject().put("id","retained-chat").put("title","retained").put("model",JSONObject().put("provider","validation").put("modelId","text-image").put("name","Validation")),capability)
            val failed=store.prepare("retained-chat",before.getJSONArray("selections").getJSONObject(0).getString("id"),"prepare-new-capability")
            val preparation=failed.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation")
            assertEquals("failed",preparation.getString("state"));assertTrue(preparation.getString("reason").contains("存储空间不足"))
            assertEquals(0,store.gc().getInt("reclaimed"))
            assertArrayEquals(original,store.readObjectBytes(fixed.getString("token"),fixed.getJSONArray("representations").getJSONObject(0).getString("objectId")))
        }
    }
    @Test fun aTextOnlySdkHandoffRetainsItsFrozenTokenAcrossReopenWithoutANativeIntent() {
        val namespace="retention-text-${UUID.randomUUID()}";lateinit var frozen:JSONObject
        NativeInputStore(context,namespace).use{store->
            store.rememberConversation(JSONObject().put("id","retained-chat").put("title","retained").put("model",JSONObject().put("provider","validation").put("modelId","text-image").put("name","Validation")),
                JSONObject().put("version","validation-1").put("provider","validation").put("modelId","text-image").put("source","validation").put("input",JSONArray(listOf("text","image"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))
            store.save("retained-chat",0,"save","Unique text-only recovery material",emptyList())
            frozen=store.freeze("retained-chat",1,"freeze");assertEquals(0,frozen.getJSONArray("representations").length())
            store.retainFrozen("sdk-admission:text-only",frozen.getString("token"));store.clear("retained-chat",1,"clear")
        }
        NativeInputStore(context,namespace).use{store->
            try{store.discard(frozen.getString("token"),"discard-held-text");fail("SDK-held text-only input must not be discarded")}catch(error:NativeInputException){assertEquals("INPUT_IN_USE",error.code)}
            assertEquals(frozen.toString(),store.readFrozen(frozen.getString("token")).toString())
            assertEquals(0,store.gc().getInt("reclaimed"))
        }
    }
}
