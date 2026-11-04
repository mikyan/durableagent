package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.os.*
import org.json.JSONObject
import java.util.concurrent.CountDownLatch

/** Native-only interruption fixture. The host/SDK database is never opened in this process. */
class SubmissionFaultProbeService : Service() {
    private val thread = HandlerThread("submission-fault").apply { start() }
    private val worker = Handler(thread.looper)
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { message ->
        if (message.what == 2) { Process.killProcess(Process.myPid()); return@Handler true }
        val data = Bundle(message.data); val target = message.replyTo
        worker.post {
            try {
                val namespace = data.getString("namespace")!!
                require(namespace.matches(Regex("input-test-[a-zA-Z0-9-]+")))
                val stage = data.getString("stage")!!
                require(stage in listOf("send.intent.beforeCommit", "send.intent.afterCommit", "send.ack.beforeCommit", "send.ack.afterCommit", "send.stop.beforeCommit", "send.stop.afterCommit",
                    "location.edit.begin.beforeCommit", "location.edit.begin.afterCommit", "location.edit.finish.beforeCommit", "location.edit.finish.afterCommit"))
                NativeInputStore(this, namespace, boundary = { actual ->
                    if (actual == stage) {
                        reply(target, JSONObject().put("stage", actual).put("pid", Process.myPid()))
                        CountDownLatch(1).await()
                    }
                }).use { store ->
                    val request = JSONObject(data.getString("request")!!)
                    val result = when {
                        stage.startsWith("location.edit.begin.") -> store.beginLocationEdit(request.getString("operationId"))
                        stage.startsWith("location.edit.finish.") -> { store.finishLocationEdit(request.getString("operationId"), request.getJSONArray("contexts")); JSONObject.NULL }
                        stage.startsWith("send.intent.") -> store.createSend(request)
                        stage.startsWith("send.ack.") -> store.confirmAdmission(request.getString("intentId"), request.getJSONObject("receipt"))
                        else -> store.requestStop(request)
                    }
                    reply(target, JSONObject().put("unexpectedCompletion", result))
                }
            } catch (_: Exception) { reply(target, JSONObject().put("error", "Synthetic native operation failed before the requested boundary")) }
        }
        true
    })
    private fun reply(target: Messenger, value: JSONObject) { target.send(Message.obtain(null, 1).apply { data = Bundle().apply { putString("value", value.toString()) } }) }
    override fun onBind(intent: Intent): IBinder = messenger.binder
    override fun onDestroy() { thread.quitSafely(); super.onDestroy() }
}
