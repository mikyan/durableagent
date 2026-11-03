package dev.durableagent.probe

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.zip.CRC32
import kotlin.math.min

/** Bounded local conversion. No network, thumbnail substitution, truncation or SDK submission. */
internal object NativeAttachmentPreparation {
    const val TEXT_BYTES = 256 * 1024
    const val IMAGE_SOURCE_BYTES = 16 * 1024 * 1024
    const val IMAGE_BYTES = 1536 * 1024
    const val IMAGE_PIXELS = 24L * 1024 * 1024
    const val IMAGE_EDGE = 1024
    data class Prepared(val bytes: ByteArray, val representation: JSONObject)

    fun sourceBudget(mime: String): Int = when {
        mime == "image/png" || mime == "image/jpeg" -> IMAGE_SOURCE_BYTES
        mime == "text/plain" || mime == "text/markdown" -> TEXT_BYTES
        else -> throw NativeInputException("INPUT_UNSUPPORTED", "此格式尚不支持正文准备，模型尚未收到正文。")
    }

    fun prepare(bytes: ByteArray, mime: String, capability: JSONObject): Prepared {
        val limits = capability.getJSONObject("limits"); val input = capability.getJSONArray("input")
        val supported = (0 until input.length()).map { input.getString(it) }
        val rep = JSONObject().put("range", "full").put("capabilityVersion", capability.getString("version"))
        if (mime == "text/plain" || mime == "text/markdown") {
            if ("text" !in supported) throw NativeInputException("INPUT_UNSUPPORTED", "当前模型未声明文本输入能力。")
            if (bytes.size > TEXT_BYTES) throw NativeInputException("INPUT_BUDGET_EXCEEDED", "文本超过全文准备预算，未截断正文。")
            try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)) }
            catch (_: Exception) { throw NativeInputException("INPUT_UNSUPPORTED", "文件不是有效的 UTF-8 全文，请选择受支持的文本文件。") }
            return Prepared(bytes, rep.put("kind", "text").put("mimeType", "text/plain").put("transformation", "UTF-8 全文，未截断"))
        }
        if ("image" !in supported) throw NativeInputException("INPUT_UNSUPPORTED", "当前模型未声明图片输入能力；未发送此图片。")
        validateImage(bytes, mime)
        var originalWidth = 0; var originalHeight = 0
        val bitmap = try {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                originalWidth = info.size.width; originalHeight = info.size.height
                if (originalWidth <= 0 || originalHeight <= 0 || originalWidth.toLong() * originalHeight > IMAGE_PIXELS)
                    throw NativeInputException("INPUT_BUDGET_EXCEEDED", "图片像素超过本地解码预算，未缩略替代正文。")
                val maxWidth = min(IMAGE_EDGE, limits.optInt("maxWidth", IMAGE_EDGE)); val maxHeight = min(IMAGE_EDGE, limits.optInt("maxHeight", IMAGE_EDGE))
                if (maxWidth <= 0 || maxHeight <= 0) throw NativeInputException("INPUT_UNSUPPORTED", "当前图片能力限制无效。")
                val scale = min(1.0, min(maxWidth.toDouble() / originalWidth, maxHeight.toDouble() / originalHeight))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setOnPartialImageListener { false }
                decoder.setTargetSize(maxOf(1, (originalWidth * scale).toInt()), maxOf(1, (originalHeight * scale).toInt()))
            }
        } catch (error: NativeInputException) { throw error }
        catch (_: Exception) { throw NativeInputException("INPUT_UNSUPPORTED", "图片损坏或无法完整解码，未采用部分图片。") }
        try {
            val output = ByteArrayOutputStream()
            val format = if (mime == "image/png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            if (!bitmap.compress(format, 85, output)) throw NativeInputException("INPUT_PREPARATION_FAILED", "图片转换失败。")
            val result = output.toByteArray(); val base64Bytes = 4L * ((result.size + 2L) / 3L)
            if (result.size > IMAGE_BYTES || base64Bytes > limits.optLong("maxBase64Bytes", 2L * 1024 * 1024))
                throw NativeInputException("INPUT_BUDGET_EXCEEDED", "完整图片表示超过准备预算，请主动选择较小图片；未继续降低质量或截取内容。")
            return Prepared(result, rep.put("kind", "image").put("mimeType", mime).put("width", bitmap.width).put("height", bitmap.height)
                .put("sourceWidth", originalWidth).put("sourceHeight", originalHeight)
                .put("transformation", if (mime == "image/png") "完整画面，按方向解码并缩放，保留透明度" else "完整画面，按方向解码并缩放，JPEG 质量 85"))
        } finally { bitmap.recycle() }
    }

    private fun validateImage(bytes: ByteArray, mime: String) {
        fun invalid(): Nothing = throw NativeInputException("INPUT_UNSUPPORTED", "图片格式或完整性检查失败，未采用损坏内容。")
        if (bytes.size > IMAGE_SOURCE_BYTES) throw NativeInputException("INPUT_BUDGET_EXCEEDED", "图片原件超过本地读取预算。")
        if (mime == "image/jpeg") {
            if (bytes.size < 4 || bytes[0] != 0xff.toByte() || bytes[1] != 0xd8.toByte() || bytes[bytes.size - 2] != 0xff.toByte() || bytes.last() != 0xd9.toByte()) invalid()
            return
        }
        if (mime != "image/png" || bytes.size < 8 || !bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(-119,80,78,71,13,10,26,10))) invalid()
        var offset = 8; var imageData = false; var first = true
        while (offset + 12 <= bytes.size) {
            val length = ByteBuffer.wrap(bytes, offset, 4).int
            if (length < 0 || offset.toLong() + length + 12 > bytes.size) invalid()
            val type = bytes.copyOfRange(offset + 4, offset + 8).toString(Charsets.US_ASCII)
            if (first && (type != "IHDR" || length != 13)) invalid(); first = false
            val crc = CRC32().apply { update(bytes, offset + 4, length + 4) }.value
            val actual = ByteBuffer.wrap(bytes, offset + length + 8, 4).int.toLong() and 0xffffffffL
            if (crc != actual) invalid()
            if (type == "IDAT") imageData = true
            offset += length + 12
            if (type == "IEND") { if (length != 0 || offset != bytes.size || !imageData) invalid(); return }
        }
        invalid()
    }
}
