package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeRetentionMigrationTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun interruptedNativeUpgradePreservesStableSendFrozenInputAndStopBeforeRetry() {
        val namespace="retention-upgrade-${UUID.randomUUID()}";lateinit var frozen:JSONObject;lateinit var intent:JSONObject;lateinit var stopped:JSONObject
        val association=JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","validation-workspace"))
        NativeInputStore(context,namespace).use { store ->
            store.rememberConversation(JSONObject().put("id","retained-chat").put("title","Existing upgrade record").put("submissionContext",association).put("model",JSONObject().put("provider","validation").put("modelId","text").put("name","Validation")),
                JSONObject().put("version","validation-1").put("provider","validation").put("modelId","text").put("source","validation").put("input",JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))
            store.save("retained-chat",0,"old-save","old unique input",emptyList());frozen=store.freeze("retained-chat",1,"old-freeze")
            intent=store.createSend(JSONObject().put("id","retained-chat").put("actionId","stable-old-send").put("inputToken",frozen.getString("token")).put("expectedContext",association).put("expectedControlVersion",0).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            stopped=store.requestStop(JSONObject().put("id","retained-chat").put("actionId","stable-old-stop").put("expectedControlVersion",0))
        }
        // Fixed native v4 layout from 27a580c: these are app-owned native tables, never SDK tables.
        // Current public writes seed unchanged v4 record shapes; only the later empty schema is removed.
        val path=File(File(context.noBackupFilesDir,namespace),"input.sqlite")
        SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use { db ->
            db.beginTransaction();try{db.execSQL("DROP TABLE frozen_holds");db.execSQL("DROP TABLE content_holds");db.execSQL("DROP TABLE content_quarantine");db.execSQL("DROP TABLE native_effects");db.execSQL("DROP TABLE native_effect_catalogue");db.execSQL("PRAGMA user_version=4");db.setTransactionSuccessful()}finally{db.endTransaction()}
        }
        NativeInputStore(context,namespace,boundary={if(it=="migration.prepared")throw IllegalStateException("synthetic interrupted migration")}).use { store ->
            try{store.inspect("retained-chat");fail("Migration must not succeed after injected interruption")}catch(error:NativeInputException){assertEquals("INPUT_MIGRATION_FAILED",error.code)}
        }
        SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{assertEquals(4,it.version)}
        NativeInputStore(context,namespace).use { store ->
            assertEquals("old unique input",store.inspect("retained-chat").getString("text"));assertEquals(frozen.toString(),store.readFrozen(frozen.getString("token")).toString())
            val retained=store.readSend(intent.getString("intentId"));assertEquals(intent.getString("inputDigest"),retained.getString("inputDigest"));assertTrue(retained.getBoolean("cancelled"))
            val control=store.readControl("retained-chat");assertEquals(stopped.getLong("stoppedThrough"),control.getLong("stoppedThrough"));assertEquals(stopped.getJSONObject("pendingAbort").toString(),control.getJSONObject("pendingAbort").toString())
            assertEquals(0,store.gc().getInt("reclaimed"))
        }
    }
}
