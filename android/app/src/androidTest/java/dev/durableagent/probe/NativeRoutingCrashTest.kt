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

/** Real dedicated native PID death; SDK-side admission is checked separately through Application. */
@RunWith(AndroidJUnit4::class)
class NativeRoutingCrashTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun association(sdk: Int) = JSONObject().put("sdkConversationId", sdk).put("associationVersion", 1)
        .put("location", JSONObject().put("workspaceId", "default").put("version", 1).put("identity", "route-crash-workspace"))
    private fun request() = JSONObject().put("actionId", "same-route").put("id", "target").put("text", "stable routed input 北京🌍")
        .put("source", JSONObject().put("id", "source").put("sdkConversationId", 101).put("controlGeneration", 1))
        .put("expectedContext", association(102)).put("expectedControlVersion", 0)
    private fun seed(namespace: String) = NativeInputStore(context, namespace).use { store ->
        for ((id, sdk) in listOf("source" to 101, "target" to 102)) store.rememberConversation(JSONObject().put("id", id).put("title", "route crash")
            .put("model", JSONObject().put("provider", "fixture").put("modelId", "m").put("name", "Fixture")).put("submissionContext", association(sdk)))
        store.save("target", 0, "draft", "not sent by transfer", emptyList())
    }
    private fun receipt(intent: JSONObject): JSONObject = JSONObject().put("protocol", 1).put("intentId", intent.getString("intentId"))
        .put("id", "target").put("inputToken", intent.getString("inputToken")).put("inputRevision", intent.getLong("inputRevision"))
        .put("inputDigest", intent.getString("inputDigest")).put("context", association(102)).put("queue", intent.getJSONObject("queue"))
        .put("controlGeneration", 1).put("source", intent.getJSONObject("source")).put("bindingId", "fixed-binding").put("submissionId", 777)
    private fun interrupt(namespace: String, stage: String, request: JSONObject) {
        val connected = CompletableFuture<IBinder>(); val reached = CompletableFuture<JSONObject>(); val died = CompletableFuture<Unit>()
        val incoming = Messenger(Handler(Looper.getMainLooper()) { message -> reached.complete(JSONObject(message.data.getString("value")!!)); true })
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) { binder.linkToDeath({ died.complete(Unit) }, 0); connected.complete(binder) }
            override fun onServiceDisconnected(name: ComponentName) { died.complete(Unit) }
        }
        check(context.bindService(Intent(context, SubmissionFaultProbeService::class.java), connection, Context.BIND_AUTO_CREATE))
        try {
            val remote = Messenger(connected.get(10, TimeUnit.SECONDS))
            remote.send(Message.obtain(null, 1).apply { replyTo = incoming; data = Bundle().apply {
                putString("namespace", namespace); putString("stage", stage)
                putString("request", request.toString())
            } })
            val observed = reached.get(15, TimeUnit.SECONDS)
            assertEquals(stage, observed.optString("stage")); assertNotEquals(Process.myPid(), observed.getInt("pid"))
            remote.send(Message.obtain(null, 2)); died.get(10, TimeUnit.SECONDS)
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("nativeRoutingCrashEvidence", JSONObject().put("stage", stage).put("separateProcessKilled", true).toString()) })
        } finally { context.unbindService(connection) }
    }
    @Test fun realProcessDeathAcrossRouteAndAckCommitsPreservesDraftAndIdentity() {
        for (stage in listOf("route.intent.beforeCommit", "route.intent.afterCommit", "send.ack.beforeCommit", "send.ack.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; seed(namespace)
            val command = if (stage.startsWith("send.ack")) NativeInputStore(context, namespace).use { store ->
                val intent = store.createRoute(request()); JSONObject().put("intentId", intent.getString("intentId")).put("receipt", receipt(intent))
            } else request()
            interrupt(namespace, stage, command)
            NativeInputStore(context, namespace).use { store ->
                assertEquals(if (stage == "route.intent.beforeCommit") 0 else 1, store.listSends().getJSONArray("intents").length())
                val recovered = store.createRoute(request())
                assertEquals("same-route", recovered.getString("intentId"))
                assertEquals(stage == "send.ack.afterCommit", recovered.has("receipt"))
                assertEquals("not sent by transfer", store.inspect("target").getString("text"))
                assertEquals(request().getString("text"), store.readFrozen(recovered.getString("inputToken")).getString("text"))
                val ack = store.confirmAdmission("same-route", receipt(recovered)); assertFalse(ack.getBoolean("draftCleared"))
                assertEquals(777, ack.getJSONObject("intent").getJSONObject("receipt").getInt("submissionId"))
            }
        }
    }
}
