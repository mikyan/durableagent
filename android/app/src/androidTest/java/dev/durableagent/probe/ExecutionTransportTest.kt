package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Real platform key/TLS boundary. Root supplies only public Termux peer information. */
@RunWith(AndroidJUnit4::class)
class ExecutionTransportTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun identity()=ExecutionIdentity(context,"tls-proof-v2")
    @Test fun exportClientIdentity() {
        val identity=identity()
        val first=identity.certificatePem()
        assertEquals(first,ExecutionIdentity(context,"tls-proof-v2").certificatePem())
        assertTrue(first.startsWith("-----BEGIN CERTIFICATE-----"))
        val file=File(context.noBackupFilesDir,"execution-proof-client.pem")
        file.writeText(first)
        instrumentation.sendStatus(0,android.os.Bundle().apply {putString("executionEvidence",JSONObject().put("case","public-client-identity").put("certificateSha256",identity.certificateSha256()).put("publicPath",file.absolutePath).toString())})
    }
    @Test fun realTermuxMutualTlsAuthenticatesBothPeers() {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.containsKey("executionPort"))
        val pairing=ExecutionPairing(args.getString("executionPort")!!.toInt(),args.getString("executionServerPin")!!,"tls-proof-executor","tls-proof-ledger")
        val result=ExecutionTlsClient(identity(),pairing){diagnostic->instrumentation.sendStatus(0,android.os.Bundle().apply {putString("executionTlsDiagnostic",diagnostic)})}.request("echo",JSONObject().put("text","执行通道 ✓ 🌍"))
        assertEquals("执行通道 ✓ 🌍",result.getString("text"))
        assertEquals("127.0.0.1",result.getString("boundAddress"))
        val wrongPin=pairing.copy(serverSpkiSha256="0".repeat(64))
        assertThrows(ExecutionChannelException::class.java){ExecutionTlsClient(identity(),wrongPin).request("echo",JSONObject())}
        assertThrows(ExecutionChannelException::class.java){ExecutionTlsClient(ExecutionIdentity(context,"tls-unpaired-v2"),pairing).request("echo",JSONObject())}
        instrumentation.sendStatus(0,android.os.Bundle().apply {putString("executionEvidence",JSONObject().put("case","real-termux-mutual-tls").put("unicode",true).put("wrongServerRejected",true).put("unpairedClientRejected",true).toString())})
    }
    @Test fun savedPairingSurvivesReopenAndRejectsIdentityReplacement() {
        val namespace="pairing-${UUID.randomUUID()}"
        val expected=ExecutionPairing(47193,"a".repeat(64),"executor-one","ledger-one")
        ExecutionPairingStore(context,namespace).use {store->
            assertNull(store.read())
            assertEquals(expected,store.saveIfAbsent(expected,"b".repeat(64)))
        }
        ExecutionPairingStore(context,namespace).use {store->
            assertEquals(expected,store.read())
            assertEquals(expected,store.saveIfAbsent(expected,"b".repeat(64)))
            assertThrows(ExecutionChannelException::class.java){store.saveIfAbsent(expected.copy(ledgerEpoch="another-ledger"),"b".repeat(64))}
            assertThrows(ExecutionChannelException::class.java){store.saveIfAbsent(expected,"c".repeat(64))}
            assertEquals(expected,store.read())
        }
    }
    @Test fun bootstrapResultsAreOneShotAndRequirePendingChallenge() {
        ExecutionBootstrapStore(context,"test-${UUID.randomUUID()}").use {store->
            val nonce=UUID.randomUUID().toString()
            assertFalse(store.complete(nonce,"unrequested"))
            store.register(nonce)
            assertNull(store.take(nonce))
            assertTrue(store.complete(nonce,"first"))
            assertFalse(store.complete(nonce,"second"))
            assertEquals("first",store.take(nonce))
            assertNull(store.take(nonce))
            assertFalse(store.complete(nonce,"late"))
        }
    }
    @Test(timeout=90000) fun actualOrdinaryOperationRestartsPairedExecutorWithoutExplicitConnect() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("executionProduction")=="true")
        val identity=ExecutionIdentity(context,"production-v1",allowCreate=false)
        val before=ExecutionPairingStore(context).use{it.requireClient(identity.certificateSha256())}
        val original=ExecutionTlsClient(identity,before).request("ping",JSONObject())
        // Narrow test-only fault injection in the existing Termux UID. Exact argv
        // selects only our idle fixed listener, never command workers or another app.
        val script="""
import json,os,signal,socket,time
from pathlib import Path
script='/data/data/com.termux/files/home/.local/share/durableagent-execution/durable_executor.py'
pids=[]
for item in Path('/proc').iterdir():
 if not item.name.isdecimal(): continue
 try: args=(item/'cmdline').read_bytes().split(bytes([0])); args=[a.decode() for a in args if a]
 except (OSError,UnicodeError): continue
 if len(args)==3 and args[1]==script and args[2] in ('serve','serve-existing'): pids.append(int(item.name))
assert len(pids)==1, 'Expected exactly our one existing listener'
os.kill(pids[0],signal.SIGKILL)
for _ in range(100):
 with socket.socket() as sock:
  sock.settimeout(.1); absent=sock.connect_ex(('127.0.0.1',47193))!=0
 if absent: break
 time.sleep(.02)
assert absent, 'Owned listener must be absent before ordinary operation'
print(json.dumps({'killedOwnedListenerPid':pids[0],'listenerAbsentBeforeRequest':True}))
""".trimIndent()
        val nonce=UUID.randomUUID().toString()
        val callback=android.app.PendingIntent.getBroadcast(context,0,android.content.Intent(context,ExecutionBootstrapReceiver::class.java).setAction(ExecutionBootstrapReceiver.ACTION).setData(android.net.Uri.parse("durableagent-execution://bootstrap/$nonce")),android.app.PendingIntent.FLAG_MUTABLE or android.app.PendingIntent.FLAG_ONE_SHOT or android.app.PendingIntent.FLAG_CANCEL_CURRENT)
        val fault=ExecutionBootstrapStore(context).use{mailbox->mailbox.register(nonce);try{
            context.startForegroundService(android.content.Intent("com.termux.RUN_COMMAND").apply{component=android.content.ComponentName("com.termux","com.termux.app.RunCommandService");putExtra("com.termux.RUN_COMMAND_PATH","/data/data/com.termux/files/usr/bin/python");putExtra("com.termux.RUN_COMMAND_ARGUMENTS",arrayOf("-c",script));putExtra("com.termux.RUN_COMMAND_WORKDIR","/data/data/com.termux/files/home");putExtra("com.termux.RUN_COMMAND_BACKGROUND",true);putExtra("com.termux.RUN_COMMAND_PENDING_INTENT",callback)})
            val end=android.os.SystemClock.elapsedRealtime()+15000;var receipt:String?=null
            while(receipt==null&&android.os.SystemClock.elapsedRealtime()<end){receipt=mailbox.take(nonce);if(receipt==null)Thread.sleep(25)}
            val response=JSONObject(receipt?:error("Fixed listener fault injection did not return"));assertTrue(response.toString(),response.getBoolean("ok"));JSONObject(response.getString("stdout"))
        }finally{callback.cancel();mailbox.forget(nonce)}}
        instrumentation.sendStatus(0,android.os.Bundle().apply{putString("automaticExecutorBefore",JSONObject().put("original",original).put("fault",fault).put("explicitConnectCalled",false).toString())})
        val after=ExecutionAccess(context).use{access->
            val begun=JSONObject(access.beginJson("ping","{}"));assertTrue(begun.toString(),begun.getBoolean("ok"));val operation=begun.getJSONObject("value").getString("operationId");val end=android.os.SystemClock.elapsedRealtime()+40000
            var result:JSONObject?=null
            while(result==null&&android.os.SystemClock.elapsedRealtime()<end){val value=JSONObject(access.pollJson(operation)).getJSONObject("value");if(!value.getBoolean("pending"))result=value.getJSONObject("result") else Thread.sleep(25)}
            val response=result?:error("Ordinary ping did not settle");assertTrue("Ordinary request must reopen the paired executor without Connect: $response",response.getBoolean("ok"));response.getJSONObject("value")
        }
        assertEquals(before.executorId,after.getString("executorId"));assertEquals(before.ledgerEpoch,after.getString("ledgerEpoch"));assertNotEquals(original.getString("processEpoch"),after.getString("processEpoch"))
        assertEquals(before,ExecutionPairingStore(context).use{it.requireClient(identity.certificateSha256())})
        instrumentation.sendStatus(0,android.os.Bundle().apply{putString("automaticExecutorAfter",JSONObject().put("after",after).put("pairingUnchanged",true).put("explicitConnectCalled",false).toString())})
    }
    @Test fun productionBootstrapUsesRealTermuxAndPersistsVerifiedPeer() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("executionProduction")=="true")
        val connected=ExecutionTermuxGateway(context).connect()
        val reopened=ExecutionPairingStore(context).use {it.requireClient(ExecutionIdentity(context,"production-v1").certificateSha256())}
        assertEquals(connected,reopened)
        val result=ExecutionTlsClient(ExecutionIdentity(context,"production-v1"),reopened).request("ping",JSONObject())
        assertEquals(1,result.getInt("protocol"))
        assertEquals(connected.executorId,result.getString("executorId"))
        assertEquals(connected.ledgerEpoch,result.getString("ledgerEpoch"))
        instrumentation.sendStatus(0,android.os.Bundle().apply {putString("executionEvidence",JSONObject().put("case","real-termux-bootstrap").put("executorId",connected.executorId).put("ledgerEpoch",connected.ledgerEpoch).put("port",connected.port).toString())})
    }
    @Test fun nativeCancellationOfUnacceptedIdentityPersistsTombstoneAndRejectsLateAcceptance() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("executionProduction")=="true")
        val identity=ExecutionIdentity(context,"production-v1",allowCreate=false)
        val peer=ExecutionPairingStore(context).use {it.requireClient(identity.certificateSha256())}
        val client=ExecutionTlsClient(identity,peer)
        val info=client.request("ping",JSONObject())
        val id="native-preaccept-"+UUID.randomUUID()
        val before=client.request("query",JSONObject().put("executionId",id))
        assertEquals(id,before.getString("executionId"));assertEquals("unknown",before.getString("state"));assertEquals("NO_RECEIPT",before.getString("reason"))
        assertEquals(info.getString("namespace"),before.getString("namespace"))
        fun cancel():JSONObject=ExecutionAccess(context).use {access->
            val started=JSONObject(access.beginVerifiedCancelJson(id));assertTrue(started.toString(),started.getBoolean("ok"))
            val operation=started.getJSONObject("value").getString("operationId")
            val deadline=android.os.SystemClock.elapsedRealtime()+12000
            while(true){
                val polled=JSONObject(access.pollJson(operation));assertTrue(polled.toString(),polled.getBoolean("ok"))
                val value=polled.getJSONObject("value")
                if(!value.getBoolean("pending")){
                    val result=value.getJSONObject("result");assertTrue(result.toString(),result.getBoolean("ok"));return@use result.getJSONObject("value")
                }
                assertTrue("Native cancellation did not settle",android.os.SystemClock.elapsedRealtime()<deadline);Thread.sleep(25)
            }
            @Suppress("UNREACHABLE_CODE") JSONObject()
        }
        val cancelled=cancel()
        assertEquals(id,cancelled.getString("executionId"));assertEquals(info.getString("namespace"),cancelled.getString("namespace"))
        assertEquals("not_started",cancelled.getString("state"));assertEquals("CANCELLED_BEFORE_ACCEPTANCE",cancelled.getString("reason"))
        assertTrue(cancelled.getBoolean("neverStarted"));assertTrue(cancelled.getBoolean("scopeConfirmed"))
        fun sameReceipt(actual:JSONObject){assertEquals(cancelled.keys().asSequence().toSet(),actual.keys().asSequence().toSet());for(key in cancelled.keys())assertEquals("Retained field $key",cancelled.get(key),actual.get(key))}
        sameReceipt(client.request("query",JSONObject().put("executionId",id)))
        sameReceipt(cancel())
        val request=JSONObject().put("executionId",id).put("context",JSONObject().put("productId","native-cancel-fixture").put("sdkConversationId",1).put("taskId",1).put("callId",id).put("bindingId","native-cancel-fixture").put("locationVersion",1).put("controlGeneration",1).put("namespace",info.getString("namespace")))
            .put("command",JSONObject().put("kind","argv").put("argv",org.json.JSONArray().put("/data/data/com.termux/files/usr/bin/true")))
            .put("cwd",info.getString("defaultWorkspace")).put("env",JSONObject()).put("inheritEnv",false).put("timeoutMs",JSONObject.NULL)
        val rejected=assertThrows(ExecutionChannelException::class.java){client.request("prepare",request)}
        assertEquals("CANCELLED_BEFORE_ACCEPTANCE",rejected.code)
        instrumentation.sendStatus(0,android.os.Bundle().apply {putString("executionEvidence",JSONObject().put("case","native-preaccept-cancel").put("executionId",id).put("receipt",cancelled).put("lateAcceptanceRejected",true).toString())})
    }
    @Test fun asyncBoundaryRejectsUnknownOperationsWithoutOpeningConnection() {
        ExecutionAccess(context).use { access ->
            val invalid=JSONObject(access.beginJson("shell","{}"))
            assertFalse(invalid.getBoolean("ok"))
            assertEquals("INVALID_METHOD",invalid.getJSONObject("error").getString("code"))
            val missing=JSONObject(access.pollJson(UUID.randomUUID().toString()))
            assertFalse(missing.getBoolean("ok"))
            assertEquals("OPERATION_UNKNOWN",missing.getJSONObject("error").getString("code"))
            val invalidCancel=JSONObject(access.beginVerifiedCancelJson("../another-execution"))
            assertFalse(invalidCancel.getBoolean("ok"))
            assertEquals("INVALID_EXECUTION_ID",invalidCancel.getJSONObject("error").getString("code"))
        }
    }
    @Test fun lostPairedClientIdentityIsNeverSilentlyRegenerated() {
        val absent="absent-${UUID.randomUUID()}"
        val error=assertThrows(ExecutionChannelException::class.java) {ExecutionIdentity(context,absent,allowCreate=false).certificatePem()}
        assertEquals("CLIENT_IDENTITY_UNAVAILABLE",error.code)
    }
    @Test fun bootstrapConflictIsDiagnosedOnlyForCompleteMatchingCallback() {
        val nonce=UUID.randomUUID().toString()
        val stdout=JSONObject().put("protocol",1).put("nonce",nonce).put("error",JSONObject().put("code","PAIRING_CONFLICT")).toString()
        val wire=mapOf("stdout" to stdout,"stderr" to "","stdout_original_length" to stdout.length.toString(),"stderr_original_length" to "0","err" to -1,"exitCode" to 65)
        val diagnosed=JSONObject(decodeExecutionBootstrapResult(nonce,wire))
        assertFalse(diagnosed.getBoolean("ok"));assertEquals("PAIRING_CONFLICT",diagnosed.getString("error"))
        assertEquals("BOOTSTRAP_UNCONFIRMED",JSONObject(decodeExecutionBootstrapResult(UUID.randomUUID().toString(),wire)).getString("error"))
        assertEquals("BOOTSTRAP_UNCONFIRMED",JSONObject(decodeExecutionBootstrapResult(nonce,wire+("stdout_original_length" to (stdout.length+1).toString()))).getString("error"))
    }
}
