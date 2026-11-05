package dev.durableagent.termuxprobe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "dev.durableagent.termuxprobe.RESULT" || intent.data?.host != "result") return
        val nonce = intent.data?.lastPathSegment ?: return
        val bundle = intent.getBundleExtra("result")
        @Suppress("DEPRECATION")
        val wire = bundle?.keySet()?.associateWith { bundle.get(it) }.orEmpty()
        val result = decodeTermuxResult(wire)
        val pending = goAsync()
        (context.applicationContext as ProbeApplication).receive(nonce, result) { pending.finish() }
    }
}
