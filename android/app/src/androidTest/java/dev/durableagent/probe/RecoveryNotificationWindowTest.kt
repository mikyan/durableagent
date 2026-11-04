package dev.durableagent.probe

import android.app.NotificationManager
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Actual NotificationManager and SQLite. A dedicated trigger cuts only the native ACK write. */
@RunWith(AndroidJUnit4::class)
class RecoveryNotificationWindowTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val manager=context.getSystemService(NotificationManager::class.java)
    private fun until(condition:()->Boolean){val end=android.os.SystemClock.elapsedRealtime()+5000;while(!condition()){assertTrue("Android notification observation did not settle",android.os.SystemClock.elapsedRealtime()<end);Thread.sleep(10)}}
    @Test fun aClaimLostBeforeSystemPostNeverBecomesASecondAutomaticDeliveryAttempt(){
        val run=UUID.randomUUID().toString();val namespace=NativeInputBridge.namespace("fixture",run);val identity="answer:101:1"
        NativeRecoveryStore(context,namespace).use{store->store.pendingCompletion(identity,"window-chat");assertTrue(store.claimNotification(identity))}
        NativeRecoveryStore(context,namespace).use{store->assertFalse(store.claimNotification(identity));assertEquals("attempted",store.pendingCompletion(identity,"window-chat").getString("state"))}
        assertTrue(manager.activeNotifications.none{it.tag=="$namespace:$identity"})
        instrumentation.sendStatus(0,Bundle().apply{putString("notificationWindow","claim-before-post: retained unconfirmed, no automatic post")})
    }
    @Test fun aPostWhoseDurableAckFailsDoesNotUpdateTheExistingNotificationOnReopen(){ackFailure(false)}
    @Test fun aPostDismissedBeforeDurableAckRecoveryDoesNotReappear(){ackFailure(true)}
    private fun ackFailure(dismiss:Boolean){
        assertEquals("Fixture requires actual notification permission/channel", "visible",NativeRecoveryNotifications.visibility(context))
        val run=UUID.randomUUID().toString();val namespace=NativeInputBridge.namespace("fixture",run);val identity="answer:101:1";val tag="$namespace:$identity"
        val projection=JSONObject().put("conversations",JSONArray()).put("completions",JSONArray().put(JSONObject().put("identity",identity).put("conversationId","window-chat")))
        val path=File(context.noBackupFilesDir,"recovery-$namespace/recovery.sqlite")
        NativeRecoveryStore(context,namespace).use{it.pendingCompletion(identity,"window-chat")}
        SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use{it.execSQL("CREATE TRIGGER deny_completion_ack BEFORE UPDATE ON completions WHEN NEW.published=1 BEGIN SELECT RAISE(FAIL,'Synthetic native acknowledgement lost'); END")}
        try{
            NativeRecoveryStore(context,namespace).use{store->try{NativeRecoveryNotifications.completions(context,"fixture",run,store,projection);fail("Fixture must lose native notification ACK")}catch(_:SQLiteException){}}
            until{manager.activeNotifications.any{it.id==18013&&it.tag==tag}}
            val before=manager.activeNotifications.single{it.id==18013&&it.tag==tag}
            SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use{it.execSQL("DROP TRIGGER deny_completion_ack")}
            if(dismiss){manager.cancel(tag,18013);until{manager.activeNotifications.none{it.id==18013&&it.tag==tag}}}
            Thread.sleep(30)
            NativeRecoveryStore(context,namespace).use{NativeRecoveryNotifications.completions(context,"fixture",run,it,projection)}
            val after=manager.activeNotifications.firstOrNull{it.id==18013&&it.tag==tag}
            if(dismiss)assertNull("A dismissed unconfirmed delivery must not reappear",after)
            else{assertNotNull(after);assertEquals(before.postTime,after!!.postTime);assertEquals(before.notification.`when`,after.notification.`when`)}
            instrumentation.sendStatus(0,Bundle().apply{putString("notificationWindow",JSONObject().put("dismissed",dismiss).put("tag",tag).put("firstPost",before.postTime).put("afterPost",after?.postTime?:JSONObject.NULL).toString())})
        }finally{manager.cancel(tag,18013)}
    }
}
