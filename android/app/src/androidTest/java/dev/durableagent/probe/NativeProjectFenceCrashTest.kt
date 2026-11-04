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

/** Actual native process death; canonical SDK recovery decisions are covered by the core suite. */
@RunWith(AndroidJUnit4::class)
class NativeProjectFenceCrashTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun association(sdk: Int = 101, updated: Boolean = false) = JSONObject().put("sdkConversationId", sdk).put("associationVersion", if (updated) 2 else 1)
        .put("location", JSONObject().put("workspaceId", if (updated) "project" else "default").put("version", 1).put("identity", if (updated) "directory-two" else "directory-one"))
    private fun contexts(updated: Boolean) = JSONArray().put(JSONObject().put("id", "chat").put("context", association(updated = updated)))
        .put(JSONObject().put("id", "other").put("context", association(sdk = 102, updated = updated)))
    private fun seed(namespace: String): JSONObject = NativeInputStore(context, namespace).use { store ->
        for ((id, sdk) in listOf(Pair("chat", 101), Pair("other", 102))) store.rememberConversation(JSONObject().put("id", id).put("title", "Synthetic location crash")
            .put("model", JSONObject().put("provider", "validation").put("modelId", "text").put("name", "Validation")).put("submissionContext", association(sdk)),
            JSONObject().put("version", "validation-1").put("provider", "validation").put("modelId", "text").put("source", "validation").put("input", JSONArray(listOf("text"))).put("limits", JSONObject()).put("applicationPolicy", JSONObject()))
        store.save("chat", 0, "draft", "preserved location crash draft 北京🌍", emptyList())
        store.freeze("chat", 1, "freeze")
    }
    private fun interrupt(namespace: String, stage: String) {
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
                putString("request", JSONObject().put("operationId", "same-edit").put("contexts", contexts(true)).toString())
            } })
            val observed = reached.get(15, TimeUnit.SECONDS)
            assertEquals(stage, observed.optString("stage")); assertNotEquals(Process.myPid(), observed.getInt("pid"))
            remote.send(Message.obtain(null, 2)); died.get(10, TimeUnit.SECONDS)
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("nativeProjectFenceCrashEvidence", JSONObject().put("stage", stage).put("separateProcessKilled", true).toString()) })
        } finally { context.unbindService(connection) }
    }
    @Test fun processDeathAcrossFenceAndPublicationCommitsRecoversOnlyCommittedContexts() {
        for (stage in listOf("location.edit.begin.beforeCommit", "location.edit.begin.afterCommit", "location.edit.finish.beforeCommit", "location.edit.finish.afterCommit")) {
            val namespace = "input-test-${UUID.randomUUID()}"; val frozen = seed(namespace)
            if (stage.startsWith("location.edit.finish.")) NativeInputStore(context, namespace).use { it.beginLocationEdit("same-edit") }
            interrupt(namespace, stage)
            NativeInputStore(context, namespace).use { store ->
                val published = stage == "location.edit.finish.afterCommit"
                val fenced = stage == "location.edit.begin.afterCommit" || stage == "location.edit.finish.beforeCommit"
                assertEquals(fenced, store.readLocationEdit() != null)
                assertEquals(association(updated = published).toString(), store.inspect("chat").getJSONObject("submissionContext").toString())
                assertEquals(association(sdk = 102, updated = published).toString(), store.inspect("other").getJSONObject("submissionContext").toString())
                assertEquals(frozen.getString("text"), store.inspect("chat").getString("text"))
                if (fenced) {
                    assertEquals(1, store.readLocationEdit()!!.length()) // Identity only; no durable proposed edit to replay.
                    store.finishLocationEdit("same-edit", contexts(false))
                }
                assertNull(store.readLocationEdit())
                val intent = store.createSend(JSONObject().put("id", "chat").put("actionId", "explicit-after-recovery").put("inputToken", frozen.getString("token"))
                    .put("expectedContext", association(updated = published)).put("expectedControlVersion", 0).put("queue", JSONObject().put("whenBusy", "followUp").put("whenIdle", "start")))
                assertEquals(association(updated = published).toString(), intent.getJSONObject("context").toString())
            }
        }
    }
}
