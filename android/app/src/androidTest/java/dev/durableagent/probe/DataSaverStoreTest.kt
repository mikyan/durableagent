package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Actual private SQLite and public native policy seam; platform facts are the injected boundary. */
@RunWith(AndroidJUnit4::class)
class DataSaverStoreTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val unknown=DataSaverNetwork(null,false,true)
    private val free=DataSaverNetwork("network-fixture-a",true,false)
    private val metered=DataSaverNetwork("network-fixture-a",true,true)
    private fun expectCode(code:String,action:()->Unit){try{action();fail("Expected $code")}catch(error:NativeInputException){assertEquals(code,error.code)}}
    private fun request(id:String)=JSONObject().put("executionId",id).put("command",JSONObject().put("kind","shell").put("script","printf 'synthetic-local-looking-text'"))
        .put("cwd","/synthetic/workspace").put("env",JSONObject()).put("inheritEnv",true).put("timeoutMs",1000)
        .put("context",JSONObject().put("productId","conversation").put("sdkConversationId",101).put("taskId",201).put("callId","call").put("bindingId","binding").put("locationVersion",1).put("controlGeneration",1).put("namespace","termux:synthetic"))
    @Test fun newestWaitingOperationsAreVisibleAndOlderPagesKeepTheirStableBoundary(){
        NativeDataSaverStore(context,"data-saver-${UUID.randomUUID()}").use{store->
            store.configure(true,0,metered)
            for(index in 0 until 25)store.register(request("ordered-"+index.toString().padStart(3,'0')),metered)
            val first=store.operations("conversation",null,metered);val rows=first.getJSONArray("operations")
            assertEquals(20,rows.length());assertEquals("ordered-024",rows.getJSONObject(0).getString("executionId"))
            store.register(request("ordered-025"),metered)
            val next=store.operations("conversation",first.getString("nextCursor"),metered).getJSONArray("operations")
            assertEquals(5,next.length());assertEquals("ordered-004",next.getJSONObject(0).getString("executionId"));assertEquals("ordered-000",next.getJSONObject(4).getString("executionId"))
        }
    }
    @Test fun settingSurvivesReopenButCurrentNetworkFactsReplaceThePreviousWifiFact(){
        val namespace="data-saver-${UUID.randomUUID()}"
        NativeDataSaverStore(context,namespace).use{store->
            assertFalse(store.query(free).getBoolean("enabled"))
            val configured=store.configure(true,0,free)
            assertTrue(configured.getBoolean("enabled"));assertFalse(configured.getBoolean("restricted"));assertEquals(1L,configured.getLong("version"))
            expectCode("DATA_SAVER_CONFLICT"){store.configure(false,0,free)}
        }
        NativeDataSaverStore(context,namespace).use{store->
            val lost=store.query(unknown)
            assertTrue(lost.getBoolean("enabled"));assertTrue(lost.getBoolean("restricted"));assertEquals("network-unknown",lost.getString("reason"))
            val actual=store.query(metered);assertEquals("metered",actual.getString("reason"))
            val restored=store.query(free);assertFalse(restored.getBoolean("restricted"));assertTrue(restored.getBoolean("enabled"))
            val disabled=store.configure(false,1,metered);assertFalse(disabled.getBoolean("restricted"));assertEquals(2L,disabled.getLong("version"))
        }
    }
    @Test fun temporaryGrantCoversOnlyTheFixedExecutionAndCurrentRestrictedPeriodAcrossReopen(){
        val namespace="data-saver-${UUID.randomUUID()}";var digest="";var period=0L
        NativeDataSaverStore(context,namespace).use{store->
            store.configure(true,0,metered)
            val first=store.register(request("operation-a"),metered);assertEquals("waiting",first.getString("phase"));assertEquals("unknown",first.getString("classification"))
            digest=first.getString("requestDigest");period=first.getLong("period")
            store.prepared("operation-a",digest,"a".repeat(64),metered)
            store.register(request("operation-b"),metered)
            assertEquals("granted",store.grant("operation-a",digest,period,metered).getString("phase"))
            assertEquals("waiting",store.decision("operation-b",metered).getString("phase"))
            assertTrue(store.query(metered).getBoolean("enabled"))
        }
        NativeDataSaverStore(context,namespace).use{store->
            assertEquals("granted",store.decision("operation-a",metered).getString("phase"))
            assertEquals(period,store.query(metered).getLong("period"))
            val changed=request("operation-a");changed.getJSONObject("env").put("BASH_ENV","/modified/script")
            expectCode("DATA_SAVER_IDENTITY_CONFLICT"){store.register(changed,metered)}
            store.query(free);assertEquals("waiting",store.decision("operation-a",metered).getString("phase"))
            expectCode("DATA_SAVER_GRANT_EXPIRED"){store.grant("operation-a",digest,period,metered)}
            assertEquals("waiting",store.decision("operation-b",metered).getString("phase"))
        }
    }
    @Test fun grantRequiresTheActuallyPreparedEnvironmentAndRejectsChangedFinalBytes(){
        NativeDataSaverStore(context,"data-saver-${UUID.randomUUID()}").use{store->
            store.configure(true,0,metered)
            val original=store.register(request("prepared-operation"),metered)
            val digest=original.getString("requestDigest");val period=original.getLong("period")
            expectCode("DATA_SAVER_PREPARATION_REQUIRED"){store.grant("prepared-operation",digest,period,metered)}
            val prepared=store.prepared("prepared-operation",digest,"a".repeat(64),metered)
            assertEquals("waiting",prepared.getString("phase"));assertEquals("a".repeat(64),prepared.getString("finalDigest"))
            assertEquals("granted",store.grant("prepared-operation",digest,period,metered).getString("phase"))
            expectCode("DATA_SAVER_IDENTITY_CONFLICT"){store.prepared("prepared-operation",digest,"b".repeat(64),metered)}
            val current=store.decision("prepared-operation",metered)
            assertEquals("a".repeat(64),current.getString("finalDigest"));assertEquals("granted",current.getString("phase"))
        }
    }
    @Test fun lossOfInitializedPolicyDirectoryCannotSilentlyDisableSaver(){
        val namespace="data-saver-${UUID.randomUUID()}"
        NativeDataSaverStore(context,namespace).use{it.configure(true,0,metered)}
        // Dedicated external storage-loss fixture. Preserve the original directory, never clear it.
        val root=File(context.noBackupFilesDir,namespace);val directory=File(root,"data-saver");val preserved=File(root,"preserved-policy")
        assertTrue(directory.renameTo(preserved))
        NativeDataSaverStore(context,namespace).use{store->expectCode("DATA_SAVER_STORAGE_LOST"){store.query(free)}}
        assertTrue(File(preserved,"policy.sqlite").exists())
    }
    @Test fun restrictedTransitionStopsOnlyDispatchedOperationsAndCannotReviveThemWhenNetworkReturns(){
        NativeDataSaverStore(context,"data-saver-${UUID.randomUUID()}").use{store->
            store.configure(true,0,free)
            val original=store.register(request("started"),free);val digest=original.getString("requestDigest")
            store.prepared("started",digest,"a".repeat(64),free)
            val waiting=store.register(request("not-dispatched"),free);store.prepared("not-dispatched",waiting.getString("requestDigest"),"b".repeat(64),free)
            assertTrue(store.requireStart("started","a".repeat(64),free).getBoolean("dispatched"))
            val affected=store.claimAffected(metered).getJSONArray("operations")
            assertEquals(1,affected.length());assertEquals("started",affected.getJSONObject(0).getString("executionId"))
            assertEquals("waiting",store.decision("not-dispatched",metered).getString("phase"))
            val interrupted=store.decision("started",free);assertEquals("result-unverified",interrupted.getString("phase"))
            expectCode("DATA_SAVER_INTERRUPTED"){store.requireStart("started","a".repeat(64),free)}
            assertEquals("allowed",store.decision("not-dispatched",free).getString("phase"))
            val receipt=JSONObject().put("executionId","started").put("namespace","termux:synthetic").put("requestDigest",digest).put("finalDigest","c".repeat(64)).put("state","stopped").put("scopeConfirmed",true).put("sequence",3)
            expectCode("DATA_SAVER_IDENTITY_CONFLICT"){store.observe(receipt,free)}
            receipt.put("finalDigest","a".repeat(64)).put("scopeConfirmed",false)
            assertEquals("result-unverified",store.observe(receipt,free).getString("phase"))
            receipt.put("scopeConfirmed",true).put("sequence",4)
            assertEquals("terminal",store.observe(receipt,free).getString("phase"))
            receipt.put("state","running").put("scopeConfirmed",false).put("sequence",2)
            assertEquals("terminal",store.observe(receipt,free).getString("phase"))
            assertTrue(store.decision("started",free).getBoolean("policyInterrupted"))
        }
    }
    @Test fun rejectingAStaleGrantMustNotRollBackTheObservedEndOfItsNetworkPeriod(){
        NativeDataSaverStore(context,"data-saver-${UUID.randomUUID()}").use{store->
            store.configure(true,0,metered);val row=store.register(request("old-grant"),metered)
            val digest=row.getString("requestDigest");val period=row.getLong("period")
            store.prepared("old-grant",digest,"a".repeat(64),metered);store.grant("old-grant",digest,period,metered)
            expectCode("DATA_SAVER_GRANT_EXPIRED"){store.grant("old-grant",digest,period,free)}
            assertEquals("waiting",store.decision("old-grant",metered).getString("phase"))
        }
    }
}
