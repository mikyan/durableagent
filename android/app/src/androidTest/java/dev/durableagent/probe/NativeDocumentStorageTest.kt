package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Fixed published app-native schema fixtures; assertions enter through the public store. */
@RunWith(AndroidJUnit4::class)
class NativeDocumentStorageTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    @Test fun legacyRegistryUpgradesAndUnavailableOrFutureStoragePreservesEvidence(){
        val namespace="document-storage-"+UUID.randomUUID();val directory=File(context.noBackupFilesDir,namespace);assertTrue(directory.mkdirs())
        val path=File(directory,"documents.sqlite")
        val uri="content://dev.durableagent.documentsfixture.documents/document/original"
        val id=NativeInputStore.sha256(uri.toByteArray())
        val original=JSONObject().put("protocol",1).put("resourceId",id).put("namespace","saf:$id").put("source","saf").put("original",true).put("uri",uri).put("displayName","original.bin").put("mimeType","application/octet-stream")
        // Literal v1 schema from e389841, before operation receipts existed.
        SQLiteDatabase.openOrCreateDatabase(path,null).use{db->db.execSQL("CREATE TABLE resources(id TEXT PRIMARY KEY,record TEXT NOT NULL)");db.execSQL("INSERT INTO resources(id,record) VALUES(?,?)",arrayOf(id,original.toString()));db.version=1}
        fun retained(){NativeDocumentStore(context,namespace).use{store->val rows=store.list().getJSONArray("resources");assertEquals(1,rows.length());val resource=rows.getJSONObject(0);assertEquals(id,resource.getString("resourceId"));assertEquals(uri,resource.getString("uri"));assertTrue(resource.getBoolean("original"))}}
        retained()
        // Change only this fixed synthetic fixture's compatibility marker after all stores close.
        SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use{db->assertEquals(2,db.version);db.version=99}
        val before=NativeInputStore.sha256(path.readBytes())
        NativeDocumentStore(context,namespace).use{store->try{store.list();fail("Future native format must fail closed")}catch(error:NativeDocumentException){assertEquals("DOCUMENT_STORAGE_INCOMPATIBLE",error.code)}}
        assertEquals("Incompatible open must preserve the original database bytes",before,NativeInputStore.sha256(path.readBytes()))
        SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use{db->assertEquals(99,db.version);db.version=2}
        retained()
        val blockedNamespace="document-blocked-"+UUID.randomUUID();val blocked=File(context.noBackupFilesDir,blockedNamespace)
        val marker="existing synthetic evidence, not a directory".toByteArray();blocked.writeBytes(marker)
        NativeDocumentStore(context,blockedNamespace).use{store->try{store.list();fail("Unavailable native storage must report a bounded storage error")}catch(error:NativeDocumentException){assertEquals("DOCUMENT_STORAGE_FAILED",error.code)}}
        assertArrayEquals(marker,blocked.readBytes())
        instrument.sendStatus(0,Bundle().apply{putString("documentEvidence",JSONObject().put("stage","native-document-v1-upgrade-future-and-unavailable-preserved").put("resourceId",id).put("futureDatabaseDigest",before).toString())})
    }
}
