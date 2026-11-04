package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteFullException
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.io.File

/** Native public authority with actual SQLite. SDK edit decisions belong to the runtime suite. */
@RunWith(AndroidJUnit4::class)
class NativeProjectFenceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun association(sdk: Int = 101, association: Long = 1, workspace: String = "default", version: Long = 1, identity: String = "directory-one") =
        JSONObject().put("sdkConversationId", sdk).put("associationVersion", association)
            .put("location", JSONObject().put("workspaceId", workspace).put("version", version).put("identity", identity))
    private fun product(id: String = "chat", association: JSONObject = association(), title: String = "Synthetic project") =
        JSONObject().put("id", id).put("title", title).put("submissionContext", association)
            .put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation"))
    private fun capability() = JSONObject().put("version", "validation-1").put("provider", "validation").put("modelId", "text").put("source", "validation")
        .put("input", JSONArray(listOf("text"))).put("limits", JSONObject()).put("applicationPolicy", JSONObject())
    private fun seed(store: NativeInputStore, id: String = "chat", association: JSONObject = association()): JSONObject {
        store.rememberConversation(product(id, association), capability())
        store.save(id, 0, "save-$id", "fixed project input $id 北京🌍", emptyList())
        return store.freeze(id, 1, "freeze-$id")
    }
    private fun send(fixed: JSONObject, action: String, association: JSONObject = association(), control: Long = 0) = JSONObject()
        .put("id", fixed.getString("id")).put("actionId", action).put("inputToken", fixed.getString("token"))
        .put("expectedContext", association).put("expectedControlVersion", control)
        .put("queue", JSONObject().put("whenBusy", "followUp").put("whenIdle", "start"))
    private fun receipt(intent: JSONObject) = JSONObject().put("protocol", 1).put("intentId", intent.getString("intentId")).put("id", intent.getString("id"))
        .put("inputToken", intent.getString("inputToken")).put("inputRevision", intent.getLong("inputRevision")).put("inputDigest", intent.getString("inputDigest"))
        .put("context", intent.getJSONObject("context")).put("queue", intent.getJSONObject("queue")).put("controlGeneration", intent.getLong("controlGeneration"))
        .put("bindingId", "synthetic-project-binding").put("submissionId", 501)
    private fun expectCode(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: NativeInputException) { assertEquals(code, error.code); assertNull(error.cause) }
    }

    @Test fun editFenceBlocksOnlyNewIntentsAndPersistsWhileDraftStopAndOldAckRemainAvailable() {
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject; lateinit var intent: JSONObject
        NativeInputStore(context, namespace).use { store ->
            fixed = seed(store); intent = store.createSend(send(fixed, "already-sent"))
            assertNull(store.readLocationEdit())
            assertEquals("edit-one", store.beginLocationEdit("edit-one").getString("operationId"))
            assertEquals("edit-one", store.beginLocationEdit("edit-one").getString("operationId"))
            expectCode("LOCATION_EDIT_BUSY") { store.beginLocationEdit("edit-two") }
            expectCode("LOCATION_EDIT_PENDING") { store.createSend(send(fixed, "new-send")) }
            assertEquals(intent.toString(), store.createSend(send(fixed, "already-sent")).toString())
            store.save("chat", 1, "keep-editing", "draft continues while native location fence is held", emptyList())
            store.requestStop(JSONObject().put("id", "chat").put("actionId", "stop-while-editing").put("expectedControlVersion", 0))
            val ack = store.confirmAdmission(intent.getString("intentId"), receipt(intent))
            assertFalse(ack.getBoolean("draftCleared")); assertTrue(ack.getJSONObject("intent").getBoolean("cancelled"))
        }
        NativeInputStore(context, namespace).use { store ->
            assertEquals("edit-one", store.readLocationEdit()!!.getString("operationId"))
            assertEquals("draft continues while native location fence is held", store.inspect("chat").getString("text"))
            expectCode("LOCATION_EDIT_PENDING") { store.createSend(send(fixed, "new-send", control = 1)) }
            assertEquals("acknowledged", store.createSend(send(fixed, "already-sent")).getString("delivery"))
            assertEquals(1, store.listSends().getJSONArray("intents").length())
        }
    }

    @Test fun finishingInstallsEveryAuthoritativeContextAtomicallyAndRefusesPartialOrRegressingSnapshots() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            val first = seed(store); seed(store, "other", association(sdk = 102))
            val updated = association(association = 2, workspace = "project", version = 1, identity = "directory-two")
            val contexts = JSONArray().put(JSONObject().put("id", "chat").put("context", updated))
                .put(JSONObject().put("id", "other").put("context", association(sdk = 102)))
            store.beginLocationEdit("edit-complete")
            expectCode("LOCATION_EDIT_CONFLICT") { store.finishLocationEdit("wrong-edit", contexts) }
            expectCode("LOCATION_CONTEXT_INCOMPLETE") { store.finishLocationEdit("edit-complete", JSONArray().put(contexts.getJSONObject(0))) }
            assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            assertEquals("edit-complete", store.readLocationEdit()!!.getString("operationId"))
            store.finishLocationEdit("edit-complete", contexts)
            assertNull(store.readLocationEdit())
            assertEquals(updated.toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.createSend(send(first, "old-location")) }
            assertEquals(updated.toString(), store.createSend(send(first, "new-location", updated)).getJSONObject("context").toString())
            store.beginLocationEdit("edit-regression")
            val regressing = JSONArray(contexts.toString()).put(0, JSONObject().put("id", "chat").put("context", association()))
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.finishLocationEdit("edit-regression", regressing) }
            assertEquals("edit-regression", store.readLocationEdit()!!.getString("operationId"))
            assertEquals(updated.toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            store.finishLocationEdit("edit-regression", contexts)
        }
    }

    @Test fun lateOrdinaryPublicationNeverReinstallsAnOlderLocationOrContradictsTheSameVersion() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            val fixed = seed(store)
            val updated = association(association = 2, workspace = "project", version = 10, identity = "directory-ten")
            store.beginLocationEdit("finish-new-location")
            store.finishLocationEdit("finish-new-location", JSONArray().put(JSONObject().put("id", "chat").put("context", updated)))
            store.rememberConversation(product(association = association(), title = "later title from an older view"), capability())
            assertEquals(updated.toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            assertEquals("later title from an older view", store.list().getJSONArray("conversations").getJSONObject(0).getString("title"))
            store.rememberConversation(product(association = association(association = 2, workspace = "project", version = 9, identity = "directory-nine")), capability())
            assertEquals(updated.toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.rememberConversation(product(association = association(association = 2, workspace = "other")), capability()) }
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.rememberConversation(product(association = association(association = 2, workspace = "project", version = 10, identity = "contradiction")), capability()) }
            val third = association(association = 3, workspace = "new-project", version = 1, identity = "new-directory-one")
            store.rememberConversation(product(association = third), capability())
            assertEquals(third.toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            expectCode("SUBMISSION_CONTEXT_CONFLICT") { store.createSend(send(fixed, "stale-send")) }
            assertEquals(third.toString(), store.createSend(send(fixed, "current-send", third)).getJSONObject("context").toString())
        }
    }

    @Test fun ordinaryPublicationCannotChangeLocationWhileFenceIsHeldEvenWithAHigherVersion() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            seed(store); store.beginLocationEdit("held-edit")
            val proposed = association(association = 2, workspace = "project", identity = "directory-two")
            store.rememberConversation(product(association = proposed, title = "title remains independent"), capability())
            assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            assertEquals("title remains independent", store.list().getJSONArray("conversations").getJSONObject(0).getString("title"))
            store.finishLocationEdit("held-edit", JSONArray().put(JSONObject().put("id", "chat").put("context", association())))
            assertNull(store.readLocationEdit()); assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
        }
    }

    @Test fun failedPublicationRollsBackEveryContextAndKeepsTheFenceForCanonicalRecovery() {
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { store -> seed(store); seed(store, "other", association(sdk = 102)); store.beginLocationEdit("atomic-finish") }
        val first = association(association = 2, workspace = "project", identity = "directory-two")
        val second = association(sdk = 102, association = 2, workspace = "project", identity = "directory-two")
        val contexts = JSONArray().put(JSONObject().put("id", "chat").put("context", first)).put(JSONObject().put("id", "other").put("context", second))
        NativeInputStore(context, namespace, boundary = { if (it == "location.edit.finish.contextWritten") throw SQLiteFullException("Synthetic native commit storage failure") }).use { store ->
            expectCode("INPUT_STORAGE_FAILED") { store.finishLocationEdit("atomic-finish", contexts) }
        }
        NativeInputStore(context, namespace).use { store ->
            assertEquals("atomic-finish", store.readLocationEdit()!!.getString("operationId"))
            assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            assertEquals(association(sdk = 102).toString(), store.inspect("other").getJSONObject("submissionContext").toString())
            val invalid = JSONArray(contexts.toString()).put(1, JSONObject().put("id", "other").put("context", association(sdk = 102).put("associationVersion", 0)))
            expectCode("INPUT_INVALID") { store.finishLocationEdit("atomic-finish", invalid) }
            expectCode("LOCATION_CONTEXT_INCOMPLETE") { store.finishLocationEdit("atomic-finish", JSONArray().put(contexts.getJSONObject(0)).put(contexts.getJSONObject(0))) }
            expectCode("LOCATION_CONTEXT_INCOMPLETE") { store.finishLocationEdit("atomic-finish", JSONArray(contexts.toString()).put(JSONObject().put("id", "unknown").put("context", first))) }
            assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            // The authoritative SDK outcome may still be the old context; no native proposal is replayed.
            store.finishLocationEdit("atomic-finish", JSONArray().put(JSONObject().put("id", "chat").put("context", association())).put(JSONObject().put("id", "other").put("context", association(sdk = 102))))
            assertNull(store.readLocationEdit()); assertEquals(association().toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
            expectCode("LOCATION_EDIT_CONFLICT") { store.finishLocationEdit("atomic-finish", contexts) }
        }
    }

    @Test fun unknownOrCorruptFenceNeverOpensNewSendingAndGenericUiCannotReleaseIt() {
        for (missing in listOf(false, true)) {
            val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject
            NativeInputStore(context, namespace).use { store -> fixed = seed(store); store.beginLocationEdit("held-edit") }
            val path = File(File(context.noBackupFilesDir, namespace), "input.sqlite")
            SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
                if (missing) db.execSQL("DELETE FROM native_location_edit") else db.execSQL("UPDATE native_location_edit SET operation_id='' WHERE singleton=1")
            }
            NativeInputStore(context, namespace).use { store ->
                expectCode("INPUT_STORAGE_CORRUPT") { store.readLocationEdit() }
                expectCode("INPUT_STORAGE_CORRUPT") { store.createSend(send(fixed, "new-action")) }
                assertEquals(fixed.getString("text"), store.inspect("chat").getString("text"))
                val access = NativeInputAccess(store)
                for (method in listOf("input.beginLocationEdit", "input.readLocationEdit", "input.finishLocationEdit"))
                    assertEquals("INPUT_UNKNOWN_ACTION", JSONObject(access.requestJson(method, "{}")).getJSONObject("error").getString("code"))
            }
        }
    }

    @Test fun previousSendSchemaMigratesWithoutChangingIntentPinsStopOrDraft() {
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var fixed: JSONObject; lateinit var intent: JSONObject; lateinit var stop: JSONObject
        NativeInputStore(context, namespace).use { store ->
            fixed = seed(store); intent = store.createSend(send(fixed, "old-intent"))
            stop = store.requestStop(JSONObject().put("id", "chat").put("actionId", "old-stop").put("expectedControlVersion", 0))
            intent = store.readSend(intent.getString("intentId"))
        }
        val path = File(File(context.noBackupFilesDir, namespace), "input.sqlite")
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
            db.beginTransaction(); try { db.execSQL("DROP TABLE native_location_edit");db.execSQL("DROP TABLE frozen_holds");db.execSQL("DROP TABLE content_holds");db.execSQL("DROP TABLE content_quarantine"); db.execSQL("PRAGMA user_version=3"); db.setTransactionSuccessful() } finally { db.endTransaction() }
        }
        NativeInputStore(context, namespace).use { store ->
            assertNull(store.readLocationEdit()); assertEquals(intent.toString(), store.readSend("old-intent").toString())
            assertEquals(stop.toString(), store.readControl("chat").toString()); assertEquals(1, store.pendingStops().length())
            assertEquals(fixed.toString(), store.readFrozen(fixed.getString("token")).toString()); assertEquals(fixed.getString("text"), store.inspect("chat").getString("text"))
            expectCode("INPUT_IN_USE") { store.discard(fixed.getString("token"), "cannot-discard") }
            store.beginLocationEdit("new-edit"); assertEquals("new-edit", store.readLocationEdit()!!.getString("operationId"))
        }
        SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { assertEquals(6, it.version) }
    }
}
