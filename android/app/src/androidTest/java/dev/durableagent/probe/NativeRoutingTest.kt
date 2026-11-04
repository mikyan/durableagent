package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeRoutingTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun association(sdk: Int) = JSONObject().put("sdkConversationId", sdk).put("associationVersion", 1)
        .put("location", JSONObject().put("workspaceId", "default").put("version", 1).put("identity", "same-workspace"))
    private fun seed(store: NativeInputStore) {
        for ((id, sdk) in listOf("source" to 101, "target" to 102)) store.rememberConversation(JSONObject().put("id", id).put("title", "同名")
            .put("submissionContext", association(sdk)).put("model", JSONObject().put("provider", "fixture").put("modelId", "text").put("name", "Test")))
    }
    private fun request(action: String = "explicit-route") = JSONObject().put("actionId", action).put("id", "target").put("text", "明确转交的正文 北京🌍")
        .put("source", JSONObject().put("id", "source").put("sdkConversationId", 101).put("controlGeneration", 1).put("taskId", 333))
        .put("expectedContext", association(102)).put("expectedControlVersion", 0)
    private fun receipt(intent: JSONObject) = JSONObject().put("protocol", 1).put("intentId", intent.getString("intentId"))
        .put("id", "target").put("inputToken", intent.getString("inputToken")).put("inputRevision", intent.getLong("inputRevision"))
        .put("inputDigest", intent.getString("inputDigest")).put("context", association(102)).put("queue", intent.getJSONObject("queue"))
        .put("controlGeneration", intent.getLong("controlGeneration")).put("bindingId", "adopted-binding").put("submissionId", 700)
        .put("source", JSONObject(intent.getJSONObject("source").toString()))
    private fun rejected(code: String, run: () -> Unit) { try { run(); fail("Expected $code") } catch (error: NativeInputException) { assertEquals(code, error.code) } }
    @Test fun routeIsIndependentFixedInputAndAckNeverClearsEvenAnIdenticalTargetDraft() {
        val namespace = "input-test-${UUID.randomUUID()}"
        lateinit var original: JSONObject
        NativeInputStore(context, namespace, boundary = { if (it == "send.ack.draft-read") error("Route ACK read the target draft") }).use { store ->
            seed(store)
            store.save("target", 0, "target-draft", request().getString("text"), emptyList())
            val before = store.inspect("target").toString()
            original = store.createRoute(request())
            assertEquals("source", original.getJSONObject("source").getString("id"))
            assertEquals(request().getString("text"), store.readFrozen(original.getString("inputToken")).getString("text"))
            assertEquals(before, store.inspect("target").toString())
            val ack = store.confirmAdmission(original.getString("intentId"), receipt(original))
            assertEquals("route", ack.getString("kind")); assertFalse(ack.has("draft"))
            assertFalse(ack.getBoolean("draftCleared")); assertEquals(before, store.inspect("target").toString())
        }
        NativeInputStore(context, namespace).use { store ->
            val same = store.createRoute(request())
            assertEquals(original.getString("inputToken"), same.getString("inputToken"))
            assertEquals(700, same.getJSONObject("receipt").getInt("submissionId"))
            assertFalse(store.confirmAdmission(same.getString("intentId"), receipt(same)).has("draft"))
            assertEquals(1, store.listSends(JSONObject().put("id", "target")).getJSONArray("intents").length())
            assertEquals(request().getString("text"), store.inspect("target").getString("text"))
        }
    }
    @Test fun sourceAndTargetControlsLocationAndPayloadAreCheckedBeforeAnyRouteIsStored() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            seed(store)
            val wrongLocation = request("location"); wrongLocation.getJSONObject("expectedContext").getJSONObject("location").put("version", 2)
            rejected("SUBMISSION_CONTEXT_CONFLICT") { store.createRoute(wrongLocation) }
            store.beginLocationEdit("edit")
            rejected("LOCATION_EDIT_PENDING") { store.createRoute(request("fenced")) }
            store.finishLocationEdit("edit", JSONArray().put(JSONObject().put("id", "source").put("context", association(101))).put(JSONObject().put("id", "target").put("context", association(102))))
            val initial = store.createRoute(request())
            rejected("INPUT_OPERATION_CONFLICT") { store.createRoute(request().put("text", "different")) }
            rejected("INPUT_OPERATION_CONFLICT") { store.confirmAdmission(initial.getString("intentId"), receipt(initial).apply { getJSONObject("source").put("controlGeneration", 2) }) }
            assertEquals(1, initial.getJSONObject("source").getLong("controlGeneration"))
            val stopped = store.requestStop(JSONObject().put("id", "source").put("actionId", "source-stop").put("expectedControlVersion", 0))
            assertTrue(store.readSend(initial.getString("intentId")).getBoolean("sourceCancelled"))
            assertFalse(store.readSend(initial.getString("intentId")).getBoolean("cancelled"))
            rejected("SOURCE_STOPPED") { store.createRoute(request("old-source")) }
            store.confirmAbort("source", stopped.getJSONObject("pendingAbort"))
            rejected("SOURCE_STOPPED") { store.createRoute(request("after-abort")) }
            val accepted = store.confirmAdmission(initial.getString("intentId"), receipt(initial)).getJSONObject("intent")
            assertTrue(accepted.getBoolean("sourceCancelled")); assertFalse(accepted.getBoolean("cancelled"))
            assertEquals(0, store.readControl("target").getLong("stoppedThrough"))
            store.requestStop(JSONObject().put("id", "target").put("actionId", "target-after-source").put("expectedControlVersion", 0))
            assertTrue(store.readSend(initial.getString("intentId")).getBoolean("cancelled"))
            assertEquals(1, store.listSends(JSONObject().put("id", "target")).getJSONArray("intents").length())
        }
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            seed(store); store.requestStop(JSONObject().put("id", "target").put("actionId", "target-stop").put("expectedControlVersion", 0))
            rejected("TARGET_STOPPED") { store.createRoute(request()) }; assertEquals(0, store.listSends().getJSONArray("intents").length())
        }
    }
    @Test fun nativeCommitAndReceiptLossRetainOnlyCommittedIndependentInput() {
        for (stage in listOf("route.intent.beforeCommit", "route.intent.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"
            NativeInputStore(context, namespace).use { seed(it); it.save("target", 0, "draft", "unrelated unsent text", emptyList()) }
            NativeInputStore(context, namespace, boundary = { if (it == stage) throw IllegalStateException("Synthetic response loss") }).use { store ->
                if (stage.endsWith("beforeCommit")) rejected("INPUT_STORAGE_FAILED") { store.createRoute(request()) }
                else try { store.createRoute(request()); fail("Expected response loss after commit") } catch (error: IllegalStateException) { assertEquals("Synthetic response loss", error.message) }
            }
            NativeInputStore(context, namespace).use { store ->
                assertEquals(if (stage.endsWith("afterCommit")) 1 else 0, store.listSends().getJSONArray("intents").length())
                val fixed = store.createRoute(request()); assertEquals("unrelated unsent text", store.inspect("target").getString("text"))
                assertEquals(request().getString("text"), store.readFrozen(fixed.getString("inputToken")).getString("text"))
                rejected("INPUT_IN_USE") { store.discard(fixed.getString("inputToken"), "discard-route") }
            }
        }
    }
}
