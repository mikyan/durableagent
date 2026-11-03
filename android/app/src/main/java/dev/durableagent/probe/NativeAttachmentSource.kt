package dev.durableagent.probe

import android.content.ContentResolver
import android.net.Uri
import android.os.CancellationSignal
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Only native-selected content URIs enter this boundary. Paths/URIs never become UI capabilities. */
internal class NativeAttachmentSource(private val resolver: ContentResolver) {
    fun describe(uri: Uri): JSONObject {
        if (uri.scheme != "content") throw NativeInputException("INPUT_SOURCE_UNAVAILABLE", "请选择系统文件选择器提供的来源。")
        val source = JSONObject().put("name", "附件").put("mimeType", resolver.getType(uri) ?: "application/octet-stream").put("access", "unknown")
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
            if (it.moveToFirst()) {
                val name = it.getColumnIndex(OpenableColumns.DISPLAY_NAME); val size = it.getColumnIndex(OpenableColumns.SIZE)
                if (name >= 0 && !it.isNull(name)) source.put("name", it.getString(name).take(200))
                if (size >= 0 && !it.isNull(size) && it.getLong(size) >= 0) source.put("byteLength", it.getLong(size))
            }
        }
        return source
    }

    fun read(uri: Uri, maximum: Int, signal: CancellationSignal = CancellationSignal()): ByteArray {
        // Includes provider opening as well as reading; cancellation remains cooperative with the provider.
        val deadline = deadlines.schedule({ signal.cancel() }, 30, TimeUnit.SECONDS)
        try {
            val asset = resolver.openAssetFileDescriptor(uri, "r", signal)
                ?: throw NativeInputException("INPUT_SOURCE_UNAVAILABLE", "无法读取所选原文件，请重新选择。")
            asset.use { descriptor ->
                signal.setOnCancelListener { try { asset.close() } catch (_: Exception) { } }
                signal.throwIfCanceled()
                descriptor.createInputStream().use { input ->
            val output = ByteArrayOutputStream(minOf(maximum, 32 * 1024)); val buffer = ByteArray(16 * 1024)
            while (true) {
                signal.throwIfCanceled()
                val count = input.read(buffer); if (count < 0) break
                if (output.size().toLong() + count > maximum) throw NativeInputException("INPUT_BUDGET_EXCEEDED", "原文件超过本地读取预算，未截断正文。")
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        } } } finally { deadline.cancel(false); signal.setOnCancelListener(null) }
    }

    fun available(uri: Uri): Boolean = try { resolver.openAssetFileDescriptor(uri, "r")?.use { true } ?: false } catch (_: Exception) { false }

    fun readStable(uri: Uri, maximum: Int, expected: String? = null, signal: CancellationSignal = CancellationSignal()): ByteArray {
        val first = read(uri, maximum, signal)
        val hash = NativeInputStore.sha256(first)
        if (expected != null && hash != expected) throw NativeInputException("INPUT_SOURCE_CHANGED", "原文件内容已变化，请重新选择；已有固定输入不会被替换。")
        val second = read(uri, maximum, signal)
        if (hash != NativeInputStore.sha256(second)) throw NativeInputException("INPUT_SOURCE_CHANGED", "读取期间原文件发生变化，未采用不确定内容，请重新选择。")
        return first
    }
    companion object { private val deadlines = Executors.newSingleThreadScheduledExecutor { runnable -> Thread(runnable, "input-source-deadline").apply { isDaemon = true } } }
}
