package dev.durableagent.probe

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Independent synthetic provider, installed by the device runner. No user document is touched. */
object ExternalInputFixture {
    const val PACKAGE = "dev.durableagent.inputsource"
    val TEXT_URI: Uri = Uri.parse("content://$PACKAGE.documents/document/text")
    val TEXT_BYTES: ByteArray get() = "原始外部来源 UTF-8：中文🌍\n".toByteArray(Charsets.UTF_8)
    fun control(context: Context, operation: String, document: String = "text"): JSONObject {
        val result = CompletableFuture<JSONObject>()
        context.sendOrderedBroadcast(Intent().setComponent(ComponentName(PACKAGE, "$PACKAGE.ControlReceiver"))
            .putExtra("operation", operation).putExtra("document", document).putExtra("targetPackage",context.packageName), null,
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    try {
                        check(resultCode == 0) { "Synthetic external provider operation failed: $operation ($resultCode)" }
                        result.complete(JSONObject(resultData ?: "{}"))
                    } catch (error: Exception) { result.completeExceptionally(error) }
                }
            }, Handler(Looper.getMainLooper()), -99, null, null)
        return result.get(10, TimeUnit.SECONDS)
    }
}
