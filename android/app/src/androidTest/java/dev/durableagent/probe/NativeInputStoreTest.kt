package dev.durableagent.probe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Public native input seam, actual platform SQLite/files; no Node host is started. */
@RunWith(AndroidJUnit4::class)
class NativeInputStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun conversation(id: String) = JSONObject().put("id", id).put("title", id)
        .put("model", JSONObject().put("provider", "validation").put("modelId", "text-image").put("name", "Validation"))
    private fun capability() = JSONObject().put("version", "validation-1").put("provider", "validation").put("modelId", "text-image")
        .put("source", "validation").put("input", org.json.JSONArray(listOf("text", "image"))).put("limits", JSONObject()).put("applicationPolicy", JSONObject())
    private fun source(bytes: ByteArray, mime: String = "text/plain", extra: Bundle = Bundle()): Uri {
        val id = "fixture-${UUID.randomUUID()}"
        context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"), "fixture.put", id,
            Bundle(extra).apply { putByteArray("bytes", bytes); putString("mime", mime); putString("name", "synthetic input") })
        return DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY, id)
    }

    @Test fun committedDraftsReopenIndependentlyAndClearNeverResetsRevision() {
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { store ->
            store.rememberConversation(conversation("chat-a"))
            store.rememberConversation(conversation("chat-b"))
            val saved = store.save("chat-a", 0, "save-a", "北京🌍 draft A", emptyList())
            assertEquals(1L, saved.getLong("revision"))
            assertTrue(saved.getBoolean("committed"))
            store.save("chat-b", 0, "save-b", "independent B", emptyList())
        }
        NativeInputStore(context, namespace).use { reopened ->
            assertEquals("北京🌍 draft A", reopened.read("chat-a").getString("text"))
            assertEquals("independent B", reopened.read("chat-b").getString("text"))
            val cleared = reopened.clear("chat-a", 1, "clear-a")
            assertEquals(2L, cleared.getLong("revision"))
            assertEquals("", cleared.getString("text"))
            assertEquals(3L, reopened.save("chat-a", 2, "same-text-after-clear", "北京🌍 draft A", emptyList()).getLong("revision"))
            assertEquals(2, reopened.list().getJSONArray("conversations").length())
        }
    }

    private fun expectCode(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") }
        catch (error: NativeInputException) { assertEquals(code, error.code); assertNull(error.cause) }
    }

    @Test fun duplicateOperationReplaysItsReceiptAndStaleCallbacksCannotReplaceNewerDrafts() {
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { first ->
            first.rememberConversation(conversation("chat"))
            val receipt = first.save("chat", 0, "first-operation", "first", emptyList())
            NativeInputStore(context, namespace).use { second ->
                second.save("chat", 1, "second-operation", "second", emptyList())
                assertEquals(receipt.toString(), second.save("chat", 0, "first-operation", "first", emptyList()).toString())
                expectCode("INPUT_OPERATION_CONFLICT") { second.save("chat", 0, "first-operation", "different", emptyList()) }
                expectCode("INPUT_CONFLICT") { first.clear("chat", 1, "late-clear") }
                expectCode("INPUT_CONFLICT") { first.save("chat", 1, "late-save", "old text", emptyList()) }
                assertEquals("second", second.read("chat").getString("text"))
                assertEquals(2L, second.read("chat").getLong("revision"))
                val config = second.storageConfiguration()
                assertEquals("wal", config.getString("journalMode")); assertEquals(2, config.getInt("synchronous")); assertEquals(1, config.getInt("foreignKeys"))
                assertEquals(2, config.getJSONObject("writer").getInt("synchronous")); assertEquals("wal", config.getJSONObject("writer").getString("journalMode"))
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("inputEvidence", config.toString()) })
            }
        }
    }

    @Test fun preparedTextFreezePinsExactBytesAfterSourceChangesAndDraftIsCleared() {
        val namespace = "input-test-${UUID.randomUUID()}"
        val original = "完整 UTF-8 正文 北京🌍".toByteArray(Charsets.UTF_8)
        val uri = source(original)
        NativeInputStore(context, namespace).use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val selected = store.selectSource("chat", 0, "select-source", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val selection = selected.getJSONArray("selections").getJSONObject(0).getString("id")
            val prepared = store.prepare("chat", selection, "prepare-source")
            assertEquals(selected.getLong("revision"), prepared.getLong("revision"))
            assertTrue(prepared.getLong("stateVersion") > selected.getLong("stateVersion"))
            val frozen = store.freeze("chat", prepared.getLong("revision"), "freeze-source")
            val token = frozen.getString("token"); val objectId = frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")
            assertArrayEquals(original, store.readObjectBytes(token, objectId))
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"), "fixture.update", DocumentsContract.getDocumentId(uri), Bundle().apply { putByteArray("bytes", "new source".toByteArray()) })
            store.clear("chat", prepared.getLong("revision"), "clear-source")
            store.gc()
            assertEquals(frozen.toString(), store.readFrozen(token).toString())
            assertArrayEquals(original, store.readObjectBytes(token, objectId))
            store.discard(token, "discard-source"); store.gc()
            expectCode("INPUT_NOT_FOUND") { store.readFrozen(token) }
            assertTrue(context.contentResolver.openInputStream(uri)!!.use { it.readBytes().contentEquals("new source".toByteArray()) })
        }
    }

    @Test fun unicodeDigestIsCrossLanguageAndInvalidSurrogatesDoNotOverwriteCommittedText() {
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            store.save("chat", 0, "valid", "北京🌍", emptyList())
            for ((index, invalid) in listOf("\uD800", "\uDC00", "x\uD800y").withIndex())
                expectCode("INPUT_INVALID") { store.save("chat", 1, "invalid-$index", invalid, emptyList()) }
            assertEquals("北京🌍", store.read("chat").getString("text"))
            val frozen = store.freeze("chat", 1, "freeze-unicode")
            assertEquals("5f9e1dc047edf67483d8970fcb805d50352d778050462616d066619daec735d8", frozen.getString("digest"))
            store.clear("chat", 1, "action-bound")
            expectCode("INPUT_OPERATION_CONFLICT") { store.save("chat", 1, "action-bound", "", emptyList()) }
        }
    }

    @Test fun sourceLossIsVisibleWithoutDiscardingPreparedRecoveryBytes() {
        val bytes = "source to preserve".toByteArray(); val uri = source(bytes)
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var token: String; lateinit var objectId: String
        NativeInputStore(context, namespace).use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val selected = store.selectSource("chat", 0, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val id = selected.getJSONArray("selections").getJSONObject(0).getString("id")
            store.prepare("chat", id, "prepare")
            val frozen = store.freeze("chat", 1, "freeze"); token = frozen.getString("token"); objectId = frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")
        }
        context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"), "fixture.update", DocumentsContract.getDocumentId(uri), Bundle().apply { putBoolean("denied", true) })
        NativeInputStore(context, namespace).use { reopened ->
            val selection = reopened.read("chat").getJSONArray("selections").getJSONObject(0)
            assertEquals("unavailable", selection.getJSONObject("source").getString("access"))
            assertEquals("ready", selection.getJSONObject("preparation").getString("state"))
            assertArrayEquals(bytes, reopened.readObjectBytes(token, objectId))
            reopened.gc(); assertArrayEquals(bytes, reopened.readObjectBytes(token, objectId))
        }
    }

    @Test fun changedSourceUnknownLengthAndInvalidUtf8NeverBecomeReadyOrSilentlyTruncated() {
        val examples = listOf(
            Triple("changed", source("original".toByteArray(), extra = Bundle().apply { putByteArray("changed", "changed!".toByteArray()); putInt("changeAtRead", 2) }), "source-unavailable"),
            Triple("utf8", source(byteArrayOf(0xc3.toByte(), 0x28)), "unsupported"),
            Triple("oversize", source(ByteArray(256 * 1024 + 1) { 65 }, extra = Bundle().apply { putBoolean("unknownSize", true) }), "budget-exceeded")
        )
        for ((name, uri, expected) in examples) NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            store.save("chat", 0, "text", "keep this draft", emptyList())
            val selected = store.selectSource("chat", 1, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val selection = selected.getJSONArray("selections").getJSONObject(0)
            val state = if (selection.getJSONObject("preparation").getString("state") == "selected")
                store.prepare("chat", selection.getString("id"), "prepare").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state")
            else selection.getJSONObject("preparation").getString("state")
            assertEquals(name, expected, state)
            expectCode("INPUT_NOT_READY") { store.freeze("chat", 2, "freeze") }
            assertEquals("keep this draft", store.read("chat").getString("text"))
        }
    }

    @Test fun pngPreparationKeepsAlphaAndRecordsActualFullFrameResize() {
        val bitmap = Bitmap.createBitmap(2048, 1024, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(0x4000ff00)
        val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle()
        val uri = source(output.toByteArray(), "image/png")
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val selected = store.selectSource("chat", 0, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val prepared = store.prepare("chat", selected.getJSONArray("selections").getJSONObject(0).getString("id"), "prepare")
            val rep = prepared.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getJSONObject("representation")
            assertEquals(2048, rep.getInt("sourceWidth")); assertEquals(1024, rep.getInt("sourceHeight")); assertEquals(1024, rep.getInt("width")); assertEquals(512, rep.getInt("height")); assertEquals("full", rep.getString("range"))
            val frozen = store.freeze("chat", 1, "freeze")
            val fixed = store.readObjectBytes(frozen.getString("token"), rep.getString("objectId"))
            val decoded = BitmapFactory.decodeByteArray(fixed, 0, fixed.size)
            try { assertEquals(64, android.graphics.Color.alpha(decoded.getPixel(100, 100))) } finally { decoded.recycle() }
        }
    }

    @Test fun slowSourceCannotBlockTextCommitAndLateResultCannotRestoreRemovedSelection() {
        val uri = source(ByteArray(32 * 1024) { 65 }, extra = Bundle().apply { putBoolean("slow", true) })
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val pool = Executors.newSingleThreadExecutor()
            try {
                val selecting = pool.submit<JSONObject> { store.selectSource("chat", 0, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                var current: JSONObject
                do { current = store.read("chat"); if (current.getLong("revision") == 0L) Thread.sleep(10) } while (current.getLong("revision") == 0L && System.nanoTime() < end)
                assertEquals(1L, current.getLong("revision"))
                val start = System.nanoTime()
                val saved = store.save("chat", 1, "edit-while-reading", "independent text commit", emptyList())
                assertTrue("Source read blocked text commit", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000)
                assertEquals(2L, saved.getLong("revision"))
                try { selecting.get(5, TimeUnit.SECONDS); fail("Removed source should not reattach") }
                catch (error: java.util.concurrent.ExecutionException) { assertEquals("INPUT_PREPARATION_SUPERSEDED", (error.cause as NativeInputException).code) }
                val final = store.read("chat"); assertEquals("independent text commit", final.getString("text")); assertEquals(0, final.getJSONArray("selections").length())
            } finally { pool.shutdownNow() }
        }
    }

    @Test fun committedSelectionIsReturnedBeforeSlowSourceAndIndependentTextSaveIsPreserved() {
        val uri = source(ByteArray(4 * 1024) { 65 }, extra = Bundle().apply { putBoolean("slow", true); putBoolean("metadataBlocked",true) })
        val fixtureUri=Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"); val documentId=DocumentsContract.getDocumentId(uri)
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val committed = java.util.concurrent.CompletableFuture<JSONObject>()
            val pool = Executors.newSingleThreadExecutor()
            try {
                val selecting = pool.submit<JSONObject> { store.selectSource("chat", 0, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    kind="text", onCommitted = { committed.complete(it) }) }
                val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
                while(context.contentResolver.call(fixtureUri,"fixture.metadata-state",documentId,null)?.getBoolean("entered")!=true && System.nanoTime()<deadline) Thread.sleep(10)
                assertTrue(context.contentResolver.call(fixtureUri,"fixture.metadata-state",documentId,null)!!.getBoolean("entered"))
                val receipt = committed.get(2, TimeUnit.SECONDS)
                assertTrue(receipt.getBoolean("committed")); assertEquals(1L, receipt.getLong("revision"))
                assertEquals("preparing", receipt.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
                assertEquals("unknown",receipt.getJSONArray("selections").getJSONObject(0).getJSONObject("source").getString("access"))
                assertEquals("application/octet-stream",receipt.getJSONArray("selections").getJSONObject(0).getJSONObject("source").getString("mimeType"))
                assertFalse("Receipt must precede the slow source result", selecting.isDone)
                val selectionId = receipt.getJSONArray("selections").getJSONObject(0).getString("id")
                NativeInputStore(context, namespace).use { writer ->
                    // A separate helper sees the committed row before accepting the author update.
                    assertEquals(receipt.toString(), writer.inspect("chat").toString())
                    val start = System.nanoTime()
                    val saved = writer.save("chat", 1, "typing-after-picker", "typed while source is pending", listOf(selectionId))
                    assertTrue("Source blocked independent writer", TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start) < 1000)
                    assertEquals(2L, saved.getLong("revision")); assertFalse(selecting.isDone)
                }
                context.contentResolver.call(fixtureUri,"fixture.release-metadata",documentId,null)
                val finished = selecting.get(5, TimeUnit.SECONDS)
                assertEquals("typed while source is pending", finished.getString("text")); assertEquals(2L, finished.getLong("revision"))
                assertEquals("selected", finished.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            } finally { context.contentResolver.call(fixtureUri,"fixture.release-metadata",documentId,null);pool.shutdownNow() }
        }
    }

    @Test fun twoBlockedWorkersDoNotBlockThirdAdmissionSaveOrPendingOwnershipCleanup() {
        val namespace="input-test-${UUID.randomUUID()}"
        val uris=(0..3).map { source("source-$it".toByteArray(),extra=Bundle().apply {putBoolean("metadataBlocked",true)}) }
        val fixtureUri=Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}")
        fun entered(index:Int)=context.contentResolver.call(fixtureUri,"fixture.metadata-state",DocumentsContract.getDocumentId(uris[index]),null)!!.getBoolean("entered")
        fun release(index:Int){context.contentResolver.call(fixtureUri,"fixture.release-metadata",DocumentsContract.getDocumentId(uris[index]),null)}
        val pool=Executors.newFixedThreadPool(2)
        val admissions=mutableListOf<NativeInputStore.SourceAdmission>()
        val store=NativeInputStore(context,namespace)
        try {
            store.rememberConversation(conversation("chat"),capability())
            val first=store.admitSource("chat",0,"first",uris[0],Intent.FLAG_GRANT_READ_URI_PERMISSION,"text").also(admissions::add)
            val firstWork=pool.submit<JSONObject>{first.continueSource()}
            val second=store.admitSource("chat",1,"second",uris[1],Intent.FLAG_GRANT_READ_URI_PERMISSION,"text").also(admissions::add)
            val secondWork=pool.submit<JSONObject>{second.continueSource()}
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            while((!entered(0)||!entered(1))&&System.nanoTime()<deadline)Thread.sleep(10)
            assertTrue(entered(0)&&entered(1))
            val started=System.nanoTime()
            val third=store.admitSource("chat",2,"third",uris[2],Intent.FLAG_GRANT_READ_URI_PERMISSION,"text").also(admissions::add)
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)<1000)
            val receipt=third.receipt;assertEquals(3L,receipt.getLong("revision"));assertFalse(entered(2))
            val ids=(0 until receipt.getJSONArray("selections").length()).map{receipt.getJSONArray("selections").getJSONObject(it).getString("id")}
            NativeInputStore(context,namespace).use { writer ->
                // The queued third task still owns its lease and cannot be mistaken for an orphan.
                assertTrue((0..2).all{writer.inspect("chat").getJSONArray("selections").getJSONObject(it).getJSONObject("preparation").getString("state")=="preparing"})
                val saveStart=System.nanoTime();writer.save("chat",3,"text","third selection did not block typing",ids)
                assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-saveStart)<1000)
                writer.save("chat",4,"remove-queued","third selection did not block typing",ids.take(2));writer.gc()
            }
            third.close()
            expectCode("INPUT_PREPARATION_SUPERSEDED"){third.continueSource()}
            assertFalse(entered(2));assertFalse(firstWork.isDone);assertFalse(secondWork.isDone)
            release(0);release(1);firstWork.get(5,TimeUnit.SECONDS);secondWork.get(5,TimeUnit.SECONDS)
            assertEquals("third selection did not block typing",store.inspect("chat").getString("text"))
            val abandoned=store.admitSource("chat",5,"abandoned",uris[3],Intent.FLAG_GRANT_READ_URI_PERMISSION,"text").also(admissions::add)
            assertTrue(abandoned.needsContinuation);store.close()
            NativeInputStore(context,namespace).use { reopened ->
                assertEquals("failed",reopened.inspect("chat").getJSONArray("selections").getJSONObject(2).getJSONObject("preparation").getString("state"))
                assertEquals("third selection did not block typing",reopened.inspect("chat").getString("text"))
            }
            assertFalse(entered(3))
        } finally { uris.indices.forEach(::release);admissions.forEach{it.close()};pool.shutdownNow();store.close() }
    }

    @Test fun lostSelectionReceiptReplaysBeforeReopeningAnUnavailableSource() {
        val uri = source("selected once".toByteArray())
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val receipt = store.selectSource("chat", 0, "select-once", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"), "fixture.delete", DocumentsContract.getDocumentId(uri), null)
            assertEquals(receipt.toString(), store.selectionReceipt("chat", 0, "select-once", "text")!!.toString())
            expectCode("INPUT_OPERATION_CONFLICT") { store.selectionReceipt("chat", 1, "select-once", "text") }
            expectCode("INPUT_OPERATION_CONFLICT") { store.selectionReceipt("chat", 0, "select-once", "image") }
            assertEquals(receipt.toString(), store.selectSource("chat", 0, "select-once", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION).toString())
            assertEquals(1L, store.read("chat").getLong("revision"))
            store.save("chat", 1, "save-not-picker", "text", emptyList())
            expectCode("INPUT_OPERATION_CONFLICT") { store.selectionReceipt("chat", 1, "save-not-picker", "text") }
        }
    }

    @Test fun failedFinalPublicationCanRecoverInTheSameProcessAfterStorageReturns() {
        val uri = source("recover complete source".toByteArray())
        var denyCommit = false; var armed = false
        NativeInputStore(context, "input-test-${UUID.randomUUID()}", boundary = { stage ->
            if (armed && stage == "object.published") denyCommit = true
            if (denyCommit && stage == "transaction.beforeCommit") throw android.database.sqlite.SQLiteFullException("synthetic dedicated storage boundary")
        }).use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val selected = store.selectSource("chat", 0, "select", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val id = selected.getJSONArray("selections").getJSONObject(0).getString("id")
            armed = true
            expectCode("INPUT_STORAGE_FAILED") { store.prepare("chat", id, "failed-prepare") }
            armed = false; denyCommit = false
            assertEquals("failed", store.read("chat").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            val retry = store.prepare("chat", id, "retry-prepare")
            assertEquals("ready", retry.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            val frozen = store.freeze("chat", 1, "freeze")
            assertArrayEquals("recover complete source".toByteArray(), store.readObjectBytes(frozen.getString("token"), frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")))
        }
    }

    @Test fun realCrossUidGrantRevocationRetainsOnlyPreviouslyFixedContent() {
        val info = ExternalInputFixture.control(context, "reset")
        assertNotEquals(android.os.Process.myUid(), info.getInt("providerUid"))
        ExternalInputFixture.control(context, "revoke")
        fun assertDenied() {
            try { context.contentResolver.openInputStream(ExternalInputFixture.TEXT_URI)?.close(); fail("Original must require an actual OS grant") }
            catch (_: SecurityException) { }
            assertFalse(context.contentResolver.persistedUriPermissions.any { it.uri == ExternalInputFixture.TEXT_URI && it.isReadPermission })
        }
        assertDenied()
        val namespace = "input-test-${UUID.randomUUID()}"; lateinit var frozen: JSONObject
        try {
            val granted=ExternalInputFixture.control(context, "grant")
            val permission=context.checkUriPermission(ExternalInputFixture.TEXT_URI, android.os.Process.myPid(), android.os.Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION)
            InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply {putString("inputGrantEvidence",JSONObject().put("grant",granted)
                .put("processUid",android.os.Process.myUid()).put("contextUid",context.applicationInfo.uid).put("appContextUid",context.applicationContext.applicationInfo.uid)
                .put("package",context.packageName).put("permission",permission).toString())})
            assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED, permission)
            assertArrayEquals(ExternalInputFixture.TEXT_BYTES, context.contentResolver.openInputStream(ExternalInputFixture.TEXT_URI)!!.use { it.readBytes() })
            NativeInputStore(context, namespace).use { store ->
                store.rememberConversation(conversation("chat"), capability())
                val selected = store.selectSource("chat", 0, "external-select", ExternalInputFixture.TEXT_URI, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                store.prepare("chat", selected.getJSONArray("selections").getJSONObject(0).getString("id"), "external-prepare")
                frozen = store.freeze("chat", 1, "external-freeze")
            }
            ExternalInputFixture.control(context, "revoke")
            assertDenied()
            NativeInputStore(context, namespace).use { store ->
                val selection = store.read("chat").getJSONArray("selections").getJSONObject(0)
                assertEquals("unavailable", selection.getJSONObject("source").getString("access"))
                assertEquals("ready", selection.getJSONObject("preparation").getString("state"))
                val rep = frozen.getJSONArray("representations").getJSONObject(0)
                assertEquals("ee9a2cd7b411f465b1251a067595cd7fceab25c5b4a78ea5f8394b9935638ff3", rep.getString("sha256"))
                assertArrayEquals(ExternalInputFixture.TEXT_BYTES, store.readObjectBytes(frozen.getString("token"), rep.getString("objectId")))
                store.clear("chat", 1, "clear"); store.gc()
                assertArrayEquals(ExternalInputFixture.TEXT_BYTES, store.readObjectBytes(frozen.getString("token"), rep.getString("objectId")))
            }
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("inputEvidence", JSONObject().put("externalUidDistinct", true).put("initialDenied", true).put("revokedDenied", true).put("fixedSha256", "ee9a2cd7b411f465b1251a067595cd7fceab25c5b4a78ea5f8394b9935638ff3").toString()) })
        } finally { ExternalInputFixture.control(context, "revoke"); ExternalInputFixture.control(context, "reset") }
    }

    @Test fun realSqliteQuotaFailureNeverAcknowledgesOrErasesTheLastCommittedDraft() {
        val namespace = "input-test-${UUID.randomUUID()}"
        NativeInputStore(context, namespace).use { store -> store.rememberConversation(conversation("chat"), capability()); store.save("chat", 0, "safe", "last durable text", emptyList()) }
        NativeInputStore(context, namespace, maximumDatabaseBytes = 128 * 1024L).use { limited ->
            val configuration=limited.storageConfiguration()
            InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply {putString("inputQuotaEvidence",configuration.toString())})
            assertTrue(configuration.getJSONObject("writer").getLong("maxPages") * configuration.getLong("pageSize") < 600_000)
            expectCode("INPUT_STORAGE_FAILED") { limited.save("chat", 1, "too-large", "界".repeat(100_000), emptyList()) }
        }
        NativeInputStore(context, namespace).use { reopened ->
            assertEquals("last durable text", reopened.read("chat").getString("text")); assertEquals(1L, reopened.read("chat").getLong("revision"))
            assertEquals(2L, reopened.save("chat", 1, "after-capacity-restored", "small safe replacement", emptyList()).getLong("revision"))
        }
    }

    @Test fun jpegExifOrientationIsAppliedToTheWholeImageAndTruncatedDataIsRejected() {
        val bitmap = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.RED)
        canvas.drawRect(40f, 0f, 80f, 40f, android.graphics.Paint().apply { color = android.graphics.Color.BLUE })
        val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 100, output); bitmap.recycle()
        val jpeg = output.toByteArray()
        // Independently constructed EXIF TIFF Orientation=6 (rotate 90 degrees clockwise).
        val exif = byteArrayOf(0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0)
        val oriented = jpeg.copyOfRange(0,2) + byteArrayOf(0xff.toByte(),0xe1.toByte(),0, (exif.size+2).toByte()) + exif + jpeg.copyOfRange(2,jpeg.size)
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"), capability())
            val selected = store.selectSource("chat", 0, "select", source(oriented, "image/jpeg"), Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val prepared = store.prepare("chat", selected.getJSONArray("selections").getJSONObject(0).getString("id"), "prepare")
            val rep = prepared.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getJSONObject("representation")
            assertEquals(40, rep.getInt("width")); assertEquals(80, rep.getInt("height"))
            val frozen = store.freeze("chat", 1, "freeze"); val bytes = store.readObjectBytes(frozen.getString("token"), rep.getString("objectId"))
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            try { assertTrue(android.graphics.Color.red(decoded.getPixel(20,10)) > 220); assertTrue(android.graphics.Color.blue(decoded.getPixel(20,70)) > 220) } finally { decoded.recycle() }
            store.clear("chat", 1, "clear")
            val bad = store.selectSource("chat", 2, "bad-select", source(oriented.copyOf(oriented.size-5), "image/jpeg"), Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val failed = store.prepare("chat", bad.getJSONArray("selections").getJSONObject(0).getString("id"), "bad-prepare")
            assertEquals("unsupported", failed.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            assertArrayEquals(bytes, store.readObjectBytes(frozen.getString("token"), rep.getString("objectId")))
        }
    }

    @Test fun capabilitiesGatePreparationAndNewVersionsNeverMutatePinnedRepresentations() {
        val bitmap = Bitmap.createBitmap(32, 16, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
        val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle()
        NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
            store.rememberConversation(conversation("chat"))
            val selected = store.selectSource("chat", 0, "select", source(output.toByteArray(), "image/png"), Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val id = selected.getJSONArray("selections").getJSONObject(0).getString("id")
            expectCode("INPUT_CAPABILITY_UNAVAILABLE") { store.prepare("chat", id, "no-capability") }
            store.rememberConversation(conversation("chat"), capability().put("input", org.json.JSONArray(listOf("text"))))
            assertEquals("unsupported", store.prepare("chat", id, "text-only").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
            store.rememberConversation(conversation("chat"), capability())
            store.prepare("chat", id, "image-one")
            val first = store.freeze("chat", 1, "freeze-one"); val rep = first.getJSONArray("representations").getJSONObject(0)
            val bytes = store.readObjectBytes(first.getString("token"), rep.getString("objectId"))
            store.rememberConversation(conversation("chat"), capability().put("version", "validation-2").put("limits", JSONObject().put("maxWidth", 8)))
            expectCode("INPUT_CAPABILITY_CHANGED") { store.freeze("chat", 1, "stale-version") }
            val changed = store.prepare("chat", id, "image-two").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getJSONObject("representation")
            assertEquals(8, changed.getInt("width")); assertNotEquals(rep.getString("objectId"), changed.getString("objectId"))
            store.clear("chat", 1, "clear"); store.gc()
            assertArrayEquals(bytes, store.readObjectBytes(first.getString("token"), rep.getString("objectId")))
        }
    }

    @Test fun oversizedPngDimensionsAndMimeMismatchFailWithoutPartialPreparation() {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        val output = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle()
        val png = output.toByteArray(); val oversized = png.clone()
        java.nio.ByteBuffer.wrap(oversized,16,8).putInt(6000).putInt(6000)
        val crc = java.util.zip.CRC32().apply { update(oversized,12,17) }.value
        java.nio.ByteBuffer.wrap(oversized,29,4).putInt(crc.toInt())
        for ((bytes,mime,expected) in listOf(Triple(oversized,"image/png","budget-exceeded"),Triple(png,"image/jpeg","unsupported"))) {
            NativeInputStore(context, "input-test-${UUID.randomUUID()}").use { store ->
                store.rememberConversation(conversation("chat"),capability())
                val selected=store.selectSource("chat",0,"select",source(bytes,mime),Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val failed=store.prepare("chat",selected.getJSONArray("selections").getJSONObject(0).getString("id"),"prepare")
                assertEquals(expected,failed.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
                expectCode("INPUT_NOT_READY") {store.freeze("chat",1,"freeze")}
            }
        }
    }

    @Test fun inputFilesAreCeNoBackupAndBothBackupModesExcludeEveryPrivateDomain() {
        val namespace="input-test-${UUID.randomUUID()}"
        NativeInputStore(context,namespace).use { store -> store.rememberConversation(conversation("chat"));store.save("chat",0,"save","private synthetic draft",emptyList()) }
        assertFalse(context.isDeviceProtectedStorage)
        assertTrue(java.io.File(context.noBackupFilesDir,"$namespace/input.sqlite").isFile)
        assertFalse(context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP != 0)
        val xml=context.resources.getXml(R.xml.data_extraction_rules)
        val domains=setOf("root","file","database","sharedpref","external","device_root","device_file","device_database","device_sharedpref")
        val observed=mutableMapOf("cloud-backup" to mutableSetOf<String>(),"device-transfer" to mutableSetOf<String>())
        var mode:String?=null
        xml.use { while(it.eventType!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
            if(it.eventType==org.xmlpull.v1.XmlPullParser.START_TAG) {
                if(it.name in observed.keys) mode=it.name
                else if(it.name=="exclude") {assertEquals(".",it.getAttributeValue(null,"path"));observed[mode]?.add(it.getAttributeValue(null,"domain"))}
            } else if(it.eventType==org.xmlpull.v1.XmlPullParser.END_TAG && it.name==mode) mode=null
            it.next()
        } }
        assertEquals(domains,observed["cloud-backup"]);assertEquals(domains,observed["device-transfer"])
        // Package policy and actual private layout only: OEM backup/export transport remains T16 evidence.
    }
}
