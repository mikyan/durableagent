package dev.durableagent.probe

import android.content.*
import android.os.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Actual process death around native commits; SDK commit windows are covered separately. */
@RunWith(AndroidJUnit4::class)
class NativeSubmissionCrashTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun association() = JSONObject().put("sdkConversationId", 901).put("associationVersion", 1)
        .put("location", JSONObject().put("workspaceId", "default").put("version", 1).put("identity", "synthetic-crash-location"))
    private fun queue() = JSONObject().put("whenBusy", "followUp").put("whenIdle", "start")
    private fun seed(namespace: String): JSONObject = NativeInputStore(context, namespace).use { store ->
        store.rememberConversation(JSONObject().put("id", "chat").put("title", "Synthetic native crash")
            .put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation")).put("submissionContext", association()),
            JSONObject().put("version", "validation-1").put("provider", "validation").put("modelId", "text").put("source", "validation")
                .put("input", JSONArray(listOf("text"))).put("limits", JSONObject()).put("applicationPolicy", JSONObject()))
        store.save("chat", 0, "draft", "original crash-window input 北京🌍", emptyList())
        val frozen = store.freeze("chat", 1, "freeze")
        JSONObject().put("id", "chat").put("actionId", "same-explicit-action").put("inputToken", frozen.getString("token"))
            .put("expectedContext", association()).put("expectedControlVersion", 0).put("queue", queue())
    }
    private fun receipt(intent: JSONObject) = JSONObject().put("protocol", 1).put("intentId", intent.getString("intentId"))
        .put("id", "chat").put("inputToken", intent.getString("inputToken")).put("inputRevision", intent.getLong("inputRevision"))
        .put("inputDigest", intent.getString("inputDigest")).put("context", association()).put("queue", queue())
        .put("controlGeneration", intent.getLong("controlGeneration")).put("bindingId", "synthetic-verified-sdk-binding").put("submissionId", 701)
    private fun kill(namespace: String, stage: String, request: JSONObject) {
        val connected = CompletableFuture<IBinder>(); val reached = CompletableFuture<JSONObject>(); val died = CompletableFuture<Unit>()
        val incoming = Messenger(Handler(Looper.getMainLooper()) { message -> reached.complete(JSONObject(message.data.getString("value")!!)); true })
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) { binder.linkToDeath({ died.complete(Unit) }, 0); connected.complete(binder) }
            override fun onServiceDisconnected(name: ComponentName) { died.complete(Unit) }
        }
        check(context.bindService(Intent(context, SubmissionFaultProbeService::class.java), connection, Context.BIND_AUTO_CREATE))
        try {
            val remote = Messenger(connected.get(10, TimeUnit.SECONDS))
            remote.send(Message.obtain(null, 1).apply { replyTo = incoming; data = Bundle().apply { putString("namespace", namespace); putString("stage", stage); putString("request", request.toString()) } })
            val observed = reached.get(15, TimeUnit.SECONDS)
            assertEquals(stage, observed.optString("stage")); assertNotEquals(Process.myPid(), observed.getInt("pid"))
            remote.send(Message.obtain(null, 2)); died.get(10, TimeUnit.SECONDS)
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("nativeSubmissionCrashEvidence", JSONObject().put("stage", stage).put("separateProcessKilled", true).toString()) })
        } finally { context.unbindService(connection) }
    }
    @Test fun processDeathBeforeAndAfterNativeIntentCommitRecoversOnlyTheSameAction() {
        for (stage in listOf("send.intent.beforeCommit", "send.intent.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; val request = seed(namespace)
            kill(namespace, stage, request)
            NativeInputStore(context, namespace).use { store ->
                assertEquals(if (stage.endsWith("beforeCommit")) 0 else 1, store.listSends().getJSONArray("intents").length())
                store.save("chat", 1, "later-unsent-edit", "later draft was never sent", emptyList())
                val recovered = store.createSend(request)
                assertEquals("same-explicit-action", recovered.getString("intentId")); assertEquals(1L, recovered.getLong("inputRevision"))
                assertEquals("original crash-window input 北京🌍", store.readFrozen(recovered.getString("inputToken")).getString("text"))
                assertEquals("later draft was never sent", store.inspect("chat").getString("text"))
                assertEquals(recovered.toString(), store.createSend(request).toString()); assertEquals(1, store.listSends().getJSONArray("intents").length())
            }
        }
    }
    @Test fun processDeathBeforeAndAfterNativeAckNeverDeletesLaterDraftOrChangesReceipt() {
        for (stage in listOf("send.ack.beforeCommit", "send.ack.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; val request = seed(namespace)
            val intent = NativeInputStore(context, namespace).use { it.createSend(request) }; val receipt = receipt(intent)
            kill(namespace, stage, JSONObject().put("intentId", intent.getString("intentId")).put("receipt", receipt))
            NativeInputStore(context, namespace).use { store ->
                val beforeCommit = stage.endsWith("beforeCommit")
                assertEquals(if (beforeCommit) "pending" else "acknowledged", store.readSend(intent.getString("intentId")).getString("delivery"))
                val draft = store.inspect("chat"); assertEquals(if (beforeCommit) 1L else 2L, draft.getLong("revision"))
                assertEquals(if (beforeCommit) "original crash-window input 北京🌍" else "", draft.getString("text"))
                store.save("chat", draft.getLong("revision"), "later-edit", "preserve edits after interruption", emptyList())
                val ack = store.confirmAdmission(intent.getString("intentId"), receipt)
                assertFalse(ack.getBoolean("draftCleared")); assertEquals("preserve edits after interruption", ack.getJSONObject("draft").getString("text"))
                assertEquals(receipt.toString(), ack.getJSONObject("intent").getJSONObject("receipt").toString())
                assertEquals(1, store.listSends().getJSONArray("intents").length())
            }
        }
    }
    @Test fun processDeathBeforeAndAfterStopCommitKeepsItsFenceAndPendingAbortTruthful() {
        for (stage in listOf("send.stop.beforeCommit", "send.stop.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; val request = seed(namespace)
            NativeInputStore(context, namespace).use { it.createSend(request) }
            val stop = JSONObject().put("id", "chat").put("actionId", "same-stop-action").put("expectedControlVersion", 0)
            kill(namespace, stage, stop)
            NativeInputStore(context, namespace).use { store ->
                assertEquals(!stage.endsWith("beforeCommit"), store.readSend("same-explicit-action").getBoolean("cancelled"))
                assertEquals(if (stage.endsWith("beforeCommit")) 0 else 1, store.pendingStops().length())
                val recovered = store.requestStop(stop)
                assertEquals(1L, recovered.getLong("version")); assertTrue(store.readSend("same-explicit-action").getBoolean("cancelled"))
                assertEquals(recovered.toString(), store.requestStop(stop).toString())
                val barrier = recovered.getJSONObject("pendingAbort"); val confirmed = store.confirmAbort("chat", barrier)
                assertFalse(confirmed.has("pendingAbort")); assertEquals(1L, confirmed.getLong("stoppedThrough"))
                assertEquals(confirmed.toString(), store.confirmAbort("chat", barrier).toString())
            }
        }
    }
}
