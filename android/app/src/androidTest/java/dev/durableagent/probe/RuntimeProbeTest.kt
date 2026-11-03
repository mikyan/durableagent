package dev.durableagent.probe

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RuntimeProbeTest {
    @Test(timeout=120000) fun optInRealMimoRoundtripAndCancellation() {
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("realProvider")=="true")
        ActivityScenario.launch(ProbeActivity::class.java).use {
            val client=RuntimeClient(instrumentation.targetContext);client.connect()
            try {
                client.command("start-real")
                awaitState(client){it.optString("status")=="ready"}
                client.command("send")
                val done=awaitState(client){it.optString("status")=="done"}
                assertEquals("mimo-v2.6-flash",done.getString("model"))
                assertEquals("北京🌍",done.getJSONArray("toolArguments").getJSONObject(0).getString("city"))
                assertTrue(done.getInt("textDeltaEvents")>1)
                assertTrue(done.getInt("toolDeltaEvents")>0)
                assertTrue(done.getString("text").contains("北京🌍"))
                client.command("send-long")
                val inFlight=awaitState(client){it.optString("status")=="running"&&it.optInt("textDeltaEvents")>done.getInt("textDeltaEvents")&&it.optBoolean("bodyReadPending")}
                assertEquals(0,inFlight.getInt("requestAbortCount"))
                assertFalse(inFlight.getBoolean("transportAborted"))
                assertFalse(inFlight.getBoolean("providerFinished"))
                client.command("stop")
                val stopped=awaitState(client){it.optString("status")=="stopped"}
                assertEquals(inFlight.getInt("currentRequest"),stopped.getInt("currentRequest"))
                assertTrue(stopped.getInt("requestAbortCount")>inFlight.getInt("requestAbortCount"))
                assertTrue(stopped.getBoolean("transportAborted"))
                assertFalse(stopped.getBoolean("bodyReadPending"))
                assertTrue(stopped.optString("bodyReadError")=="AbortError"||stopped.optBoolean("bodyReadCancelled"))
                client.command("close")
                assertEquals(0,awaitState(client){it.optString("status")=="closed"}.getInt("nativeOwners"))
            } finally {client.disconnect()}
        }
    }
    @Test(timeout=90000) fun realSdkStreamsAcrossActivityRecreationAndRuntimeReopens() {
        var scenario=ActivityScenario.launch(ProbeActivity::class.java)
        try {
            var client = RuntimeClient(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext)
            client.connect()
            try {
                client.command("start")
                val ready = awaitState(client) { it.optString("status") == "ready" }
                assertEquals("v26.13.0", ready.getString("node"))
                assertEquals("1.5.0", ready.getString("sdk"))
                val instance = ready.getString("instance")
                val pid=ready.getInt("pid")
                assertNotEquals(android.os.Process.myPid(),pid)
                client.command("start")
                client.command("send")
                awaitState(client) { it.optString("text") == "你" }
                client.disconnect()
                scenario.close()
                Thread.sleep(150)
                scenario=ActivityScenario.launch(ProbeActivity::class.java)
                client=RuntimeClient(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext)
                client.connect()
                val result = awaitState(client) { it.optString("status") == "done" }
                assertEquals("你好🌍", result.getString("text"))
                assertEquals(instance, result.getString("instance"))
                assertEquals(pid,result.getInt("pid"))
                assertEquals(1, result.getInt("transportRequests"))
                client.command("close")
                assertEquals(0,awaitState(client) { it.optString("status") == "closed" }.getInt("nativeOwners"))
                client.command("start")
                val reopened = awaitState(client) { it.optString("status") == "ready" }
                assertNotEquals(instance, reopened.getString("instance"))
                client.command("close")
                awaitState(client) { it.optString("status") == "closed" }
            } finally { client.disconnect() }
        } finally {scenario.close()}
    }
    @Test(timeout=90000) fun toolSchemaCancellationAndFaultRecreation() {
        ActivityScenario.launch(ProbeActivity::class.java).use {
            val client=RuntimeClient(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext)
            client.connect()
            try {
                for(mode in listOf("tool","invalid","hang")) {
                    client.command("start-$mode")
                    val ready=awaitState(client){it.optString("status")=="ready"}
                    assertEquals(42,ready.getJSONObject("capabilities").getInt("sqlite"))
                    assertTrue(ready.getJSONObject("capabilities").getBoolean("weakRef"))
                    assertEquals(1,ready.getInt("nativeOwners"))
                    client.command("send")
                    if(mode=="hang") {
                        awaitState(client){it.optInt("transportRequests")==1}
                        client.command("stop")
                        val stopped=awaitState(client){it.optString("status")=="stopped"}
                        assertTrue(stopped.getBoolean("transportAborted"))
                    } else {
                        val done=awaitState(client){it.optString("status")=="done"}
                        if(mode=="tool") {
                            val args=done.getJSONArray("toolArguments").getJSONObject(0)
                            assertEquals("北京🌍",args.getString("city"));assertEquals(2,args.getInt("count"))
                        } else {assertTrue(done.getBoolean("toolRejected"));assertEquals(0,done.getJSONArray("toolArguments").length())}
                    }
                    client.command("close")
                    assertEquals(0,awaitState(client){it.optString("status")=="closed"}.getInt("nativeOwners"))
                }
                client.command("start")
                val before=awaitState(client){it.optString("status")=="ready"}
                client.command("fault")
                val fault=awaitState(client,allowFailure=true){it.optString("status")=="failed"}
                assertEquals(0,fault.getInt("nativeOwners"))
                client.command("start")
                val after=awaitState(client){it.optString("status")=="ready"}
                assertNotEquals(before.getString("instance"),after.getString("instance"))
                client.command("close")
                awaitState(client){it.optString("status")=="closed"}
            } finally {client.disconnect()}
        }
    }
    private fun awaitState(client:RuntimeClient,allowFailure:Boolean=false, predicate:(JSONObject)->Boolean):JSONObject {
        val deadline=System.currentTimeMillis()+45000
        var state=JSONObject()
        while(System.currentTimeMillis()<deadline) {
            state=client.snapshot()
            if(!allowFailure && state.optString("status")=="failed") fail(state.toString())
            if(predicate(state)) {
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendStatus(0,android.os.Bundle().apply {putString("probeEvidence",state.toString())})
                return state
            }
            Thread.sleep(10)
        }
        fail("Timed out: $state")
        return state
    }
}
