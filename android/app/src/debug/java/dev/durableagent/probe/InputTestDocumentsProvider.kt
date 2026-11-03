package dev.durableagent.probe

import android.database.Cursor
import android.database.MatrixCursor
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsProvider
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.ConcurrentHashMap

/** Debug SAF source. Only synthetic test documents; fault controls are not product actions. */
class InputTestDocumentsProvider : DocumentsProvider() {
    private val documents = ConcurrentHashMap<String, Bundle>()
    private val reads = ConcurrentHashMap<String, Int>()
    private val metadataGates = ConcurrentHashMap<String, java.util.concurrent.CountDownLatch>()
    private val metadataEntered = ConcurrentHashMap<String, Boolean>()
    override fun onCreate() = true
    override fun queryRoots(projection: Array<out String>?): Cursor = MatrixCursor(projection ?: ROOT_COLUMNS).apply {
        newRow().add(DocumentsContract.Root.COLUMN_ROOT_ID, "input-fixtures")
            .add(DocumentsContract.Root.COLUMN_DOCUMENT_ID, "root")
            .add(DocumentsContract.Root.COLUMN_TITLE, "DurableAgent 测试资料")
            .add(DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD)
            .add(DocumentsContract.Root.COLUMN_MIME_TYPES, "*/*")
    }
    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS).apply { append(this, documentId) }
    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor = MatrixCursor(projection ?: DOCUMENT_COLUMNS).apply {
        for (id in documents.keys.sorted()) append(this, id)
    }
    override fun isChildDocument(parentDocumentId: String, documentId: String) = parentDocumentId == "root" && documents.containsKey(documentId)
    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("Synthetic source is read only")
        val data = documents[documentId] ?: throw FileNotFoundException("Synthetic source missing")
        if (data.getBoolean("denied")) throw SecurityException("Synthetic permission revoked")
        val count = reads.merge(documentId, 1, Int::plus) ?: 1
        val bytes = if (count >= data.getInt("changeAtRead", Int.MAX_VALUE)) data.getByteArray("changed") ?: data.getByteArray("bytes")!! else data.getByteArray("bytes")!!
        if (data.getBoolean("slow")) {
            val pipe = ParcelFileDescriptor.createReliablePipe()
            signal?.setOnCancelListener { try { pipe[0].close(); pipe[1].close() } catch (_: Exception) { } }
            Thread {
                try { ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { output ->
                    for (offset in bytes.indices step 128) { output.write(bytes, offset, minOf(128, bytes.size - offset)); Thread.sleep(20) }
                } } catch (_: Exception) { }
            }.start()
            return pipe[0]
        }
        val directory = File(context!!.noBackupFilesDir, "input-source-fixtures").apply { mkdirs() }
        val file = File(directory, documentId); file.writeBytes(bytes)
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        val id = arg ?: ""
        if (!id.matches(Regex("[a-zA-Z0-9_-]{1,100}"))) throw IllegalArgumentException("Synthetic source ID invalid")
        return when (method) {
            "fixture.put" -> { val data = Bundle(extras ?: Bundle()); require(data.getByteArray("bytes") != null); documents[id] = data; reads[id] = 0
                metadataGates.remove(id)?.countDown(); metadataEntered.remove(id)
                if(data.getBoolean("metadataBlocked")) metadataGates[id]=java.util.concurrent.CountDownLatch(1)
                Bundle() }
            "fixture.update" -> { documents[id]?.putAll(extras ?: Bundle()) ?: throw FileNotFoundException(); Bundle() }
            "fixture.delete" -> { documents.remove(id); Bundle() }
            "fixture.reads" -> Bundle().apply { putInt("reads", reads[id] ?: 0) }
            "fixture.metadata-state" -> Bundle().apply { putBoolean("entered",metadataEntered[id]==true) }
            "fixture.release-metadata" -> { metadataGates[id]?.countDown(); Bundle() }
            else -> super.call(method, arg, extras) ?: Bundle()
        }
    }
    private fun append(cursor: MatrixCursor, id: String) {
        val row = cursor.newRow().add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, id)
        if (id == "root") { row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, "DurableAgent 测试资料").add(DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.MIME_TYPE_DIR).add(DocumentsContract.Document.COLUMN_FLAGS, 0); return }
        val data = documents[id] ?: throw FileNotFoundException()
        metadataGates[id]?.let { gate ->
            metadataEntered[id]=true
            if(!gate.await(10,java.util.concurrent.TimeUnit.SECONDS)) throw FileNotFoundException("Synthetic metadata deadline")
        }
        row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, data.getString("name", id))
            .add(DocumentsContract.Document.COLUMN_MIME_TYPE, data.getString("mime", "text/plain"))
            .add(DocumentsContract.Document.COLUMN_SIZE, if (data.getBoolean("unknownSize")) null else data.getByteArray("bytes")!!.size)
            .add(DocumentsContract.Document.COLUMN_FLAGS, 0)
    }
    companion object {
        const val AUTHORITY = "dev.durableagent.probe.input-fixtures"
        private val ROOT_COLUMNS = arrayOf(DocumentsContract.Root.COLUMN_ROOT_ID, DocumentsContract.Root.COLUMN_DOCUMENT_ID, DocumentsContract.Root.COLUMN_TITLE, DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.COLUMN_MIME_TYPES)
        private val DOCUMENT_COLUMNS = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_FLAGS)
    }
}
