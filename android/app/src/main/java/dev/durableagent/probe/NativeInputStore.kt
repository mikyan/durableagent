package dev.durableagent.probe

import android.content.Context
import android.content.Intent
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import android.os.UserManager
import android.os.CancellationSignal
import android.os.SystemClock
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class NativeInputException(val code: String, message: String) : RuntimeException(message, null, false, false)

/** Native CE input authority. It never opens SDK storage or waits for a Node/Javet thread. */
class NativeInputStore(
    context: Context,
    private val namespace: String = "input-v1",
    // External SQLite quota / process interruption boundaries for dedicated fault fixtures only.
    private val maximumDatabaseBytes: Long? = null,
    private val boundary: (String) -> Unit = {}
) : AutoCloseable {
    private val context = context.applicationContext
    private var helper: InputDatabase? = null
    private var closed = false
    private var leaseWaitMs = 0L
    private val sourceAdmissions = ConcurrentHashMap<String, SourceAdmission>()
    private val sources = NativeAttachmentSource(this.context.contentResolver)
    init { require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}"))) }

    /** Trusted synchronous host calls may wait for a short native transaction before entering
     * their action. This never retries an action, a COMMIT, or a response; UI stores stay fail-fast. */
    fun withLeaseWait(milliseconds: Long): NativeInputStore = apply {
        require(milliseconds in 0..2000)
        synchronized(monitor) { leaseWaitMs = milliseconds }
    }

    /** Trusted host publication, not a UI action. Known conversation identities survive Node loss. */
    fun rememberConversation(conversation: JSONObject, capability: JSONObject? = null) {
        val id = conversation.getString("id"); validateId(id)
        val safe = JSONObject().put("id", id).put("title", conversation.getString("title").take(120))
            .put("model", JSONObject(conversation.getJSONObject("model").toString()))
        locked { db, _ -> transaction(db) {
            val previous = db.rawQuery("SELECT data,capability FROM conversations WHERE id=?", arrayOf(id)).use {
                if (it.moveToFirst()) Pair(it.getString(0), if (it.isNull(1)) null else it.getString(1)) else null
            }
            val previousContext = previous?.first?.let(::JSONObject)?.optJSONObject("submissionContext")
            val suppliedContext = conversation.optJSONObject("submissionContext")
            val submissionContext = if (NativeSubmissionRecords.readLocationEdit(db) != null || suppliedContext == null) previousContext
                else NativeSubmissionRecords.chooseContext(previousContext, suppliedContext, false)
            if (submissionContext != null) safe.put("submissionContext", NativeSubmissionRecords.context(submissionContext))
            db.execSQL("INSERT INTO conversations(id,data,capability) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,capability=excluded.capability",
                arrayOf(id, safe.toString(), capability?.toString()))
            db.execSQL("INSERT OR IGNORE INTO drafts(id,revision,state_version,text,selection_ids) VALUES(?,0,0,'','[]')", arrayOf(id))
            if (previous != null && (previous.first != safe.toString() || previous.second != capability?.toString()))
                db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
        } }
    }

    fun list(): JSONObject = locked { db, _ ->
        val values = JSONArray()
        db.rawQuery("SELECT data FROM conversations ORDER BY id", null).use { cursor -> while (cursor.moveToNext()) values.put(JSONObject(cursor.getString(0))) }
        JSONObject().put("conversations", values)
    }
    fun conversationTitle(id:String):String { validateId(id);return locked { db,_ -> db.rawQuery("SELECT data FROM conversations WHERE id=?",arrayOf(id)).use{rows->if(!rows.moveToFirst())throw NativeInputException("INPUT_UNKNOWN_CONVERSATION","会话尚未登记。");JSONObject(rows.getString(0)).getString("title")} } }

    /** Cheap durable projection for in-flight preparation; explicit read() revalidates sources. */
    fun inspect(id: String): JSONObject {
        validateId(id)
        return locked { db, directory -> recoverInterrupted(db, id, directory); draft(db, id) }
    }

    fun read(id: String): JSONObject {
        validateId(id)
        data class SourceCheck(val selectionId: String, val data: String, val uri: Uri, val hash: String?)
        val checks = locked { db, _ ->
            draft(db, id)
            recoverInterrupted(db, id, File(context.noBackupFilesDir, namespace))
            selectedIds(db, id).mapNotNull { selectionId ->
                db.rawQuery("SELECT data,source_uri,source_hash,job FROM selections WHERE id=?", arrayOf(selectionId)).use {
                    if (!it.moveToFirst() || !it.isNull(3)) null
                    else SourceCheck(selectionId, it.getString(0), Uri.parse(it.getString(1)), if (it.isNull(2)) null else it.getString(2))
                }
            }
        }
        for (check in checks) {
            val data = JSONObject(check.data); val source = data.getJSONObject("source"); val preparation = data.getJSONObject("preparation")
            try {
                if (check.hash == null) {
                    source.put("access", if (sources.available(check.uri)) "available" else "unavailable")
                } else {
                    sources.readStable(check.uri, NativeAttachmentPreparation.sourceBudget(source.getString("mimeType")), check.hash)
                    source.put("access", "available")
                    if (preparation.getString("state") == "source-unavailable") preparation.put("state", "selected").put("reason", "来源已重新核验，等待准备。")
                    if (preparation.getString("state") == "ready") preparation.remove("reason")
                }
            } catch (_: Exception) {
                source.put("access", "unavailable")
                if (preparation.getString("state") == "ready") preparation.put("reason", "原件已变化或不可访问；已准备的固定内容仍保留，发送采用所示版本。")
                else preparation.put("state", "source-unavailable").put("reason", "无法确认原件仍符合选择时内容，请重新选择；草稿文字仍保留。")
            }
            if (data.toString() != check.data) locked { db, _ -> transaction(db) {
                val actual = db.rawQuery("SELECT data FROM selections WHERE id=?", arrayOf(check.selectionId)).use { if (it.moveToFirst()) it.getString(0) else null }
                if (actual == check.data && check.selectionId in selectedIds(db, id)) {
                    db.execSQL("UPDATE selections SET data=? WHERE id=?", arrayOf(data.toString(), check.selectionId))
                    db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
                }
            } }
        }
        return locked { db, _ -> draft(db, id) }
    }

    fun save(id: String, expectedRevision: Long, operationId: String, text: String, selectionIds: List<String>): JSONObject =
        saveAction("save", id, expectedRevision, operationId, text, selectionIds)
    private fun saveAction(action: String, id: String, expectedRevision: Long, operationId: String, text: String, selectionIds: List<String>): JSONObject {
        validateId(id); validateId(operationId)
        validateText(text)
        if (text.length > DRAFT_CHARACTERS || selectionIds.size > ATTACHMENTS || selectionIds.distinct().size != selectionIds.size)
            fail("INPUT_BUDGET_EXCEEDED", "草稿超过应用准备预算，正文未被截断。")
        selectionIds.forEach(::validateId)
        val payload = JSONObject().put("method", action).put("id", id).put("expectedRevision", expectedRevision)
            .put("text", text).put("selectionIds", JSONArray(selectionIds))
        val removedJobs = mutableListOf<String>()
        val result = locked { db, _ -> operation(db, operationId, payload) {
            val current = draft(db, id)
            checkRevision(current, expectedRevision)
            val existingIds = selectedIds(db, id)
            for (selection in selectionIds) {
                if (selection !in existingIds) fail("INPUT_SELECTION_MISSING", "此附件已移除，请通过文件选择器重新选择。")
                db.rawQuery("SELECT draft_id FROM selections WHERE id=?", arrayOf(selection)).use {
                    if (!it.moveToFirst() || it.getString(0) != id) fail("INPUT_SELECTION_MISSING", "附件选择不属于此会话，请重新选择。")
                }
            }
            for (removed in selectedIds(db, id).filter { it !in selectionIds }) {
                db.rawQuery("SELECT job FROM selections WHERE id=?", arrayOf(removed)).use { if (it.moveToFirst() && !it.isNull(0)) removedJobs.add(it.getString(0)) }
                db.execSQL("UPDATE selections SET job=NULL,job_owner=NULL WHERE id=?", arrayOf(removed))
            }
            db.execSQL("UPDATE drafts SET revision=revision+1,state_version=state_version+1,text=?,selection_ids=? WHERE id=?", arrayOf(text, JSONArray(selectionIds).toString(), id))
            draft(db, id)
        } }
        removedJobs.forEach { activeJobs[it]?.cancel() }
        return result
    }

    fun clear(id: String, expectedRevision: Long, operationId: String): JSONObject = saveAction("clear", id, expectedRevision, operationId, "", emptyList())

    /** Persistent replay checked before launching another picker; this never opens a source URI. */
    fun selectionReceipt(id: String, expectedRevision: Long, operationId: String, kind: String): JSONObject? {
        validateId(id); validateId(operationId)
        if (kind !in listOf("text", "image")) fail("INPUT_INVALID_ARGUMENT", "附件类别无效。")
        return locked { db, _ -> selectionReplay(db, id, expectedRevision, operationId, kind, null) }
    }
    private fun selectionReplay(db: SQLiteDatabase, id: String, revision: Long, operationId: String, kind: String?, uri: String?): JSONObject? {
        db.rawQuery("SELECT o.reply,s.draft_id,s.revision,s.kind,s.uri FROM operations o LEFT JOIN selection_operations s ON s.operation_id=o.id WHERE o.id=?", arrayOf(operationId)).use {
            if (!it.moveToFirst()) return null
            if (it.isNull(1) || it.getString(1) != id || it.getLong(2) != revision || (kind != null && it.getString(3) != kind) || (uri != null && it.getString(4) != uri))
                fail("INPUT_OPERATION_CONFLICT", "此操作身份已用于不同内容，请重新选择。")
            return JSONObject(it.getString(0))
        }
    }

    /** A committed selection and its separately schedulable source work. Never expose this handle to JS. */
    class SourceAdmission internal constructor(
        initial: JSONObject,
        private val continuation: (() -> JSONObject)? = null,
        private val cancel: () -> Unit = {},
        private val release: () -> Unit = {}
    ) : AutoCloseable {
        private val initialJson = initial.toString()
        private val state = java.util.concurrent.atomic.AtomicInteger(0)
        private val released = java.util.concurrent.atomic.AtomicBoolean(false)
        val receipt: JSONObject get() = JSONObject(initialJson)
        val needsContinuation: Boolean get() = continuation != null
        fun continueSource(): JSONObject {
            val action = continuation ?: return receipt
            if (!state.compareAndSet(0, 1)) fail("INPUT_PREPARATION_SUPERSEDED", "此来源任务已完成或放弃，未重复读取原件。")
            try { return action() }
            finally { state.set(2); releaseOnce() }
        }
        private fun releaseOnce() { if (released.compareAndSet(false, true)) release() }
        override fun close() {
            cancel()
            // Running work retains its lease until its finally block; pending work can be abandoned now.
            if (state.compareAndSet(0, 3)) releaseOnce()
        }
    }
    private data class SourceWork(val id: String, val selectionId: String, val operationId: String,
        val uri: Uri, val flags: Int, val kind: String?, val job: String,
        val source: JSONObject, val selection: JSONObject, val signal: CancellationSignal)

    /** Short native admission: no provider/grant/metadata/content call and no source-executor dependency. */
    fun admitSource(id: String, expectedRevision: Long, operationId: String, uri: Uri, flags: Int, kind: String? = null): SourceAdmission {
        validateId(id); validateId(operationId)
        if (kind != null && kind !in listOf("text", "image")) fail("INPUT_INVALID_ARGUMENT", "附件类别无效。")
        locked { db, _ -> selectionReplay(db, id, expectedRevision, operationId, kind, uri.toString()) }?.let { return SourceAdmission(it) }
        if (uri.scheme != "content") fail("INPUT_SOURCE_UNAVAILABLE", "请选择系统文件选择器提供的来源。")
        if (flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) fail("INPUT_SOURCE_UNAVAILABLE", "文件选择器未授予读取权限。")
        val source = JSONObject().put("name", "附件").put("mimeType", "application/octet-stream").put("access", "unknown")
        val requestedKind = kind ?: "unknown"
        val selectionId = UUID.randomUUID().toString(); val job = UUID.randomUUID().toString()
        val selection = JSONObject().put("id", selectionId).put("operationId", operationId).put("source", source)
            .put("preparation", JSONObject().put("state", "preparing").put("reason", "正在核验来源，尚未固定内容。"))
        val payload = JSONObject().put("method", "select").put("id", id).put("revision", expectedRevision).put("uri", uri.toString()).put("kind", requestedKind)
        val signal = CancellationSignal(); var ownership: StorageDomainLease? = null
        try {
            return locked { db, directory ->
                selectionReplay(db, id, expectedRevision, operationId, kind, uri.toString())?.let { return@locked SourceAdmission(it) }
                val initial = operation(db, operationId, payload) {
                    val current = draft(db, id); checkRevision(current, expectedRevision)
                    val ids = selectedIds(db, id)
                    if (ids.size >= ATTACHMENTS) fail("INPUT_BUDGET_EXCEEDED", "每份输入最多准备四个附件，请主动移除后重试。")
                    ownership = acquireJob(directory, job); activeJobs[job] = signal
                    db.execSQL("INSERT INTO selections(id,draft_id,data,source_uri,job,job_owner) VALUES(?,?,?,?,?,?)", arrayOf<Any>(selectionId, id, selection.toString(), uri.toString(), job, android.os.Process.myPid()))
                    db.execSQL("INSERT INTO selection_operations(operation_id,draft_id,revision,kind,uri) VALUES(?,?,?,?,?)", arrayOf<Any>(operationId,id,expectedRevision,requestedKind,uri.toString()))
                    db.execSQL("UPDATE drafts SET revision=revision+1,state_version=state_version+1,selection_ids=? WHERE id=?", arrayOf(JSONArray(ids + selectionId).toString(), id))
                    draft(db, id)
                }
                val task = SourceWork(id, selectionId, operationId, uri, flags, kind, job, source, selection, signal)
                SourceAdmission(initial, continuation = { continueSource(task) }, cancel = { signal.cancel() }, release = {
                    sourceAdmissions.remove(job); activeJobs.remove(job); ownership?.close()
                }).also { sourceAdmissions[job] = it }
            }
        } catch (error: Exception) { activeJobs.remove(job); ownership?.close(); throw error }
    }

    /** Synchronous convenience wrapper; UI adapters admit on the short writer and queue continuation separately. */
    fun selectSource(id: String, expectedRevision: Long, operationId: String, uri: Uri, flags: Int, kind: String? = null,
        onCommitted: ((JSONObject) -> Unit)? = null): JSONObject = admitSource(id, expectedRevision, operationId, uri, flags, kind).use { admission ->
        if (admission.needsContinuation) try { onCommitted?.invoke(admission.receipt) } catch (_: Exception) { }
        admission.continueSource()
    }

    private fun continueSource(task: SourceWork): JSONObject {
        val (id, selectionId, operationId, uri, flags, kind, job, source, selection, signal) = task
        return try {
            signal.throwIfCanceled()
            if (flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
                try { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                catch (_: SecurityException) { /* Temporary grant may still permit local preparation. */ }
            }
            val description = try { sources.describe(uri) }
                catch (_: Exception) { fail("INPUT_SOURCE_UNAVAILABLE", "无法读取来源信息，请重新选择；已保存文字和选择记录仍保留。") }
            description.keys().forEach { key -> source.put(key, description.get(key)) }
            val actualKind = if (source.getString("mimeType").startsWith("image/")) "image" else "text"
            if (kind != null && kind != actualKind) fail("INPUT_UNSUPPORTED", "选择的文件与请求类别不符。")
            signal.throwIfCanceled()
            locked { db, _ -> transaction(db) {
                verifyAttempt(db, id, selectionId, job)
                db.execSQL("UPDATE selections SET data=? WHERE id=?", arrayOf(selection.toString(), selectionId))
                if (kind == null) db.execSQL("UPDATE selection_operations SET kind=? WHERE operation_id=?", arrayOf(actualKind, operationId))
                db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
                db.execSQL("UPDATE operations SET reply=? WHERE id=?", arrayOf(draft(db, id).toString(), operationId))
            } }
            val bytes = sources.readStable(uri, NativeAttachmentPreparation.sourceBudget(source.getString("mimeType")), signal = signal)
            source.put("access", "available").put("byteLength", bytes.size)
            selection.put("preparation", JSONObject().put("state", "selected").put("reason", "来源已核验，等待本地正文准备。"))
            finishSelection(id, selectionId, job, selection, sha256(bytes), operationId)
        } catch (error: Exception) {
            selection.put("preparation", failurePreparation(error))
            if (selection.getJSONObject("preparation").getString("state") == "source-unavailable") source.put("access", "unavailable")
            finishSelection(id, selectionId, job, selection, null, operationId)
        }
    }

    /** Local source reading/conversion happens outside the metadata lease and SQLite transaction. */
    fun prepare(id: String, selectionId: String, operationId: String): JSONObject {
        validateId(id); validateId(selectionId); validateId(operationId)
        data class Work(val uri: Uri, val expectedHash: String, val selection: JSONObject, val capability: JSONObject, val job: String, val directory: File)
        var work: Work? = null; var ownership: StorageDomainLease? = null; var activeJob: String? = null
        val signal = CancellationSignal()
        try {
        val payload = JSONObject().put("method", "prepare").put("id", id).put("selectionId", selectionId)
        val initial = locked { db, directory -> operation(db, operationId, payload) {
            recoverInterrupted(db, id, directory)
            val current = draft(db, id)
            val capability = current.optJSONObject("capability") ?: fail("INPUT_CAPABILITY_UNAVAILABLE", "尚未取得当前模型的非秘密输入能力；草稿已保存，准备等待配置恢复。")
            if (selectionId !in selectedIds(db, id)) fail("INPUT_SELECTION_MISSING", "此附件已从草稿移除。")
            db.rawQuery("SELECT data,source_uri,source_hash,job FROM selections WHERE id=? AND draft_id=?", arrayOf(selectionId, id)).use { row ->
                if (!row.moveToFirst()) fail("INPUT_SELECTION_MISSING", "附件选择不存在。")
                val data = JSONObject(row.getString(0)); val previous = data.getJSONObject("preparation")
                if (previous.optString("state") == "ready" && previous.optJSONObject("representation")?.optString("capabilityVersion") == capability.getString("version")) return@operation current
                if (!row.isNull(3)) fail("INPUT_PREPARING", "来源或附件仍在准备，请等待本地操作完成。")
                if (row.isNull(2)) fail("INPUT_SOURCE_UNAVAILABLE", "尚未确认完整来源，请重新选择。")
                val job = UUID.randomUUID().toString()
                ownership = acquireJob(directory, job); activeJob = job; activeJobs[job] = signal
                data.put("preparation", JSONObject(previous.toString()).put("state", "preparing").put("reason", "正在本地准备完整内容。"))
                db.execSQL("UPDATE selections SET data=?,job=?,job_owner=? WHERE id=?", arrayOf<Any>(data.toString(), job, android.os.Process.myPid(), selectionId))
                db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
                work = Work(Uri.parse(row.getString(1)), row.getString(2), data, JSONObject(capability.toString()), job, directory)
            }
            draft(db, id)
        } }
        val task = work ?: return initial
        val staging = File(File(task.directory, "staging"), task.job)
        return try {
            val source = task.selection.getJSONObject("source"); val mime = source.getString("mimeType")
            val original = sources.readStable(task.uri, NativeAttachmentPreparation.sourceBudget(mime), task.expectedHash, signal)
            val converted = NativeAttachmentPreparation.prepare(original, mime, task.capability)
            signal.throwIfCanceled()
            if (!staging.parentFile!!.mkdirs() && !staging.parentFile!!.isDirectory) fail("INPUT_STORAGE_FAILED", "无法建立本地准备目录。")
            try {
                boundary("content.beforeWrite")
                FileOutputStream(staging).use { it.write(converted.bytes); it.fd.sync() }
            } catch(error:Exception) {
                if(error is android.system.ErrnoException&&error.errno==OsConstants.ENOSPC || error.cause is android.system.ErrnoException&&(error.cause as android.system.ErrnoException).errno==OsConstants.ENOSPC)
                    fail("INPUT_CONTENT_CAPACITY","输入内容存储空间不足，未确认准备完成；草稿和已有固定输入仍保留。")
                fail("INPUT_CONTENT_WRITE_FAILED","输入内容写入未完成；草稿和已有固定输入仍保留，请检查可用空间后重试。")
            }
            boundary("object.synced")
            val objectId = UUID.randomUUID().toString()
            val representation = converted.representation.put("objectId", objectId).put("sha256", sha256(converted.bytes)).put("byteLength", converted.bytes.size)
            locked { db, directory ->
                verifyAttempt(db, id, selectionId, task.job)
                if (draft(db, id).optJSONObject("capability")?.optString("version") != task.capability.getString("version"))
                    fail("INPUT_CAPABILITY_CHANGED", "模型能力已变化，请重新准备；旧固定输入保持原样。")
                val objects = File(directory, "objects").apply { if (!mkdirs() && !isDirectory) fail("INPUT_STORAGE_FAILED", "无法建立私有内容目录。") }
                Os.rename(staging.absolutePath, File(objects, objectId).absolutePath); syncDirectory(objects); syncDirectory(directory)
                boundary("object.published")
                transaction(db) {
                    db.execSQL("INSERT INTO objects(id,representation) VALUES(?,?)", arrayOf(objectId, representation.toString()))
                    task.selection.getJSONObject("source").put("access", "available")
                    task.selection.put("preparation", JSONObject().put("state", "ready").put("representation", representation))
                    db.execSQL("UPDATE selections SET data=?,job=NULL,job_owner=NULL,object_id=? WHERE id=?", arrayOf(task.selection.toString(), objectId, selectionId))
                    db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
                    val reply = draft(db, id); db.execSQL("UPDATE operations SET reply=? WHERE id=?", arrayOf(reply.toString(), operationId)); reply
                }
            }.also { boundary("prepare.committed") }
        } catch (error: Exception) {
            val failed = failurePreparation(error)
            task.selection.getJSONObject("preparation").optJSONObject("representation")?.let { failed.put("representation", it) }
            task.selection.put("preparation", failed)
            if (failed.getString("state") == "source-unavailable") task.selection.getJSONObject("source").put("access", "unavailable")
            finishSelection(id, selectionId, task.job, task.selection, task.expectedHash, operationId)
        } finally { staging.delete() }
        } finally { activeJob?.let { activeJobs.remove(it) }; ownership?.close() }
    }

    fun freeze(id: String, expectedRevision: Long, operationId: String): JSONObject {
        validateId(id); validateId(operationId)
        val payload = JSONObject().put("method", "freeze").put("id", id).put("revision", expectedRevision)
        var cached: JSONObject? = null
        val (snapshot, directory) = locked { db, directory ->
            cached = replay(db, operationId, payload)
            Pair(if (cached == null) draft(db, id) else JSONObject(), directory)
        }
        cached?.let { return it }
        checkRevision(snapshot, expectedRevision)
        val capability = snapshot.optJSONObject("capability") ?: fail("INPUT_CAPABILITY_UNAVAILABLE", "当前模型能力尚未就绪，草稿已保存但未固定发送内容。")
        val representations = JSONArray(); val selections = snapshot.getJSONArray("selections")
        // Potentially large content verification is outside both the metadata lease and SQL txn.
        // Draft references protect objects; final stateVersion check rejects a concurrent release.
        for (index in 0 until selections.length()) {
            val preparation = selections.getJSONObject(index).getJSONObject("preparation")
            if (preparation.getString("state") != "ready") fail("INPUT_NOT_READY", "附件未完整准备，尚未交给模型。")
            val rep = preparation.getJSONObject("representation")
            if (rep.getString("capabilityVersion") != capability.getString("version")) fail("INPUT_CAPABILITY_CHANGED", "当前模型能力已变化，请重新准备附件。")
            verifyObject(directory, rep); representations.put(JSONObject(rep.toString()))
        }
        val text = snapshot.getString("text")
        if (text.isBlank() && representations.length() == 0) fail("INPUT_EMPTY", "请输入文字或准备附件。")
        verifyBudget(text, representations, capability)
        return locked { db, _ -> operation(db, operationId, payload) {
            val current = draft(db, id); checkRevision(current, expectedRevision)
            if (current.getLong("stateVersion") != snapshot.getLong("stateVersion")) fail("INPUT_STATE_CONFLICT", "准备或能力状态已更新，请重新核验固定输入。")
            val token = UUID.randomUUID().toString()
            val frozen = JSONObject().put("token", token).put("id", id).put("revision", expectedRevision).put("text", text)
                .put("representations", representations).put("digest", inputDigest(text, representations))
            db.execSQL("INSERT INTO frozen(token,data) VALUES(?,?)", arrayOf(token, frozen.toString()))
            for (index in 0 until representations.length()) db.execSQL("INSERT INTO frozen_objects(token,object_id) VALUES(?,?)", arrayOf(token, representations.getJSONObject(index).getString("objectId")))
            frozen
        } }.also { boundary("freeze.committed") }
    }

    fun readFrozen(token: String): JSONObject { validateId(token); return locked { db, _ -> frozen(db, token) } }
    fun readLocationEdit(): JSONObject? = locked { db, _ -> NativeSubmissionRecords.readLocationEdit(db) }
    fun beginLocationEdit(operationId: String): JSONObject = locked { db, _ -> transaction(db) {
        NativeSubmissionRecords.beginLocationEdit(db, operationId).also { boundary("location.edit.begin.beforeCommit") }
    } }.also { boundary("location.edit.begin.afterCommit") }
    fun finishLocationEdit(operationId: String, contexts: JSONArray) {
        locked { db, _ -> transaction(db) {
            NativeSubmissionRecords.finishLocationEdit(db, operationId, contexts, boundary)
            boundary("location.edit.finish.beforeCommit")
        } }
        boundary("location.edit.finish.afterCommit")
    }
    fun createSend(request: JSONObject): JSONObject = locked { db, _ -> transaction(db) {
        NativeSubmissionRecords.create(db, request) { frozen(db, it) }.also { boundary("send.intent.beforeCommit") }
    } }.also { boundary("send.intent.afterCommit") }
    /** Trusted runtime path: new fixed input, with no mutation of the target's authored draft. */
    fun createRoute(request: JSONObject): JSONObject {
        val text = request.getString("text"); validateText(text)
        if (text.isBlank() || text.length > DRAFT_CHARACTERS) fail("INPUT_INVALID", "转交正文为空或超过文字预算。")
        return locked { db, _ -> transaction(db) {
            NativeSubmissionRecords.createRoute(db, request) { id, content ->
                val token = UUID.randomUUID().toString()
                val fixed = JSONObject().put("token", token).put("id", id).put("revision", 0).put("text", content)
                    .put("representations", JSONArray()).put("digest", inputDigest(content, JSONArray()))
                db.execSQL("INSERT INTO frozen(token,data) VALUES(?,?)", arrayOf(token, fixed.toString()))
                fixed
            }.also { boundary("route.intent.beforeCommit") }
        } }.also { boundary("route.intent.afterCommit") }
    }
    fun readSend(intentId: String): JSONObject = locked { db, _ -> NativeSubmissionRecords.read(db, intentId) }
    fun listSends(options: JSONObject = JSONObject()): JSONObject = locked { db, _ -> NativeSubmissionRecords.list(db, options) }
    fun readControl(id: String): JSONObject { validateId(id); return locked { db, _ -> NativeSubmissionRecords.control(db, id) } }
    fun requestStop(request: JSONObject): JSONObject = locked { db, _ -> transaction(db) {
        NativeSubmissionRecords.stop(db, request).also { boundary("send.stop.beforeCommit") }
    } }.also { boundary("send.stop.afterCommit") }
    fun pendingStops(): JSONArray = locked { db, _ -> NativeSubmissionRecords.pendingStops(db) }
    fun registerEffect(request:JSONObject):JSONObject = locked { db,_ -> transaction(db) { NativeStopRecords.register(db,request) } }
    /** Verified old receipt discovery adds cancellation evidence, never grants permission to start. */
    fun adoptEffect(request:JSONObject):JSONObject = locked { db,_ -> transaction(db) { NativeStopRecords.register(db,request,true) } }
    fun requireEffect(operationId:String):JSONObject = locked { db,_ -> NativeStopRecords.require(db,operationId) }
    fun recordEffectEvidence(operationId:String,evidence:JSONObject):JSONObject = locked { db,_ -> transaction(db) { NativeStopRecords.evidence(db,operationId,evidence) } }
    @JvmOverloads fun stoppedEffects(after:String?=null):JSONArray = locked { db,_ -> NativeStopRecords.stopped(db,after) }
    fun stopStatus(id:String):JSONObject = locked { db,_ -> NativeStopRecords.status(db,id) }
    fun effectRecovery(complete:Boolean) { locked { db,_ -> transaction(db) { NativeStopRecords.recovery(db,complete) } } }
    fun confirmAbort(id: String, barrier: JSONObject): JSONObject = locked { db, _ -> transaction(db) { NativeSubmissionRecords.confirmAbort(db, id, barrier) } }
    fun markDeliveryUnknown(intentId: String): JSONObject = locked { db, _ -> transaction(db) { NativeSubmissionRecords.markUnknown(db, intentId) } }
    fun confirmAdmission(intentId: String, receipt: JSONObject): JSONObject = locked { db, _ -> transaction(db) {
        NativeSubmissionRecords.acknowledge(db, intentId, receipt, { frozen(db, it) }, { boundary("send.ack.draft-read"); draft(db, it) }, { id ->
            val current = draft(db, id); checkRevision(current, current.getLong("revision"))
            db.execSQL("UPDATE drafts SET revision=revision+1,state_version=state_version+1,text='',selection_ids='[]' WHERE id=?", arrayOf(id))
            draft(db, id)
        }).also { boundary("send.ack.beforeCommit") }
    } }.also { boundary("send.ack.afterCommit") }
    fun readObjectBytes(token: String, objectId: String): ByteArray {
        validateId(token); validateId(objectId)
        return locked { db, directory ->
            val representations = frozen(db, token).getJSONArray("representations")
            val representation = (0 until representations.length()).map { representations.getJSONObject(it) }.find { it.getString("objectId") == objectId }
                ?: fail("INPUT_NOT_FOUND", "固定输入未持有此内容对象。")
            verifyObject(directory, representation)
        }
    }
    fun discard(token: String, operationId: String): JSONObject {
        validateId(token); validateId(operationId)
        return locked { db, _ -> operation(db, operationId, JSONObject().put("method", "discard").put("token", token)) {
            if (NativeSubmissionRecords.holds(db, token) || NativeContentRetention.heldToken(db, token)) fail("INPUT_IN_USE", "发送或历史仍持有此固定输入，尚未释放恢复材料。")
            db.execSQL("DELETE FROM frozen_objects WHERE token=?", arrayOf(token)); db.execSQL("DELETE FROM frozen WHERE token=?", arrayOf(token)); JSONObject()
        } }
    }

    /** Trusted cross-owner publication: commit this hold before publishing an SDK/effect reference. */
    fun retainFrozen(ownerId: String, token: String): JSONObject = locked { db, directory -> transaction(db) {
        validateId(ownerId);validateId(token)
        val value=frozen(db,token);val representations=value.getJSONArray("representations")
        NativeContentRetention.retainToken(db,ownerId,token,value.getString("digest"))
        for(index in 0 until representations.length()) {
            val representation=representations.getJSONObject(index)
            NativeContentRetention.retain(db,directory,ownerId,representation.getString("objectId"),representation.getString("sha256"),token)
        }
        // Token hold and any content holds commit together, including text-only inputs.
        JSONObject().put("ownerId",ownerId).put("token",token).put("committed",true)
    } }
    fun retainContent(ownerId:String,objectId:String,fingerprint:String):JSONObject = locked {db,directory->transaction(db){
        validateId(ownerId);NativeContentRetention.retain(db,directory,ownerId,objectId,fingerprint)
        JSONObject().put("committed",true)
    }}
    fun readRetainedContent(ownerId:String,objectId:String):ByteArray = locked {db,directory->NativeContentRetention.read(db,directory,ownerId,objectId)}
    fun scanCleanup():JSONObject = locked {db,directory->NativeContentRetention.scan(db,directory)}
    fun reclaim(candidate:JSONObject):JSONObject = locked {db,directory->NativeContentRetention.reclaim(db,directory,candidate,boundary)}
    /** Scan is only a candidate set. Each final reclaim rechecks durable owners under the lease. */
    fun gc(): JSONObject {
        val scan=scanCleanup();val candidates=scan.getJSONArray("candidates");var reclaimed=0
        boundary("retention.scanned")
        for(index in 0 until candidates.length())if(reclaim(candidates.getJSONObject(index)).getString("state")=="reclaimed")reclaimed++
        locked { db, directory ->
        val jobs = mutableSetOf<String>()
        db.rawQuery("SELECT job FROM selections WHERE job IS NOT NULL", null).use { while (it.moveToNext()) jobs.add(it.getString(0)) }
        for (file in File(directory, "staging").listFiles() ?: emptyArray()) if (file.name !in jobs && file.isFile) {
            StorageDomainLease.acquire(File(File(directory,"jobs"),file.name))?.use { file.delete() }
        }
        }
        return JSONObject().put("reclaimed", reclaimed).put("protected", scan.getInt("protected"))
    }

    private fun finishSelection(id: String, selectionId: String, job: String, selection: JSONObject, hash: String?, operationId: String): JSONObject = locked { db, _ -> transaction(db) {
        verifyAttempt(db, id, selectionId, job)
        db.execSQL("UPDATE selections SET data=?,source_hash=?,job=NULL,job_owner=NULL WHERE id=?", arrayOf(selection.toString(), hash, selectionId))
        db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
        val reply = draft(db, id); db.execSQL("UPDATE operations SET reply=? WHERE id=?", arrayOf(reply.toString(), operationId)); reply
    } }
    private fun verifyAttempt(db: SQLiteDatabase, id: String, selectionId: String, job: String) {
        val actual = db.rawQuery("SELECT job FROM selections WHERE id=? AND draft_id=?", arrayOf(selectionId, id)).use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }
        if (actual != job || selectionId !in selectedIds(db, id)) fail("INPUT_PREPARATION_SUPERSEDED", "此准备结果已过期，未重新挂回已移除的附件。")
    }
    private fun selectedIds(db: SQLiteDatabase, id: String): List<String> = db.rawQuery("SELECT selection_ids FROM drafts WHERE id=?", arrayOf(id)).use {
        if (!it.moveToFirst()) fail("INPUT_NOT_FOUND", "草稿不存在。")
        val values = JSONArray(it.getString(0)); (0 until values.length()).map(values::getString)
    }
    private fun acquireJob(directory: File, job: String): StorageDomainLease =
        StorageDomainLease.acquire(File(File(directory, "jobs"), job)) ?: fail("INPUT_STORAGE_BUSY", "本地准备身份正在使用，请重试。")
    private fun recoverInterrupted(db: SQLiteDatabase, id: String, directory: File) {
        val updates = mutableListOf<Pair<String, JSONObject>>()
        for (selectionId in selectedIds(db, id)) db.rawQuery("SELECT data,job FROM selections WHERE id=?", arrayOf(selectionId)).use {
            if (it.moveToFirst() && !it.isNull(1)) {
                // A live PID is not proof of a live task. This lease also survives PID reuse correctly.
                // Publishers acquire it before making the durable job visible under the metadata lease.
                val available = StorageDomainLease.acquire(File(File(directory, "jobs"), it.getString(1)))
                if (available != null) {
                    available.close()
                    val data = JSONObject(it.getString(0)); data.getJSONObject("preparation").put("state", "failed").put("reason", "原生准备已中断或未能完成提交，请重试准备或重新选择；已有固定输入仍保留。")
                    updates.add(Pair(selectionId, data))
                }
            }
        }
        if (updates.isNotEmpty()) transaction(db) {
            for ((selectionId, data) in updates) db.execSQL("UPDATE selections SET data=?,job=NULL,job_owner=NULL WHERE id=?", arrayOf(data.toString(), selectionId))
            db.execSQL("UPDATE drafts SET state_version=state_version+1 WHERE id=?", arrayOf(id))
        }
    }
    private fun frozen(db: SQLiteDatabase, token: String): JSONObject = db.rawQuery("SELECT data FROM frozen WHERE token=?", arrayOf(token)).use {
        if (!it.moveToFirst()) fail("INPUT_NOT_FOUND", "固定输入不存在或已明确丢弃。")
        JSONObject(it.getString(0))
    }
    private fun verifyObject(directory: File, rep: JSONObject): ByteArray {
        val id = rep.getString("objectId"); validateId(id)
        val file = File(File(directory, "objects"), id); val length = rep.getLong("byteLength")
        if (length !in 0..NativeAttachmentPreparation.IMAGE_BYTES.toLong() || !file.isFile || file.length() != length)
            fail("INPUT_CONTENT_MISSING", "固定内容缺失或长度不符，未从原件替换或使用缩略图。")
        val bytes = file.readBytes()
        if (sha256(bytes) != rep.getString("sha256")) fail("INPUT_CONTENT_CORRUPT", "固定内容摘要不符，保留记录并停止发送。")
        return bytes
    }
    private fun verifyBudget(text: String, reps: JSONArray, capability: JSONObject) {
        val limits = capability.getJSONObject("limits"); var images = 0; var body = text.toByteArray(Charsets.UTF_8).size.toLong(); var base64 = 0L
        for (index in 0 until reps.length()) {
            val rep = reps.getJSONObject(index)
            if (rep.getString("kind") == "image") { images++; val count = 4L * ((rep.getLong("byteLength") + 2) / 3); base64 += count; body += count }
            else body += rep.getLong("byteLength")
        }
        if (images > minOf(ATTACHMENTS, limits.optInt("maxImages", ATTACHMENTS)) || base64 > 8L * 1024 * 1024 || body > minOf(10L * 1024 * 1024, limits.optLong("maxRequestBytes", 10L * 1024 * 1024)))
            fail("INPUT_BUDGET_EXCEEDED", "当前完整输入超过准备预算，正文未截断；请主动减少附件或文字。")
        // This excludes existing history and protocol overhead. Runtime must validate actual body again.
    }
    private fun failurePreparation(error: Exception): JSONObject {
        val known = error as? NativeInputException
        val state = when (known?.code) {
            "INPUT_UNSUPPORTED" -> "unsupported"
            "INPUT_BUDGET_EXCEEDED" -> "budget-exceeded"
            "INPUT_SOURCE_CHANGED", "INPUT_SOURCE_UNAVAILABLE" -> "source-unavailable"
            else -> if (error is SecurityException || error is java.io.FileNotFoundException) "source-unavailable" else "failed"
        }
        return JSONObject().put("state", state).put("reason", known?.message ?: "来源或本地准备不可用，保留草稿，请重新选择或重试。")
    }

    /** Safe native validation facts; no database paths or content bytes are exposed. */
    fun storageConfiguration(): JSONObject = locked { db, _ -> JSONObject().put("journalMode", pragma(db, "journal_mode"))
        .put("synchronous", pragma(db, "synchronous").toInt()).put("foreignKeys", pragma(db, "foreign_keys").toInt())
        .put("pageSize", pragma(db, "page_size").toLong()).put("maxPages", pragma(db, "max_page_count").toLong())
        .put("sqliteVersion", scalar(db, "SELECT sqlite_version()"))
        .put("writer", transaction(db) { JSONObject().put("journalMode", pragma(db, "journal_mode")).put("synchronous", pragma(db, "synchronous").toInt()).put("foreignKeys", pragma(db, "foreign_keys").toInt()).put("pageSize", pragma(db, "page_size").toLong()).put("maxPages", pragma(db, "max_page_count").toLong()) }) }

    private fun draft(db: SQLiteDatabase, id: String): JSONObject {
        db.rawQuery("SELECT d.revision,d.text,d.selection_ids,c.capability,d.state_version,c.data FROM drafts d JOIN conversations c ON c.id=d.id WHERE d.id=?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) fail("INPUT_NOT_FOUND", "尚未登记此会话，无法恢复草稿。")
            val selected = JSONArray(cursor.getString(2)); val selections = JSONArray()
            for (index in 0 until selected.length()) {
                db.rawQuery("SELECT data FROM selections WHERE id=? AND draft_id=?", arrayOf(selected.getString(index), id)).use { row ->
                    if (!row.moveToFirst()) fail("INPUT_CONTENT_MISSING", "附件记录缺失，保留草稿并停止发送。")
                    selections.put(JSONObject(row.getString(0)))
                }
            }
            return JSONObject().put("id", id).put("revision", cursor.getLong(0)).put("text", cursor.getString(1))
                .put("selections", selections).put("committed", true).put("stateVersion", cursor.getLong(4)).apply {
                    if (!cursor.isNull(3)) put("capability", JSONObject(cursor.getString(3)))
                    JSONObject(cursor.getString(5)).optJSONObject("submissionContext")?.let { put("submissionContext", it) }
                }
        }
    }

    private fun checkRevision(current: JSONObject, expected: Long) {
        if (expected < 0 || current.getLong("revision") != expected) fail("INPUT_CONFLICT", "草稿已更新，请保留当前编辑并重新读取已保存版本。")
        if (expected >= 9_007_199_254_740_991L) fail("INPUT_INCOMPATIBLE", "草稿版本超出当前版本支持范围。")
    }

    private fun operation(db: SQLiteDatabase, id: String, payload: JSONObject, action: () -> JSONObject): JSONObject = transaction(db) {
        replay(db, id, payload)?.let { return@transaction it }
        val hash = sha256(payload.toString().toByteArray(Charsets.UTF_8))
        val reply = action()
        db.execSQL("INSERT INTO operations(id,payload_hash,reply) VALUES(?,?,?)", arrayOf(id, hash, reply.toString()))
        reply
    }
    private fun replay(db: SQLiteDatabase, id: String, payload: JSONObject): JSONObject? {
        val hash = sha256(payload.toString().toByteArray(Charsets.UTF_8))
        db.rawQuery("SELECT payload_hash,reply FROM operations WHERE id=?", arrayOf(id)).use { cursor ->
            if (cursor.moveToFirst()) {
                if (cursor.getString(0) != hash) fail("INPUT_OPERATION_CONFLICT", "此操作身份已用于不同内容，请重新保存。")
                return JSONObject(cursor.getString(1))
            }
        }
        return null
    }

    private fun <T> transaction(db: SQLiteDatabase, action: () -> T): T {
        db.beginTransactionNonExclusive()
        val value: T
        try { value = action(); boundary("transaction.beforeCommit"); db.setTransactionSuccessful() }
        finally { db.endTransaction() } // A result escapes only after actual COMMIT returns.
        boundary("transaction.afterCommit")
        return value
    }

    private fun <T> locked(action: (SQLiteDatabase, File) -> T): T = synchronized(monitor) {
        try {
            if (closed) fail("INPUT_STORE_CLOSED", "草稿存储已关闭，请重新连接。")
            if (!context.getSystemService(UserManager::class.java).isUserUnlocked) fail("INPUT_WAITING_UNLOCK", "请在开机后先解锁一次设备。")
            if (context.isDeviceProtectedStorage) fail("INPUT_STORAGE_FAILED", "草稿必须保存在私有凭据加密存储中。")
            val directory = File(context.noBackupFilesDir, namespace)
            val deadline = SystemClock.elapsedRealtime() + leaseWaitMs
            var lease = StorageDomainLease.acquire(directory)
            while (lease == null && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(minOf(10, deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1))
                lease = StorageDomainLease.acquire(directory)
            }
            if (lease == null) fail("INPUT_STORAGE_BUSY", "草稿存储正在提交，请稍后重试。")
            lease.use {
                syncDirectory(directory.parentFile!!)
                val current = helper ?: InputDatabase(context, File(directory, "input.sqlite").absolutePath, maximumDatabaseBytes,boundary).also { helper = it }
                action(current.writableDatabase, directory)
            }
        } catch (error: NativeInputException) { throw error }
        catch (_: SQLiteException) { fail("INPUT_STORAGE_FAILED", "草稿保存或读取失败；保留现有数据，请重试或检查可用空间。") }
        catch (_: Exception) { fail("INPUT_STORAGE_FAILED", "草稿存储暂不可用，现有数据未被重建或清空。") }
    }

    override fun close() = synchronized(monitor) { sourceAdmissions.values.toList().forEach { it.close() }; helper?.close(); helper = null; closed = true }

    private class InputDatabase(context: Context, path: String, private val maximumBytes: Long?,private val boundary:(String)->Unit) : SQLiteOpenHelper(context, path, null, 7,
        DatabaseErrorHandler { throw NativeInputException("INPUT_STORAGE_CORRUPT", "草稿数据库损坏，已保留原库和材料。") }) {
        init { setWriteAheadLoggingEnabled(true) }
        override fun onConfigure(db: SQLiteDatabase) {
            db.setForeignKeyConstraintsEnabled(true)
            // Connection-local PRAGMA must cover current AND future WAL pool connections.
            db.execPerConnectionSQL("PRAGMA synchronous=FULL", null)
        }
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL,capability TEXT)")
            db.execSQL("CREATE TABLE drafts(id TEXT PRIMARY KEY REFERENCES conversations(id),revision INTEGER NOT NULL,state_version INTEGER NOT NULL,text TEXT NOT NULL,selection_ids TEXT NOT NULL)")
            db.execSQL("CREATE TABLE selections(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES drafts(id),data TEXT NOT NULL,source_uri TEXT NOT NULL,source_hash TEXT,job TEXT,job_owner INTEGER,object_id TEXT)")
            db.execSQL("CREATE TABLE objects(id TEXT PRIMARY KEY,representation TEXT NOT NULL)")
            db.execSQL("CREATE TABLE frozen(token TEXT PRIMARY KEY,data TEXT NOT NULL)")
            db.execSQL("CREATE TABLE frozen_objects(token TEXT NOT NULL REFERENCES frozen(token),object_id TEXT NOT NULL REFERENCES objects(id),PRIMARY KEY(token,object_id))")
            db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,reply TEXT NOT NULL)")
            createSelectionIndex(db)
            NativeSubmissionRecords.createSchema(db)
            NativeSubmissionRecords.createLocationSchema(db)
            NativeStopRecords.createSchema(db)
            NativeContentRetention.createSchema(db)
        }
        override fun onOpen(db: SQLiteDatabase) {
            if (maximumBytes != null) {
                val pages = maxOf(1, maximumBytes / pragma(db, "page_size").toLong())
                db.execPerConnectionSQL("PRAGMA max_page_count=$pages", null)
            }
            val journal = pragma(db, "journal_mode"); val synchronous = pragma(db, "synchronous"); val foreignKeys = pragma(db, "foreign_keys")
            if (journal != "wal" || synchronous != "2" || foreignKeys != "1")
                fail("INPUT_STORAGE_POLICY", "草稿数据库未能启用所需的耐久参数：journal=$journal, synchronous=$synchronous, foreignKeys=$foreignKeys。")
        }
        private fun createSelectionIndex(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE selection_operations(operation_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,uri TEXT NOT NULL)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // Published schema 4 advanced to 6 in T16; 5 was only an isolated T11 fixture.
            if ((oldVersion !in 1..4 && oldVersion != 6) || newVersion != 7) fail("INPUT_INCOMPATIBLE", "草稿数据库版本不兼容，已保留现有数据。")
            try {
            boundary("migration.before")
            if (oldVersion == 1) createSelectionIndex(db)
            if (oldVersion < 3) NativeSubmissionRecords.createSchema(db)
            if(oldVersion < 4) NativeSubmissionRecords.createLocationSchema(db)
            if(oldVersion < 6) NativeContentRetention.createSchema(db)
            NativeStopRecords.createSchema(db,false)
            boundary("migration.prepared")
            } catch(error:NativeInputException) {throw error}
            catch(_:Exception) {fail("INPUT_MIGRATION_FAILED","草稿和控制记录迁移未完成，已保留原库与材料；运行保持关闭，请用兼容版本重试。")}
        }
        override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { fail("INPUT_INCOMPATIBLE", "草稿数据库来自更新版本，已保留现有数据。") }
    }

    companion object {
        const val DRAFT_CHARACTERS = 100_000
        const val ATTACHMENTS = 4
        private val monitor = Any()
        private val activeJobs = ConcurrentHashMap<String, CancellationSignal>()
        internal fun inputDigest(text: String, representations: JSONArray): String {
            val output = ByteArrayOutputStream(); output.write("input-v1\n".toByteArray(Charsets.UTF_8))
            fun frame(value: String) { val bytes = value.toByteArray(Charsets.UTF_8); output.write("${bytes.size}:".toByteArray(Charsets.US_ASCII)); output.write(bytes) }
            frame(text); frame(representations.length().toString())
            for (index in 0 until representations.length()) {
                val rep = representations.getJSONObject(index)
                for (key in listOf("kind", "mimeType", "sha256", "byteLength", "range")) frame(rep.get(key).toString())
            }
            return sha256(output.toByteArray())
        }
        internal fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        private fun fail(code: String, message: String): Nothing = throw NativeInputException(code, message)
        private fun validateId(value: String) { if (!value.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}"))) fail("INPUT_INVALID_ARGUMENT", "输入操作身份无效。") }
        private fun validateText(value: String) {
            var index = 0
            while (index < value.length) {
                val char = value[index]
                if (Character.isHighSurrogate(char)) {
                    if (index + 1 >= value.length || !Character.isLowSurrogate(value[index + 1])) fail("INPUT_INVALID", "文字包含未完成的 Unicode 字符，请继续编辑后重试；已保存版本保持不变。")
                    index += 2
                } else {
                    if (Character.isLowSurrogate(char)) fail("INPUT_INVALID", "文字包含未完成的 Unicode 字符，请继续编辑后重试；已保存版本保持不变。")
                    index++
                }
            }
        }
        private fun scalar(db: SQLiteDatabase, sql: String): String = db.rawQuery(sql, null).use { it.moveToFirst(); it.getString(0) }
        private fun pragma(db: SQLiteDatabase, name: String) = scalar(db, "PRAGMA $name")
        private fun syncDirectory(directory: File) { val fd = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0); try { Os.fsync(fd) } finally { Os.close(fd) } }
    }
}
