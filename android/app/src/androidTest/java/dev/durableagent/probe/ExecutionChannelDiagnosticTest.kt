package dev.durableagent.probe

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Temporary diagnostic; no model request, setup, pairing reset, or original-file write. */
@RunWith(AndroidJUnit4::class)
class ExecutionChannelDiagnosticTest {
    @Test(timeout=25000) fun namespacedJavetPingInAgentProcessPreservesNativeCode() = observe("ping")
    @Test(timeout=25000) fun namespacedJavetFileStatInAgentProcessPreservesNativeCode() = observe("file")
    @Test(timeout=25000) fun namespacedJavetReadOnlyCommandInAgentProcessPreservesNativeCode() = observe("command")

    private fun observe(operation: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val replies = LinkedBlockingQueue<JSONObject>()
        val receiver = Messenger(Handler(Looper.getMainLooper()) { message ->
            replies.offer(JSONObject(message.data.getString("json")!!)); true
        })
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) {
                Messenger(service).send(Message.obtain(null, 1).apply { replyTo = receiver; data = Bundle().apply { putString("operation", operation) } })
            }
            override fun onServiceDisconnected(name: ComponentName) { }
        }
        val started = SystemClock.elapsedRealtime()
        assertTrue(context.bindService(Intent().setComponent(ComponentName(context, "dev.durableagent.probe.ExecutionChannelProbeService")), connection, Context.BIND_AUTO_CREATE))
        try {
            val result = replies.poll(20, TimeUnit.SECONDS) ?: error("Diagnostic service did not respond; no transport error code observed")
            result.put("elapsedMs", SystemClock.elapsedRealtime() - started)
            instrumentation.sendStatus(0, Bundle().apply { putString("executionChannelDiagnostic", result.toString()) })
            assertTrue(result.toString(), result.getString("process").endsWith(":agent"))
            assertTrue(result.toString(), result.getBoolean("ok"))
        } finally { context.unbindService(connection) }
    }
}
