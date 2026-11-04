package dev.durableagent.probe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/** Non-exported. Only the explicit one-shot PendingIntent is handed to pinned Termux. */
class ExecutionBootstrapReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION || intent.data?.scheme != "durableagent-execution" || intent.data?.host != "bootstrap") return
        val nonce = intent.data?.lastPathSegment?.takeIf { it.matches(Regex("[a-f0-9-]{36}")) } ?: return
        val pending = goAsync()
        worker.execute {
            try {
                val bundle = intent.getBundleExtra("result")
                @Suppress("DEPRECATION")
                val wire = bundle?.keySet()?.associateWith { bundle.get(it) }.orEmpty()
                val receipt=decodeExecutionBootstrapResult(nonce,wire)
                ExecutionBootstrapStore(context).use { it.complete(nonce,receipt) }
            } catch (_: Exception) { /* Missing/malformed/expired receipts remain unconfirmed; no raw platform diagnostics. */ }
            finally { pending.finish() }
        }
    }
    companion object {
        const val ACTION = "dev.durableagent.probe.EXECUTION_BOOTSTRAP"
        private val worker = Executors.newSingleThreadExecutor { task -> Thread(task,"ExecutionBootstrapReceipt").apply { isDaemon=true } }
    }
}
