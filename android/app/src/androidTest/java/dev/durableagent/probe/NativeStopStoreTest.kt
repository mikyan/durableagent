package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Native public control/effect facts on actual SQLite; no JS owner is required. */
@RunWith(AndroidJUnit4::class)
class NativeStopStoreTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private fun seed(store:NativeInputStore,id:String){store.rememberConversation(JSONObject().put("id",id).put("title",id).put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic stop" )).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),null)}
    private fun effect(id:String,product:String="chat")=JSONObject().put("operationId",id).put("kind","command").put("source","termux").put("productId",product).put("controlGeneration",1).put("sdkConversationId",101).put("namespace","termux:synthetic").put("requestDigest","a".repeat(64))
    private fun expectCode(code:String,action:()->Unit){try{action();fail("Expected $code")}catch(error:NativeInputException){assertEquals(code,error.code)}}
    @Test fun stopAndEffectAdmissionShareOneDurableFenceAndPreserveUnrelatedWork(){
        val namespace="stop-${UUID.randomUUID()}"
        NativeInputStore(context,namespace).use{store->
            seed(store,"chat");seed(store,"other")
            assertEquals("registered",store.registerEffect(effect("original")).getString("state"))
            store.registerEffect(effect("unrelated","other"))
            val control=store.requestStop(JSONObject().put("id","chat").put("actionId","stop-one").put("expectedControlVersion",0))
            assertEquals(1L,control.getLong("stoppedThrough"))
            expectCode("EXECUTION_STOPPED"){store.registerEffect(effect("late"))}
            expectCode("EXECUTION_STOPPED"){store.requireEffect("original")}
            assertEquals("unrelated",store.requireEffect("unrelated").getString("operationId"))
        }
        NativeInputStore(context,namespace).use{store->
            val pending=store.stoppedEffects();assertEquals(1,pending.length());assertEquals("original",pending.getJSONObject(0).getString("operationId"))
            assertEquals("waiting",store.stopStatus("chat").getString("phase"))
            assertEquals(1L,store.readControl("chat").getLong("stoppedThrough"))
            expectCode("EXECUTION_STOPPED"){store.requireEffect("original")}
        }
    }
    @Test fun unknownEffectsSurviveSdkAbortAndOnlyMatchingConfirmedEvidenceCompletesStop(){
        val namespace="stop-${UUID.randomUUID()}"
        NativeInputStore(context,namespace).use{store->
            seed(store,"chat");store.registerEffect(effect("original"))
            val control=store.requestStop(JSONObject().put("id","chat").put("actionId","stop-one").put("expectedControlVersion",0))
            store.confirmAbort("chat",control.getJSONObject("pendingAbort"))
            val proof=JSONObject().put("operationId","original").put("requestDigest","b".repeat(64)).put("namespace","termux:synthetic").put("state","stopped").put("scopeConfirmed",true).put("sequence",5)
            expectCode("EXECUTION_IDENTITY_CONFLICT"){store.recordEffectEvidence("original",proof)}
            proof.put("requestDigest","a".repeat(64)).put("state","unknown").put("scopeConfirmed",false).put("sequence",1)
            store.recordEffectEvidence("original",proof);assertEquals("external-unconfirmed",store.stopStatus("chat").getString("phase"))
            proof.put("state","stopped").put("scopeConfirmed",true).put("sequence",2);store.recordEffectEvidence("original",proof)
            assertEquals("stopped",store.stopStatus("chat").getString("phase"))
            proof.put("state","running").put("scopeConfirmed",false).put("sequence",1);store.recordEffectEvidence("original",proof)
            assertEquals("stopped",store.stopStatus("chat").getString("phase"));assertEquals(1L,store.readControl("chat").getLong("stoppedThrough"))
        }
    }
    @Test fun nativeSweepReachesLaterPagesAfterUnknownAndNeverTouchesAnotherProduct(){
        NativeInputStore(context,"stop-${UUID.randomUUID()}").use{store->
            seed(store,"chat");seed(store,"other");for(i in 0..64)store.registerEffect(effect("effect-${i.toString().padStart(3,'0')}"));store.registerEffect(effect("unrelated","other"))
            val control=store.requestStop(JSONObject().put("id","chat").put("actionId","stop-one").put("expectedControlVersion",0));store.confirmAbort("chat",control.getJSONObject("pendingAbort"))
            val called=mutableListOf<String>();NativeStopSweep(store){row->
                val id=row.getString("operationId");called.add(id)
                JSONObject().put("operationId",id).put("namespace",row.getString("namespace")).put("requestDigest",row.getString("requestDigest")).put("sequence",1)
                    .put("state",if(id=="effect-000")"unknown" else "stopped").put("scopeConfirmed",id!="effect-000")
            }.run()
            assertEquals(65,called.size);assertEquals("effect-064",called.last());assertFalse(called.contains("unrelated"))
            assertEquals(1,store.stopStatus("chat").getInt("externalUnknown"));assertEquals(1,store.stopStatus("chat").getInt("externalPending"))
            assertEquals("unrelated",store.requireEffect("unrelated").getString("operationId"))
        }
    }
    @Test fun upgradedStoppedConversationCannotClaimExternalCompletionBeforeSdkIntentInventory(){
        val namespace="stop-${UUID.randomUUID()}";var barrier=JSONObject()
        NativeInputStore(context,namespace).use{store->seed(store,"chat");barrier=store.requestStop(JSONObject().put("id","chat").put("actionId","old-stop").put("expectedControlVersion",0)).getJSONObject("pendingAbort");store.confirmAbort("chat",barrier)}
        // An exact pre-effect-catalogue v4 fixture, in this test's dedicated database only.
        val path=java.io.File(java.io.File(context.noBackupFilesDir,namespace),"input.sqlite")
        android.database.sqlite.SQLiteDatabase.openDatabase(path.absolutePath,null,android.database.sqlite.SQLiteDatabase.OPEN_READWRITE).use{db->db.beginTransaction();try{db.execSQL("DROP TABLE native_effects");db.execSQL("DROP TABLE native_effect_catalogue");db.execSQL("DROP TABLE frozen_holds");db.execSQL("DROP TABLE content_holds");db.execSQL("DROP TABLE content_quarantine");db.version=4;db.setTransactionSuccessful()}finally{db.endTransaction()}}
        NativeInputStore(context,namespace).use{store->assertEquals(1L,store.readControl("chat").getLong("stoppedThrough"));assertFalse(store.readControl("chat").has("pendingAbort"));assertEquals("external-unconfirmed",store.stopStatus("chat").getString("phase"));expectCode("EXECUTION_STOPPED"){store.registerEffect(effect("late"))}}
    }
    @Test fun publishedV6UpgradeRetainsTextOnlyHoldsAndStopWhileAddingUnverifiedEffectCatalogue(){
        val namespace="stop-${UUID.randomUUID()}";lateinit var fixed:JSONObject;lateinit var control:JSONObject
        NativeInputStore(context,namespace).use{store->seed(store,"chat");store.save("chat",0,"save","retained input 世界",emptyList());fixed=store.freeze("chat",1,"freeze");store.retainFrozen("sdk-existing-history",fixed.getString("token"));control=store.requestStop(JSONObject().put("id","chat").put("actionId","stop").put("expectedControlVersion",0));store.confirmAbort("chat",control.getJSONObject("pendingAbort"))}
        val path=java.io.File(java.io.File(context.noBackupFilesDir,namespace),"input.sqlite")
        android.database.sqlite.SQLiteDatabase.openDatabase(path.absolutePath,null,android.database.sqlite.SQLiteDatabase.OPEN_READWRITE).use{db->db.beginTransaction();try{db.execSQL("DROP TABLE native_effects");db.execSQL("DROP TABLE native_effect_catalogue");db.version=6;db.setTransactionSuccessful()}finally{db.endTransaction()}}
        NativeInputStore(context,namespace,boundary={if(it=="migration.prepared")throw IllegalStateException("Synthetic migration failure")}).use{store->expectCode("INPUT_MIGRATION_FAILED"){store.stopStatus("chat")}}
        android.database.sqlite.SQLiteDatabase.openDatabase(path.absolutePath,null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use{assertEquals(6,it.version)}
        NativeInputStore(context,namespace).use{store->
            assertEquals("external-unconfirmed",store.stopStatus("chat").getString("phase"));assertEquals(1L,store.readControl("chat").getLong("stoppedThrough"));assertEquals(fixed.toString(),store.readFrozen(fixed.getString("token")).toString())
            expectCode("INPUT_IN_USE"){store.discard(fixed.getString("token"),"discard-held")};store.gc();assertEquals("retained input 世界",store.readFrozen(fixed.getString("token")).getString("text"))
        }
        android.database.sqlite.SQLiteDatabase.openDatabase(path.absolutePath,null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use{assertEquals(7,it.version)}
    }
    @Test fun trustedHostWaitsOnlyBeforeEnteringNativeActionAndNeverReplaysLostCommitResponse(){
        val namespace="stop-${UUID.randomUUID()}"
        NativeInputStore(context,namespace).use{seed(it,"chat");it.save("chat",0,"writer","committed by native writer",emptyList())}
        // Hold the real domain lease without the process-local store monitor. A store action
        // in this same process would serialize on that monitor before reaching the OS lease.
        val lease=StorageDomainLease.acquire(java.io.File(context.noBackupFilesDir,namespace))!!
        val pool=java.util.concurrent.Executors.newSingleThreadExecutor()
        try{
            NativeInputStore(context,namespace).use{ui->expectCode("INPUT_STORAGE_BUSY"){ui.readControl("chat")}}
            val read=pool.submit<JSONObject>{NativeInputStore(context,namespace).withLeaseWait(1000).use{it.inspect("chat")}}
            Thread.sleep(100);assertFalse(read.isDone);lease.close()
            assertEquals("committed by native writer",read.get(2,java.util.concurrent.TimeUnit.SECONDS).getString("text"))
            var commits=0
            NativeInputStore(context,namespace,boundary={stage->if(stage=="transaction.afterCommit"){commits++;throw IllegalStateException("Synthetic lost response")}}).withLeaseWait(1000).use{store->
                expectCode("INPUT_STORAGE_FAILED"){store.save("chat",1,"lost-response","second committed text",emptyList())}
            }
            assertEquals(1,commits)
            NativeInputStore(context,namespace).use{store->assertEquals(2L,store.inspect("chat").getLong("revision"));assertEquals("second committed text",store.inspect("chat").getString("text"))}
        }finally{lease.close();pool.shutdownNow()}
    }
}
