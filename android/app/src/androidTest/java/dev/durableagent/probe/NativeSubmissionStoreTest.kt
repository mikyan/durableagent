package dev.durableagent.probe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.io.File

/** Public native authority, actual SQLite and fixed inputs; no SDK owner or model transport. */
@RunWith(AndroidJUnit4::class)
class NativeSubmissionStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun location() = JSONObject().put("workspaceId", "default").put("version", 1).put("identity", "validation-workspace-1")
    private fun association() = JSONObject().put("sdkConversationId", 101).put("associationVersion", 1).put("location", location())
    private fun queue() = JSONObject().put("whenBusy", "followUp").put("whenIdle", "start")
    private fun seed(store: NativeInputStore): JSONObject {
        store.rememberConversation(JSONObject().put("id", "chat").put("title", "Synthetic input")
            .put("submissionContext", association())
            .put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation")),
            JSONObject().put("version", "validation-1").put("provider", "validation").put("modelId", "text")
                .put("source", "validation").put("input", JSONArray(listOf("text"))).put("limits", JSONObject()).put("applicationPolicy", JSONObject()))
        store.save("chat", 0, "draft-save", "original explicit input 北京🌍", emptyList())
        return store.freeze("chat", 1, "freeze-original")
    }
    private fun request(token: String, action: String = "explicit-action") = JSONObject().put("actionId", action).put("id", "chat")
        .put("inputToken", token).put("expectedContext", association()).put("expectedControlVersion", 0).put("queue", queue())
    private fun expectCode(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") }
        catch (error: NativeInputException) { assertEquals(code, error.code); assertNull(error.cause) }
    }
    private fun receipt(intent: JSONObject, submission: Int = 501): JSONObject = JSONObject().put("protocol", 1)
        .put("intentId", intent.getString("intentId")).put("id", "chat").put("inputToken", intent.getString("inputToken"))
        .put("inputRevision", intent.getLong("inputRevision")).put("inputDigest", intent.getString("inputDigest"))
        .put("context", association()).put("queue", queue()).put("controlGeneration", intent.getLong("controlGeneration"))
        .put("bindingId", "verified-binding-1").put("submissionId", submission)
    private fun attachment(store: NativeInputStore): JSONObject {
        val name = "fixture-${UUID.randomUUID()}"
        context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"), "fixture.put", name,
            Bundle().apply { putByteArray("bytes", "immutable receipt attachment 北京🌍".toByteArray()); putString("mime", "text/plain"); putString("name", "synthetic submission input") })
        val selected = store.selectSource("chat", 1, "attach", DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY, name), Intent.FLAG_GRANT_READ_URI_PERMISSION)
        store.prepare("chat", selected.getJSONArray("selections").getJSONObject(0).getString("id"), "prepare")
        return store.freeze("chat", 2, "freeze-attached")
    }

    @Test fun explicitIntentReopensWithItsFixedIdentityAndNeverAdoptsLaterDraftText() {
        val namespace = "input-test-${UUID.randomUUID()}"
        lateinit var fixed: JSONObject; lateinit var intent: JSONObject
        NativeInputStore(context, namespace).use { store ->
            fixed = seed(store)
            assertEquals(0, store.listSends(JSONObject().put("id", "chat")).getJSONArray("intents").length())
            intent = store.createSend(request(fixed.getString("token")))
            assertEquals("explicit-action", intent.getString("intentId"))
            assertEquals("pending", intent.getString("delivery"))
            assertEquals(1, intent.getInt("protocol")); assertEquals(1L, intent.getLong("inputRevision"))
            assertEquals(fixed.getString("digest"), intent.getString("inputDigest"))
            assertEquals(fixed.getString("token"), intent.getString("inputToken"))
            assertEquals(101, intent.getJSONObject("context").getInt("sdkConversationId"))
            store.save("chat", 1, "later-edit", "later draft stays unsent", emptyList())
        }
        NativeInputStore(context, namespace).use { reopened ->
            assertEquals(intent.toString(), reopened.readSend(intent.getString("intentId")).toString())
            assertEquals(intent.toString(), reopened.createSend(request(fixed.getString("token"))).toString())
            assertEquals(1, reopened.listSends(JSONObject().put("id", "chat")).getJSONArray("intents").length())
            assertEquals("later draft stays unsent", reopened.inspect("chat").getString("text"))
            assertEquals("original explicit input 北京🌍", reopened.readFrozen(fixed.getString("token")).getString("text"))
            val later = reopened.freeze("chat", 2, "freeze-later")
            expectCode("INPUT_OPERATION_CONFLICT") { reopened.createSend(request(later.getString("token"))) }
        }
    }

    @Test fun acknowledgementClearsOnlyOriginalRevisionAndReplayPreservesNewDraft() {
        val namespace = "input-test-${UUID.randomUUID()}"
        lateinit var intent: JSONObject; lateinit var confirmed: JSONObject
        NativeInputStore(context, namespace).use { store ->
            val fixed = seed(store); intent = store.createSend(request(fixed.getString("token")))
            assertEquals("uncertain", store.markDeliveryUnknown(intent.getString("intentId")).getString("delivery"))
            val ack = store.confirmAdmission(intent.getString("intentId"), receipt(intent))
            assertTrue(ack.getBoolean("draftCleared")); assertEquals("", ack.getJSONObject("draft").getString("text"))
            assertEquals(2L, ack.getJSONObject("draft").getLong("revision"))
            confirmed = ack.getJSONObject("intent")
            assertEquals("acknowledged", confirmed.getString("delivery")); assertEquals(501, confirmed.getJSONObject("receipt").getInt("submissionId"))
            store.save("chat", 2, "new-draft", "not part of the old send", emptyList())
        }
        NativeInputStore(context, namespace).use { reopened ->
            val repeated = reopened.confirmAdmission(intent.getString("intentId"), receipt(intent))
            assertFalse(repeated.getBoolean("draftCleared"))
            assertEquals("not part of the old send", repeated.getJSONObject("draft").getString("text"))
            assertEquals(confirmed.toString(), repeated.getJSONObject("intent").toString())
            assertEquals(confirmed.toString(), reopened.markDeliveryUnknown(intent.getString("intentId")).toString())
            expectCode("INPUT_OPERATION_CONFLICT") { reopened.confirmAdmission(intent.getString("intentId"), receipt(intent, 502)) }
            assertEquals(501, reopened.readSend(intent.getString("intentId")).getJSONObject("receipt").getInt("submissionId"))
        }
    }

    @Test fun stopSurvivesReopenAndNewExplicitIntentRetainsExactOldAbortBarrier() {
        val namespace = "input-test-${UUID.randomUUID()}"
        lateinit var fixed: JSONObject; lateinit var original: JSONObject; lateinit var firstBarrier: JSONObject
        NativeInputStore(context, namespace).use { store ->
            fixed = seed(store); original = store.createSend(request(fixed.getString("token")))
            val stop = store.requestStop(JSONObject().put("id", "chat").put("actionId", "stop-first").put("expectedControlVersion", 0))
            assertEquals(1L, stop.getLong("version")); assertEquals(1L, stop.getLong("stoppedThrough"))
            firstBarrier = stop.getJSONObject("pendingAbort")
            assertEquals("stop-first", firstBarrier.getString("stopId"))
            val replay = store.createSend(request(fixed.getString("token")))
            assertTrue(replay.getBoolean("cancelled")); assertEquals(1L, replay.getLong("controlGeneration"))
            assertTrue(store.markDeliveryUnknown(original.getString("intentId")).getBoolean("cancelled"))
            val fresh = store.createSend(request(fixed.getString("token"), "explicit-second").put("expectedControlVersion", 1))
            assertEquals(2L, fresh.getLong("controlGeneration")); assertFalse(fresh.getBoolean("cancelled"))
            val current = store.readControl("chat")
            assertEquals(2L, current.getLong("version")); assertEquals(firstBarrier.toString(), current.getJSONObject("pendingAbort").toString())
        }
        NativeInputStore(context, namespace).use { store ->
            assertEquals(firstBarrier.toString(), store.pendingStops().getJSONObject(0).getJSONObject("control").getJSONObject("pendingAbort").toString())
            val stopped = store.requestStop(JSONObject().put("id", "chat").put("actionId", "stop-second").put("expectedControlVersion", 2))
            assertEquals(2L, stopped.getLong("stoppedThrough")); assertEquals(3L, stopped.getLong("version"))
            val secondBarrier = stopped.getJSONObject("pendingAbort")
            expectCode("CONTROL_CONFLICT") { store.confirmAbort("chat", firstBarrier) }
            val fresh = store.createSend(request(fixed.getString("token"), "explicit-third").put("expectedControlVersion", 3))
            assertEquals(3L, fresh.getLong("controlGeneration"))
            val confirmed = store.confirmAbort("chat", secondBarrier)
            assertFalse(confirmed.has("pendingAbort")); assertEquals(5L, confirmed.getLong("version"))
            assertEquals(2L, confirmed.getLong("stoppedThrough")); assertEquals(0, store.pendingStops().length())
            val late = store.confirmAdmission(original.getString("intentId"), receipt(original)).getJSONObject("intent")
            assertTrue(late.getBoolean("cancelled")); assertEquals("acknowledged", late.getString("delivery"))
            assertEquals(confirmed.toString(), store.readControl("chat").toString())
            assertTrue(store.readSend("explicit-second").getBoolean("cancelled"))
            assertFalse(store.readSend("explicit-third").getBoolean("cancelled"))
            expectCode("INPUT_OPERATION_CONFLICT") { store.requestStop(JSONObject().put("id", "chat").put("actionId", "explicit-third").put("expectedControlVersion", 5)) }
        }
    }

    @Test fun identicalBodyExplicitActionsStayDistinctAndPagingRejectsAChangedScope() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            val fixed = seed(store); val token = fixed.getString("token")
            for (action in listOf("action-one", "action-two", "action-three")) store.createSend(request(token, action))
            val first = store.listSends(JSONObject().put("id", "chat").put("limit", 2))
            assertEquals(listOf("action-three", "action-two"), (0 until 2).map { first.getJSONArray("intents").getJSONObject(it).getString("intentId") })
            val second = store.listSends(JSONObject().put("id", "chat").put("limit", 2).put("cursor", first.getString("next")))
            assertEquals(1, second.getJSONArray("intents").length()); assertFalse(second.has("next"))
            assertEquals("action-one", second.getJSONArray("intents").getJSONObject(0).getString("intentId"))
            expectCode("INPUT_INVALID") { store.listSends(JSONObject().put("cursor", first.getString("next"))) }
            expectCode("INPUT_OPERATION_CONFLICT") { store.createSend(request(token, "action-one").put("expectedContext", association().put("associationVersion", 2))) }
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.createSend(request(token, "new-wrong-location").put("expectedContext", association().put("location", location().put("version", 2)))) }
            expectCode("INPUT_INVALID") { store.createSend(request(token, "new-wrong-queue").put("queue", JSONObject().put("whenIdle", "start").put("whenBusy", "replace"))) }
            assertEquals(3, store.listSends().getJSONArray("intents").length())
        }
    }

    @Test fun intentsRetainRealObjectPinsAcrossPendingUncertainAcknowledgedAndCancelledStates() {
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject; lateinit var intent: JSONObject
        NativeInputStore(context, namespace).use { store ->
            seed(store); fixed = attachment(store); intent = store.createSend(request(fixed.getString("token")))
            for (delivery in listOf("pending", "uncertain", "acknowledged")) {
                if (delivery == "uncertain") store.markDeliveryUnknown(intent.getString("intentId"))
                if (delivery == "acknowledged") assertTrue(store.confirmAdmission(intent.getString("intentId"), receipt(intent)).getBoolean("draftCleared"))
                expectCode("INPUT_IN_USE") { store.discard(fixed.getString("token"), "discard-$delivery") }
                store.gc()
                assertArrayEquals("immutable receipt attachment 北京🌍".toByteArray(), store.readObjectBytes(fixed.getString("token"), fixed.getJSONArray("representations").getJSONObject(0).getString("objectId")))
            }
            store.requestStop(JSONObject().put("id", "chat").put("actionId", "cancel-after-ack").put("expectedControlVersion", 0))
        }
        NativeInputStore(context, namespace).use { store ->
            assertTrue(store.readSend(intent.getString("intentId")).getBoolean("cancelled"))
            expectCode("INPUT_IN_USE") { store.discard(fixed.getString("token"), "discard-cancelled") }
            store.gc(); assertArrayEquals("immutable receipt attachment 北京🌍".toByteArray(), store.readObjectBytes(fixed.getString("token"), fixed.getJSONArray("representations").getJSONObject(0).getString("objectId")))
        }
    }

    @Test fun lateAcknowledgementPreservesAuthorAbaAndNewRepresentationAtSameAuthorRevision() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            val fixed = seed(store); val intent = store.createSend(request(fixed.getString("token")))
            store.save("chat", 1, "edit-away", "different", emptyList())
            store.save("chat", 2, "edit-back", fixed.getString("text"), emptyList())
            val ack = store.confirmAdmission(intent.getString("intentId"), receipt(intent))
            assertFalse(ack.getBoolean("draftCleared")); assertEquals(3L, ack.getJSONObject("draft").getLong("revision"))
            assertEquals(fixed.getString("text"), ack.getJSONObject("draft").getString("text"))
        }
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            seed(store); val fixed = attachment(store); val intent = store.createSend(request(fixed.getString("token")))
            val before = store.inspect("chat")
            val capability = JSONObject(before.getJSONObject("capability").toString()).put("version", "validation-2")
            store.rememberConversation(JSONObject().put("id", "chat").put("title", "Synthetic input").put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation")).put("submissionContext", association()), capability)
            val changed = store.prepare("chat", before.getJSONArray("selections").getJSONObject(0).getString("id"), "new-representation")
            val newObject = changed.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getJSONObject("representation").getString("objectId")
            assertNotEquals(fixed.getJSONArray("representations").getJSONObject(0).getString("objectId"), newObject)
            assertEquals(fixed.getLong("revision"), changed.getLong("revision"))
            val ack = store.confirmAdmission(intent.getString("intentId"), receipt(intent))
            assertFalse(ack.getBoolean("draftCleared")); assertEquals(newObject, ack.getJSONObject("draft").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getJSONObject("representation").getString("objectId"))
        }
    }

    @Test fun nativeCommitFailuresNeverPublishAnIntentAckOrStopAndPublicBridgeCannotForgeAuthority() {
        for (stage in listOf("send.intent.beforeCommit", "send.ack.beforeCommit", "send.stop.beforeCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject; lateinit var intent: JSONObject
            NativeInputStore(context, namespace).use { store -> fixed = seed(store); if (stage != "send.intent.beforeCommit") intent = store.createSend(request(fixed.getString("token"))) }
            NativeInputStore(context, namespace, boundary = { if (it == stage) throw SQLiteFullException("synthetic external disk quota") }).use { store ->
                expectCode("INPUT_STORAGE_FAILED") { when (stage) {
                    "send.intent.beforeCommit" -> store.createSend(request(fixed.getString("token")))
                    "send.ack.beforeCommit" -> store.confirmAdmission(intent.getString("intentId"), receipt(intent))
                    else -> store.requestStop(JSONObject().put("id", "chat").put("actionId", "failed-stop").put("expectedControlVersion", 0))
                } }
            }
            NativeInputStore(context, namespace).use { store ->
                assertEquals(fixed.getString("text"), store.inspect("chat").getString("text"))
                assertEquals(0L, store.readControl("chat").getLong("version"))
                if (stage == "send.intent.beforeCommit") assertEquals(0, store.listSends().getJSONArray("intents").length())
                else assertEquals("pending", store.readSend(intent.getString("intentId")).getString("delivery"))
                val access = NativeInputAccess(store)
                for (method in listOf("input.confirmAdmission", "input.confirmAbort", "input.markDeliveryUnknown"))
                    assertEquals("INPUT_UNKNOWN_ACTION", JSONObject(access.requestJson(method, "{}")).getJSONObject("error").getString("code"))
            }
        }
    }

    @Test fun malformedPersistedControlCannotBeReadAsPermissionToDispatch() {
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { store ->
            val fixed = seed(store); store.createSend(request(fixed.getString("token")))
            store.requestStop(JSONObject().put("id", "chat").put("actionId", "must-survive").put("expectedControlVersion", 0))
        }
        val path = File(File(context.noBackupFilesDir, namespace), "input.sqlite")
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use {
            it.execSQL("UPDATE native_controls SET data=? WHERE conversation_id=?", arrayOf("{}", "chat"))
        }
        NativeInputStore(context, namespace).use { store ->
            expectCode("INPUT_STORAGE_CORRUPT") { store.readControl("chat") }
            expectCode("INPUT_STORAGE_CORRUPT") { store.pendingStops() }
            assertEquals("original explicit input 北京🌍", store.inspect("chat").getString("text"))
        }
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT data FROM native_controls WHERE conversation_id='chat'", null).use { assertTrue(it.moveToFirst()); assertEquals("{}", it.getString(0)) }
        }
    }

    @Test fun previousNativeSchemaMigratesWithoutCreatingSendsOrLosingDraftObjectAndOperationReceipts() {
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject; lateinit var previous: JSONObject
        NativeInputStore(context, namespace).use { store ->
            seed(store); fixed = attachment(store); previous = store.inspect("chat")
        }
        // Exact v2 application tables remain; remove later authority/fence tables before upgrade.
        val path = File(File(context.noBackupFilesDir, namespace), "input.sqlite")
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
            db.beginTransaction()
            try {
                db.execSQL("DROP TABLE native_send_intents"); db.execSQL("DROP TABLE native_submission_actions"); db.execSQL("DROP TABLE native_controls")
                db.execSQL("DROP TABLE native_location_edit")
                db.execSQL("DROP TABLE frozen_holds");db.execSQL("DROP TABLE content_holds");db.execSQL("DROP TABLE content_quarantine")
                val conversation = db.rawQuery("SELECT data FROM conversations WHERE id='chat'", null).use { assertTrue(it.moveToFirst()); JSONObject(it.getString(0)) }
                conversation.remove("submissionContext"); previous.remove("submissionContext")
                db.execSQL("UPDATE conversations SET data=? WHERE id='chat'", arrayOf(conversation.toString()))
                val receipts = mutableListOf<Pair<String, String>>()
                db.rawQuery("SELECT id,reply FROM operations", null).use { rows -> while (rows.moveToNext()) {
                    val reply = JSONObject(rows.getString(1)); reply.remove("submissionContext"); receipts.add(Pair(rows.getString(0), reply.toString()))
                } }
                for ((id, reply) in receipts) db.execSQL("UPDATE operations SET reply=? WHERE id=?", arrayOf(reply, id))
                db.execSQL("PRAGMA user_version=2"); db.setTransactionSuccessful()
            } finally { db.endTransaction() }
        }
        NativeInputStore(context, namespace).use { store ->
            assertEquals(previous.toString(), store.inspect("chat").toString())
            assertEquals(fixed.toString(), store.readFrozen(fixed.getString("token")).toString())
            assertArrayEquals("immutable receipt attachment 北京🌍".toByteArray(), store.readObjectBytes(fixed.getString("token"), fixed.getJSONArray("representations").getJSONObject(0).getString("objectId")))
            assertEquals(0, store.listSends().getJSONArray("intents").length()); assertEquals(0, store.pendingStops().length())
            assertEquals(0L, store.readControl("chat").getLong("version"))
            val replay = store.save("chat", 0, "draft-save", "original explicit input 北京🌍", emptyList())
            assertEquals(1L, replay.getLong("revision")); assertEquals(previous.toString(), store.inspect("chat").toString())
            expectCode("SUBMISSION_CONTEXT_UNAVAILABLE") { store.createSend(request(fixed.getString("token"))) }
            store.rememberConversation(JSONObject().put("id", "chat").put("title", "Synthetic input")
                .put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation")).put("submissionContext", association()), previous.getJSONObject("capability"))
            val created = store.createSend(request(fixed.getString("token")))
            assertEquals(2L, created.getLong("inputRevision")); assertEquals("pending", created.getString("delivery"))
        }
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db -> assertEquals(6, db.version) }
    }
}
