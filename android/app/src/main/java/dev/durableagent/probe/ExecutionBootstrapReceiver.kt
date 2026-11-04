package dev.durableagent.probe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
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
                val stdout = wire["stdout"] as? String
                val stderr = wire["stderr"] as? String
                val complete = stdout != null && stderr != null && stdout.length <= 16384 && stderr.length <= 16384 &&
                    (wire["stdout_original_length"] as? String)?.toIntOrNull() == stdout.length &&
                    (wire["stderr_original_length"] as? String)?.toIntOrNull() == stderr.length
                val valid = complete && wire["err"] == -1 && wire["exitCode"] == 0
                val receipt = if (valid) JSONObject().put("ok",true).put("stdout",stdout)
                    else JSONObject().put("ok",false).put("error",if (wire["exitCode"] == 78) "SETUP_REQUIRED" else "BOOTSTRAP_UNCONFIRMED")
                ExecutionBootstrapStore(context).use { it.complete(nonce,receipt.toString()) }
            } catch (_: Exception) { /* Missing/malformed/expired receipts remain unconfirmed; no raw platform diagnostics. */ }
            finally { pending.finish() }
        }
    }
    companion object {
        const val ACTION = "dev.durableagent.probe.EXECUTION_BOOTSTRAP"
        private val worker = Executors.newSingleThreadExecutor { task -> Thread(task,"ExecutionBootstrapReceipt").apply { isDaemon=true } }
    }
}
