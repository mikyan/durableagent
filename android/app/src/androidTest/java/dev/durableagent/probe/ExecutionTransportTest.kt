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
}
