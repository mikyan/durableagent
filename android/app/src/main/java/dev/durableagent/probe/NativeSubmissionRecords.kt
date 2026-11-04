package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/** Native intent/control facts share InputStore's transaction and ownership, never the SDK database. */
internal object NativeSubmissionRecords {
    fun createSchema(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE native_send_intents(sequence INTEGER PRIMARY KEY AUTOINCREMENT,intent_id TEXT NOT NULL UNIQUE,action_id TEXT NOT NULL UNIQUE,conversation_id TEXT NOT NULL REFERENCES conversations(id),input_token TEXT NOT NULL REFERENCES frozen(token),data TEXT NOT NULL)")
        db.execSQL("CREATE TABLE native_submission_actions(action_id TEXT PRIMARY KEY,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL)")
        db.execSQL("CREATE TABLE native_controls(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),data TEXT NOT NULL)")
    }

    fun context(value: JSONObject): JSONObject = JSONObject()
        .put("sdkConversationId", integer(value, "sdkConversationId"))
        .put("associationVersion", integer(value, "associationVersion", 1))
        .put("location", value.getJSONObject("location").let { location -> JSONObject()
            .put("workspaceId", id(location, "workspaceId"))
            .put("version", integer(location, "version", 1))
            .put("identity", text(location, "identity", 4096)) })

    fun create(db: SQLiteDatabase, value: JSONObject, frozen: (String) -> JSONObject): JSONObject {
        val actionId = id(value, "actionId"); val productId = id(value, "id"); val token = id(value, "inputToken")
        val expected = context(value.getJSONObject("expectedContext")); val queue = queue(value.getJSONObject("queue"))
        val expectedControl = integer(value, "expectedControlVersion")
        val immutable = JSONObject().put("id", productId).put("inputToken", token).put("expectedContext", expected)
            .put("expectedControlVersion", expectedControl).put("queue", queue)
        replay(db, actionId, "create", immutable)?.let { return read(db, it.getString("intentId")) }
        val product = product(db, productId)
        val actual = product.optJSONObject("submissionContext") ?: fail("SUBMISSION_CONTEXT_UNAVAILABLE", "会话接纳关联尚未就绪，草稿仍保留。")
        if (context(actual).toString() != expected.toString()) fail("SUBMISSION_CONTEXT_CONFLICT", "会话关联或工作位置已变化，未改投此次输入。")
        val control = control(db, productId)
        if (control.getLong("version") != expectedControl) fail("CONTROL_CONFLICT", "控制状态已变化，请核验停止状态后明确发送。")
        val input = frozen(token)
        if (input.getString("id") != productId) fail("INPUT_OPERATION_CONFLICT", "固定输入属于另一会话。")
        if (control.getLong("generation") <= control.getLong("stoppedThrough")) {
            control.put("generation", next(control, "generation")).put("version", next(control, "version"))
            saveControl(db, control) // The old pending abort remains a barrier to runtime admission.
        }
        val intent = JSONObject().put("protocol", 1).put("intentId", actionId).put("actionId", actionId).put("id", productId)
            .put("inputToken", token).put("inputRevision", input.getLong("revision")).put("inputDigest", input.getString("digest"))
            .put("context", expected).put("queue", queue).put("controlGeneration", control.getLong("generation"))
            .put("createdAt", System.currentTimeMillis()).put("preview", JSONObject().put("text", preview(input.getString("text")))
                .put("attachmentCount", input.getJSONArray("representations").length()))
            .put("stateVersion", 1).put("delivery", "pending").put("cancelled", false)
        db.execSQL("INSERT INTO native_send_intents(intent_id,action_id,conversation_id,input_token,data) VALUES(?,?,?,?,?)",
            arrayOf(actionId, actionId, productId, token, intent.toString()))
        remember(db, actionId, "create", immutable, JSONObject().put("intentId", actionId))
        return intent
    }

    fun read(db: SQLiteDatabase, intentId: String): JSONObject {
        validId(intentId)
        return db.rawQuery("SELECT data FROM native_send_intents WHERE intent_id=?", arrayOf(intentId)).use {
            if (!it.moveToFirst()) fail("SEND_NOT_FOUND", "未找到此发送意图；不会从当前草稿重新创建。")
            project(db, JSONObject(it.getString(0)))
        }
    }
    fun list(db: SQLiteDatabase, options: JSONObject): JSONObject {
        val productId = if (options.has("id")) id(options, "id").also { product(db, it) } else null
        val limit = if (options.has("limit")) integer(options, "limit", 1).also { if (it > 50) fail("INPUT_INVALID", "每页最多查询 50 条发送意图。") }.toInt() else 30
        val cursor = if (options.has("cursor")) try {
            JSONObject(String(Base64.decode(text(options, "cursor", 2048), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)).also {
                if (it.optString("id") != (productId ?: "")) fail("INPUT_INVALID", "发送查询游标不属于此范围。")
            }.let { integer(it, "before", 1) }
        } catch (_: Exception) { fail("INPUT_INVALID", "发送查询游标无效。") } else null
        val conditions = mutableListOf<String>(); val args = mutableListOf<String>()
        if (productId != null) { conditions.add("conversation_id=?"); args.add(productId) }
        if (cursor != null) { conditions.add("sequence<?"); args.add(cursor.toString()) }
        val where = if (conditions.isEmpty()) "" else " WHERE " + conditions.joinToString(" AND ")
        val items = JSONArray(); var last = 0L; var more = false
        db.rawQuery("SELECT sequence,data FROM native_send_intents$where ORDER BY sequence DESC LIMIT ${limit + 1}", args.toTypedArray()).use {
            while (it.moveToNext()) {
                if (items.length() == limit) { more = true; break }
                last = it.getLong(0); items.put(project(db, JSONObject(it.getString(1))))
            }
        }
        return JSONObject().put("intents", items).apply { if (more) put("next", Base64.encodeToString(JSONObject().put("id", productId ?: "").put("before", last).toString().toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)) }
    }
    fun holds(db: SQLiteDatabase, token: String): Boolean = db.rawQuery("SELECT 1 FROM native_send_intents WHERE input_token=? LIMIT 1", arrayOf(token)).use { it.moveToFirst() }
    fun markUnknown(db: SQLiteDatabase, intentId: String): JSONObject {
        val intent = read(db, intentId)
        if (intent.getString("delivery") == "pending") {
            intent.put("delivery", "uncertain").put("stateVersion", next(intent, "stateVersion"))
            save(db, intent)
        }
        return intent
    }
    fun acknowledge(db: SQLiteDatabase, intentId: String, supplied: JSONObject, frozen: (String) -> JSONObject,
        draft: (String) -> JSONObject, clear: (String) -> JSONObject): JSONObject {
        val intent = read(db, intentId)
        val receipt = receipt(supplied)
        for (field in listOf("intentId", "id", "inputToken", "inputRevision", "inputDigest", "context", "queue", "controlGeneration")) {
            if (intent.get(field).toString() != receipt.get(field).toString()) fail("INPUT_OPERATION_CONFLICT", "接纳回执与原发送意图不一致，未清除草稿或替换关联。")
        }
        val productId = intent.getString("id")
        if (intent.has("receipt")) {
            if (intent.getJSONObject("receipt").toString() != receipt.toString()) fail("INPUT_OPERATION_CONFLICT", "此意图已记录不同的接纳回执。")
            return JSONObject().put("intent", intent).put("draftCleared", false).put("draft", draft(productId))
        }
        val input = frozen(intent.getString("inputToken")); val current = draft(productId)
        val mayClear = sameDraft(current, input)
        intent.put("receipt", receipt).put("delivery", "acknowledged").put("stateVersion", next(intent, "stateVersion"))
        save(db, intent)
        return JSONObject().put("intent", intent).put("draftCleared", mayClear).put("draft", if (mayClear) clear(productId) else current)
    }
    private fun sameDraft(draft: JSONObject, input: JSONObject): Boolean {
        if (draft.getLong("revision") != input.getLong("revision") || draft.getString("text") != input.getString("text")) return false
        val selections = draft.getJSONArray("selections"); val representations = input.getJSONArray("representations")
        if (selections.length() != representations.length()) return false
        for (index in 0 until selections.length()) {
            val preparation = selections.getJSONObject(index).getJSONObject("preparation")
            if (preparation.getString("state") != "ready") return false
            val current = preparation.optJSONObject("representation") ?: return false
            val fixed = representations.getJSONObject(index)
            if (listOf("objectId", "sha256", "kind", "mimeType", "byteLength", "range", "capabilityVersion").any { current.get(it).toString() != fixed.get(it).toString() }) return false
        }
        return true
    }
    private fun receipt(value: JSONObject): JSONObject {
        if (integer(value, "protocol", 1) != 1L) fail("INPUT_INVALID", "接纳回执协议不兼容。")
        return JSONObject().put("protocol", 1).put("intentId", id(value, "intentId")).put("id", id(value, "id"))
            .put("inputToken", id(value, "inputToken")).put("inputRevision", integer(value, "inputRevision"))
            .put("inputDigest", text(value, "inputDigest", 64)).put("context", context(value.getJSONObject("context")))
            .put("queue", queue(value.getJSONObject("queue"))).put("controlGeneration", integer(value, "controlGeneration", 1))
            .put("bindingId", id(value, "bindingId")).put("submissionId", integer(value, "submissionId"))
    }
    private fun save(db: SQLiteDatabase, intent: JSONObject) { db.execSQL("UPDATE native_send_intents SET data=? WHERE intent_id=?", arrayOf(intent.toString(), intent.getString("intentId"))) }
    private fun next(value: JSONObject, key: String): Long {
        val current = integer(value, key)
        if (current >= 9_007_199_254_740_991L) fail("INPUT_INCOMPATIBLE", "控制或输入版本超出当前版本支持范围。")
        return current + 1
    }
    fun control(db: SQLiteDatabase, productId: String): JSONObject {
        product(db, productId)
        return db.rawQuery("SELECT data FROM native_controls WHERE conversation_id=?", arrayOf(productId)).use {
            if (it.moveToFirst()) storedControl(productId, it.getString(0))
            else JSONObject().put("id", productId).put("version", 0).put("generation", 1).put("stoppedThrough", 0)
        }
    }
    fun stop(db: SQLiteDatabase, value: JSONObject): JSONObject {
        val productId = id(value, "id"); val actionId = id(value, "actionId")
        val expected = integer(value, "expectedControlVersion")
        val immutable = JSONObject().put("id", productId).put("expectedControlVersion", expected)
        replay(db, actionId, "stop", immutable)?.let { return control(db, productId) }
        val current = control(db, productId)
        if (current.getLong("version") != expected) fail("CONTROL_CONFLICT", "控制状态已变化，请核验最新停止状态。")
        val association = product(db, productId).optJSONObject("submissionContext")
            ?: fail("SUBMISSION_CONTEXT_UNAVAILABLE", "会话接纳关联尚未就绪，未宣称已停止执行。")
        val normalized = context(association)
        current.optJSONObject("pendingAbort")?.let {
            if (it.getJSONObject("context").toString() != normalized.toString())
                fail("CONTROL_CONFLICT", "先前关联仍有待核验的停止，保留旧停止屏障。")
        }
        val barrier = JSONObject().put("stopId", actionId).put("throughGeneration", current.getLong("generation")).put("context", normalized)
        current.put("version", next(current, "version")).put("stoppedThrough", current.getLong("generation")).put("pendingAbort", barrier)
        saveControl(db, current)
        remember(db, actionId, "stop", immutable, JSONObject().put("id", productId).put("barrier", barrier).put("confirmed", false))
        return current
    }
    fun pendingStops(db: SQLiteDatabase): JSONArray {
        val result = JSONArray()
        db.rawQuery("SELECT conversation_id,data FROM native_controls ORDER BY conversation_id", null).use { rows -> while (rows.moveToNext()) {
            val current = storedControl(rows.getString(0), rows.getString(1))
            if (current.has("pendingAbort")) result.put(JSONObject().put("id", current.getString("id")).put("control", current))
        } }
        return result
    }
    /** Absence is distinct from a corrupt existing fence. Never manufacture an open control state. */
    private fun storedControl(productId: String, data: String): JSONObject = try {
        val value = JSONObject(data)
        val generation = integer(value, "generation", 1); val stopped = integer(value, "stoppedThrough")
        val version = integer(value, "version")
        require(id(value, "id") == productId && stopped <= generation && version >= maxOf(generation - 1, stopped))
        val normalized = JSONObject().put("id", productId).put("version", version).put("generation", generation).put("stoppedThrough", stopped)
        if (value.has("pendingAbort")) {
            val barrier = value.getJSONObject("pendingAbort")
            val through = integer(barrier, "throughGeneration", 1)
            require(through == stopped)
            normalized.put("pendingAbort", JSONObject().put("stopId", id(barrier, "stopId")).put("throughGeneration", through)
                .put("context", context(barrier.getJSONObject("context"))))
        }
        normalized
    } catch (_: Exception) { fail("INPUT_STORAGE_CORRUPT", "持久停止记录不完整或不兼容；已保留原记录并阻止派发。") }
    fun confirmAbort(db: SQLiteDatabase, productId: String, supplied: JSONObject): JSONObject {
        validId(productId)
        val barrier = JSONObject().put("stopId", id(supplied, "stopId")).put("throughGeneration", integer(supplied, "throughGeneration", 1))
            .put("context", context(supplied.getJSONObject("context")))
        val current = control(db, productId)
        val remembered = db.rawQuery("SELECT result FROM native_submission_actions WHERE action_id=? AND kind='stop'", arrayOf(barrier.getString("stopId"))).use {
            if (it.moveToFirst()) JSONObject(it.getString(0)) else null
        } ?: fail("CONTROL_CONFLICT", "未找到此停止范围，不会清除屏障。")
        if (remembered.getString("id") != productId || remembered.getJSONObject("barrier").toString() != barrier.toString())
            fail("CONTROL_CONFLICT", "停止确认范围不一致，保留屏障。")
        if (!current.has("pendingAbort") && remembered.getBoolean("confirmed")) return current
        if (current.optJSONObject("pendingAbort")?.toString() != barrier.toString()) fail("CONTROL_CONFLICT", "已有更新的停止屏障，迟到确认不能清除。")
        current.remove("pendingAbort"); current.put("version", next(current, "version"))
        saveControl(db, current)
        remembered.put("confirmed", true)
        db.execSQL("UPDATE native_submission_actions SET result=? WHERE action_id=?", arrayOf(remembered.toString(), barrier.getString("stopId")))
        return current
    }
    private fun saveControl(db: SQLiteDatabase, current: JSONObject) {
        db.execSQL("INSERT INTO native_controls(conversation_id,data) VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET data=excluded.data", arrayOf(current.getString("id"), current.toString()))
    }
    /** The durable generation fence cancels arbitrarily many historical intents in one short write. */
    private fun project(db: SQLiteDatabase, intent: JSONObject): JSONObject {
        if (!intent.getBoolean("cancelled") && intent.getLong("controlGeneration") <= control(db, intent.getString("id")).getLong("stoppedThrough"))
            intent.put("cancelled", true).put("stateVersion", next(intent, "stateVersion"))
        return intent
    }
    private fun product(db: SQLiteDatabase, productId: String): JSONObject = db.rawQuery("SELECT data FROM conversations WHERE id=?", arrayOf(productId)).use {
        if (!it.moveToFirst()) fail("INPUT_NOT_FOUND", "未登记此会话。")
        JSONObject(it.getString(0))
    }
    private fun replay(db: SQLiteDatabase, actionId: String, kind: String, payload: JSONObject): JSONObject? = db.rawQuery("SELECT kind,fingerprint,result FROM native_submission_actions WHERE action_id=?", arrayOf(actionId)).use {
        if (!it.moveToFirst()) null else {
            if (it.getString(0) != kind || it.getString(1) != fingerprint(payload)) fail("INPUT_OPERATION_CONFLICT", "此明确操作身份已绑定其他输入或条件。")
            JSONObject(it.getString(2))
        }
    }
    private fun remember(db: SQLiteDatabase, actionId: String, kind: String, payload: JSONObject, result: JSONObject) {
        db.execSQL("INSERT INTO native_submission_actions(action_id,kind,fingerprint,result) VALUES(?,?,?,?)", arrayOf(actionId, kind, fingerprint(payload), result.toString()))
    }
    private fun fingerprint(value: JSONObject) = NativeInputStore.sha256(value.toString().toByteArray(Charsets.UTF_8))
    private fun queue(value: JSONObject): JSONObject {
        if (value.optString("whenBusy") != "followUp" || value.optString("whenIdle") != "start") fail("INPUT_INVALID", "不支持此排队语义，未替换发送意图。")
        return JSONObject().put("whenBusy", "followUp").put("whenIdle", "start")
    }
    private fun preview(value: String): String {
        if (value.length <= 240) return value
        val end = if (Character.isHighSurrogate(value[239])) 239 else 240
        return value.substring(0, end) + "…"
    }
    private fun id(value: JSONObject, key: String): String = text(value, key, 200).also(::validId)
    private fun validId(value: String) { if (!value.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}"))) fail("INPUT_INVALID", "发送身份无效。") }
    private fun text(value: JSONObject, key: String, maximum: Int): String {
        val result = value.opt(key)
        if (result !is String || result.isEmpty() || result.length > maximum) fail("INPUT_INVALID", "发送字段格式无效。")
        return result
    }
    private fun integer(value: JSONObject, key: String, minimum: Long = 0): Long {
        val result = value.opt(key)
        if (result !is Number || result.toDouble() != result.toLong().toDouble() || result.toLong() !in minimum..9_007_199_254_740_991L) fail("INPUT_INVALID", "发送版本必须是有效整数。")
        return result.toLong()
    }
    private fun fail(code: String, message: String): Nothing = throw NativeInputException(code, message)
}
