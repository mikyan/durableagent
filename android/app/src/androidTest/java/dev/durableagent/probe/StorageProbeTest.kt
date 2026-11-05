package dev.durableagent.probe

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class StorageProbeTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun runId()=UUID.randomUUID().toString()
    private fun client()=RuntimeClient(context).apply {connect()}
    private fun evidence(state:JSONObject) {instrumentation.sendStatus(0,android.os.Bundle().apply {putString("storageEvidence",state.toString())})}
    private fun await(client:RuntimeClient,status:String,timeout:Long=90000):JSONObject {
        val deadline=System.currentTimeMillis()+timeout
        var state=JSONObject()
        while(System.currentTimeMillis()<deadline) {
            state=client.snapshot()
            if(state.optString("status")=="failed"&&status!="failed")fail(state.toString())
            if(state.optString("status")==status){evidence(state);return state}
            Thread.sleep(10)
        }
        error("Timed out waiting for $status: $state")
    }
    private fun close(client:RuntimeClient) {client.command("close");assertEquals(0,await(client,"closed").getInt("nativeOwners"))}
    private fun killHost(pid:Int) {
        assertNotEquals(android.os.Process.myPid(),pid)
        android.os.Process.killProcess(pid) // Dedicated :runtime validation process, never the test/UI process.
        val deadline=System.currentTimeMillis()+10000
        while(System.currentTimeMillis()<deadline) {
            StorageDomainLease.acquire(File(context.filesDir,"storage-validation"))?.let {it.close();return}
            Thread.sleep(20)
        }
        error("OS writer lease survived validation process death")
    }
    @Test(timeout=180000) fun officialStorageConformanceAndDriverFaults() {
        ActivityScenario.launch(ProbeActivity::class.java).use {
            val client=client()
            try {
                client.command("start-storage-suite:${runId()}")
                val result=await(client,"suite-passed")
                assertEquals(47,result.getInt("total"));assertEquals(47,result.getJSONArray("passed").length())
                assertEquals("wal",result.getJSONObject("configuration").getString("journalMode"))
                assertEquals(2,result.getJSONObject("configuration").getInt("synchronous"))
                assertTrue(result.getBoolean("domainOwned"));close(client)
            } finally {client.disconnect()}
        }
    }
    @Test(timeout=120000) fun nativeOwnerRejectsIndependentRuntimeBeforeSqliteOpen() {
        ActivityScenario.launch(ProbeActivity::class.java).use {
            val client=client()
            try {
                val directory=File(context.filesDir,"storage-validation")
                val lease=StorageDomainLease.acquire(directory)?:error("Expected free domain")
                try {
                    assertNull(StorageDomainLease.acquire(directory))
                    client.command("start-storage-text:${runId()}")
                    val rejected=await(client,"failed")
                    assertTrue(rejected.getString("error").contains("already owned"))
                    assertEquals(0,rejected.getInt("nativeOwners"))
                }finally{lease.close()}
                client.command("start-storage-text:${runId()}")
                assertTrue(await(client,"ready").getBoolean("domainOwned"));close(client)
            }finally{client.disconnect()}
        }
    }
    @Test(timeout=240000) fun processDeathWindowsAndNativeOwnership() {
        val id=runId()
        for(phase in listOf("before","during","after","confirmed","deferred","migration")) {
            var scenario=ActivityScenario.launch(ProbeActivity::class.java)
            var client=client()
            try {
                client.command("start-storage-crash-$phase:$id")
                val before=await(client,"crash-ready")
                assertTrue(before.getBoolean("domainOwned"))
                // A genuinely independent process competes here: instrumentation/UI versus :runtime.
                assertNull(StorageDomainLease.acquire(File(context.filesDir,"storage-validation")))
                client.command("start-storage-crash-$phase:$id")
                Thread.sleep(30)
                assertEquals(before.getString("instance"),client.snapshot().getString("instance"))
                client.disconnect();scenario.close();killHost(before.getInt("pid"))
                scenario=ActivityScenario.launch(ProbeActivity::class.java);client=client()
                client.command("start-storage-recover-$phase:$id")
                val recovered=await(client,"recovered")
                assertNotEquals(before.getString("instance"),recovered.getString("instance"))
                assertTrue(recovered.getBoolean("domainOwned"))
                if(phase=="after"||phase=="confirmed")assertTrue(recovered.getBoolean("candidatePresent"))
                if(phase=="before"||phase=="during")assertFalse(recovered.getBoolean("candidatePresent"))
                if(phase=="deferred") {
                    assertEquals("unpersisted progress",before.getString("memoryProgress"))
                    assertEquals(0,before.getInt("storedPublications"))
                    assertEquals("durable baseline",recovered.getString("progress"))
                    assertEquals(before.getJSONObject("ids").getInt("submission"),recovered.getInt("submissionId"))
                    assertEquals(before.getJSONObject("ids").getInt("task"),recovered.getInt("taskId"))
                    assertTrue(recovered.getBoolean("inputPreserved"));assertTrue(recovered.getBoolean("intentPreserved"))
                }
                close(client)
            } finally {client.disconnect();scenario.close()}
        }
    }
    @Test(timeout=120000) fun persistedConversationSurvivesAllUiBindingsAndHostExit() {conversation(false)}
    @Test(timeout=120000) fun optInRealMimoConversationPersistsWithoutCredentials() {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        conversation(true)
    }
    private fun conversation(real:Boolean) {
        val id=runId();var scenario=ActivityScenario.launch(ProbeActivity::class.java);var client=client()
        try {
            client.command("start-storage-${if(real)"real" else "text"}:$id")
            val ready=await(client,"ready")
            assertNull(StorageDomainLease.acquire(File(context.filesDir,"storage-validation")))
            client.command("start-storage-text:$id");client.command("send")
            val done=await(client,"done")
            assertTrue(done.getInt("entryCount")>=2)
            if(real){assertTrue(done.getString("text").contains("北京🌍"));assertEquals(2,done.getInt("transportRequests"))}
            else assertEquals("你好🌍",done.getString("text"))
            client.disconnect();scenario.close();Thread.sleep(100)
            scenario=ActivityScenario.launch(ProbeActivity::class.java);client=client()
            val rebound=await(client,"done")
            assertEquals(ready.getString("instance"),rebound.getString("instance"))
            assertEquals(done.getJSONArray("entryIds").toString(),rebound.getJSONArray("entryIds").toString())
            close(client)
            client.disconnect();scenario.close();killHost(done.getInt("pid"))
            scenario=ActivityScenario.launch(ProbeActivity::class.java);client=client()
            client.command("start-storage-reopen:$id")
            val reopened=await(client,"ready")
            assertEquals(done.getString("text"),reopened.getString("text"))
            assertEquals(done.getJSONArray("entryIds").toString(),reopened.getJSONArray("entryIds").toString())
            assertEquals(0,reopened.getInt("transportRequests"))
            assertNotEquals(done.getString("instance"),reopened.getString("instance"))
            close(client)
        } finally {client.disconnect();scenario.close()}
    }
}
