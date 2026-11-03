package dev.durableagent.probe

import android.util.Base64
import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject

/** Safe metadata actions; only explicitly annotated trusted-host methods can materialize bytes. */
class NativeInputAccess(private val store: NativeInputStore) : AutoCloseable {
    fun requestJson(method: String, payloadJson: String): String = result {
        val payload = JSONObject(payloadJson)
        fun id() = payload.getString("id")
        fun operation() = payload.getString("operationId")
        fun revision(): Long {
            val value = payload.opt("expectedRevision")
            if (value !is Number || value.toDouble() != value.toLong().toDouble() || value.toLong() < 0) throw NativeInputException("INPUT_INVALID", "草稿版本必须是有效整数。")
            return value.toLong()
        }
        when (method) {
            "input.list" -> store.list()
            "input.read" -> store.read(id())
            "input.inspect" -> store.inspect(id())
            "input.save" -> {
                val ids = payload.getJSONArray("selectionIds")
                store.save(id(), revision(), operation(), payload.getString("text"), (0 until ids.length()).map(ids::getString))
            }
            "input.clear" -> store.clear(id(), revision(), operation())
            "input.prepare" -> store.prepare(id(), payload.getString("selectionId"), operation())
            "input.freeze" -> store.freeze(id(), revision(), operation())
            "input.discard" -> store.discard(payload.getString("token"), operation())
            else -> throw NativeInputException("INPUT_UNKNOWN_ACTION", "未登记的原生输入操作。")
        }
    }

    @V8Function
    fun rememberConversationJson(conversationJson: String, capabilityJson: String?): String = result {
        store.rememberConversation(JSONObject(conversationJson), capabilityJson?.takeUnless { it == "null" }?.let(::JSONObject)); JSONObject()
    }

    @V8Function
    fun readFrozenJson(token: String): String = result { store.readFrozen(token) }

    /** Never bind to WebView. The actual SDK inline image is constructed only on explicit send. */
    @V8Function
    fun readObjectBase64(token: String, objectId: String): String = result { Base64.encodeToString(store.readObjectBytes(token, objectId), Base64.NO_WRAP) }

    private fun result(action: () -> Any): String = try { JSONObject().put("ok", true).put("value", action()).toString() }
    catch (error: NativeInputException) { JSONObject().put("ok", false).put("error", JSONObject().put("code", error.code).put("message", error.message)).toString() }
    catch (_: org.json.JSONException) { JSONObject().put("ok", false).put("error", JSONObject().put("code", "INPUT_INVALID").put("message", "输入请求格式无效。" )).toString() }
    catch (_: Exception) { JSONObject().put("ok", false).put("error", JSONObject().put("code", "INPUT_STORAGE_FAILED").put("message", "原生输入操作失败，保留现有草稿和材料。" )).toString() }

    override fun close() = store.close()
}
