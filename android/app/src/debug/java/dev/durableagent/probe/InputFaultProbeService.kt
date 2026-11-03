package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.os.*
import org.json.JSONObject
import java.util.concurrent.CountDownLatch

/** Dedicated debug-only process, synthetic namespaces only. Main thread remains available to kill. */
class InputFaultProbeService : Service() {
    private val worker = HandlerThread("input-fault-operation").apply { start() }
    private val work = Handler(worker.looper)
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { message ->
        if (message.what == 2) { Process.killProcess(Process.myPid()); return@Handler true }
        val data = Bundle(message.data); val reply = message.replyTo
        work.post {
            try {
                val namespace = data.getString("namespace")!!
                require(namespace.matches(Regex("input-test-[a-zA-Z0-9-]+")))
                val stage = data.getString("stage")!!
                NativeInputStore(this, namespace, boundary = { actual ->
                    if (actual == stage) {
                        send(reply, JSONObject().put("stage", actual).put("pid", Process.myPid()))
                        CountDownLatch(1).await() // Test runner explicitly kills this process at the observed boundary.
                    }
                }).use { store ->
                    val result = when (data.getString("action")) {
                        "save" -> store.save("chat", 1, "interrupted-save", "committed after interruption", emptyList())
                        "prepare" -> store.prepare("chat", data.getString("selection")!!, "interrupted-prepare")
                        "freeze" -> store.freeze("chat", 1, "interrupted-freeze")
                        else -> error("Unknown synthetic action")
                    }
                    send(reply, JSONObject().put("unexpectedCompletion", result))
                }
            } catch (_: Exception) { send(reply, JSONObject().put("error", "Synthetic fault operation failed before expected boundary")) }
        }
        true
    })
    private fun send(target: Messenger, value: JSONObject) { target.send(Message.obtain(null, 1).apply { data = Bundle().apply { putString("value", value.toString()) } }) }
    override fun onBind(intent: Intent): IBinder = messenger.binder
    override fun onDestroy() { worker.quitSafely(); super.onDestroy() }
}
