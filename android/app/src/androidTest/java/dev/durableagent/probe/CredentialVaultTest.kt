package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.UserManager
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.security.KeyStore
import java.security.ProviderException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.LinkedBlockingQueue
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/** Public vault seam with real AndroidKeyStore and private CE files; synthetic credentials only. */
@RunWith(AndroidJUnit4::class)
class CredentialVaultTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun expectCode(code: String, action: () -> Unit) {
        try { action(); fail("Expected safe credential failure: $code") }
        catch (error: CredentialVaultException) {
            assertEquals(code, error.code)
            assertNull(error.cause)
            assertTrue(error.suppressed.isEmpty())
        }
    }
    private fun envelope(namespace: String) = File(context.noBackupFilesDir, namespace)
        .listFiles()!!.single { it.name.endsWith(".json") }
    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun evidence(name: String, json: JSONObject) {
        InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
            putString("credentialEvidence", JSONObject().put("case", name).put("result", json).toString())
        })
    }

    @Test fun savedCredentialSurvivesReopenWithoutPlaintextAtRest() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val secret = "synthetic-vault-secret-${UUID.randomUUID()}-北京🌍"
        val vault = CredentialVault(context, namespace)
        assertEquals("absent", vault.metadata("connection-a").state)
        val saved = vault.save("connection-a", secret, 0)
        assertEquals(1L, saved.generation)
        assertEquals("configured", saved.state)
        assertFalse(saved.toJson().toString().contains(secret))
        val reopened = CredentialVault(context, namespace)
        assertEquals(secret, reopened.resolve("connection-a").key)
        assertEquals(1L, reopened.resolve("connection-a").generation)
        assertEquals("absent", reopened.metadata("connection-b").state)
        assertEquals(listOf("connection-a"), reopened.list().map { it.connectionId })
        val root = File(context.noBackupFilesDir, namespace)
        assertTrue(root.isDirectory)
        root.walkTopDown().filter { it.isFile }.forEach {
            assertFalse("Plaintext in ${it.name}", it.readBytes().toString(Charsets.UTF_8).contains(secret))
        }
        reopened.remove("connection-a", 1)
    }

    @Test fun rotationAndDeletionUseMonotonicCasWithoutConnectionInheritance() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-first-key", 0)
        val firstAlias = JSONObject(envelope(namespace).readText()).getString("alias")
        assertEquals(2L, vault.save("connection-a", "synthetic-second-key", 1).generation)
        assertFalse(keyStore().containsAlias(firstAlias))
        expectCode("generation-conflict") { vault.save("connection-a", "synthetic-stale-key", 1) }
        assertEquals("synthetic-second-key", vault.resolve("connection-a").key)
        assertEquals("absent", vault.metadata("new-endpoint-connection").state)
        assertEquals(3L, vault.remove("connection-a", 2).generation)
        expectCode("absent") { vault.resolve("connection-a") }
        expectCode("generation-conflict") { vault.save("connection-a", "synthetic-stale-key", 2) }
        assertEquals(4L, CredentialVault(context, namespace).save("connection-a", "synthetic-new-key", 3).generation)
        vault.remove("connection-a", 4)
    }

    @Test fun concurrentInstancesAdmitExactlyOneExpectedGeneration() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-original", 0)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val outcomes = (1..2).map { number -> pool.submit<String> {
                start.await()
                try { CredentialVault(context, namespace).save("connection-a", "synthetic-$number", 1); "saved" }
                catch (error: CredentialVaultException) { error.code }
            } }
            start.countDown()
            assertEquals(listOf("generation-conflict", "saved"), outcomes.map { it.get(20, TimeUnit.SECONDS) }.sorted())
            assertEquals(2L, vault.resolve("connection-a").generation)
        } finally { pool.shutdownNow(); vault.remove("connection-a", 2) }
    }

    @Test fun missingProtectionKeyPreservesCiphertextAndCanBeExplicitlyReconfigured() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-lost-key", 0)
        val file = envelope(namespace)
        val bytes = file.readBytes()
        val alias = JSONObject(bytes.toString(Charsets.UTF_8)).getString("alias")
        keyStore().deleteEntry(alias) // Actual platform key loss at the external crypto boundary.
        assertEquals("key-missing", CredentialVault(context, namespace).metadata("connection-a").state)
        expectCode("key-missing") { vault.resolve("connection-a") }
        assertArrayEquals(bytes, file.readBytes())
        assertEquals(2L, vault.save("connection-a", "synthetic-reconfigured", 1).generation)
        assertNotEquals(alias, JSONObject(file.readText()).getString("alias"))
        assertEquals("synthetic-reconfigured", vault.resolve("connection-a").key)
        vault.remove("connection-a", 2)
    }

    @Test fun ordinaryMetadataDoesNotDecryptTamperedCiphertextAndResolvePreservesIt() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        val secret = "synthetic-authenticated-secret-${UUID.randomUUID()}"
        vault.save("connection-a", secret, 0)
        val file = envelope(namespace)
        val json = JSONObject(file.readText())
        val encrypted = Base64.decode(json.getString("ciphertext"), Base64.NO_WRAP)
        encrypted[0] = (encrypted[0].toInt() xor 1).toByte()
        json.put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
        file.writeText(json.toString()) // External storage corruption; do not mock the vault.
        val damaged = file.readBytes()
        assertEquals("configured", CredentialVault(context, namespace).metadata("connection-a").state)
        assertEquals("configured", vault.list().single().state)
        expectCode("corrupt") { vault.resolve("connection-a") }
        assertArrayEquals(damaged, file.readBytes())
        assertFalse(vault.metadata("connection-a").toJson().toString().contains(secret))
        assertEquals(2L, vault.save("connection-a", "synthetic-reconfigured", 1).generation)
        assertEquals("synthetic-reconfigured", vault.resolve("connection-a").key)
        vault.remove("connection-a", 2)
    }

    @Test fun incompatibleAndMalformedEnvelopesAreNeverSilentlyReplaced() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-future-key", 0)
        val file = envelope(namespace)
        val original = file.readBytes()
        file.writeText(JSONObject(file.readText()).put("version", 99).toString())
        val future = file.readBytes()
        assertEquals("incompatible", vault.metadata("connection-a").state)
        expectCode("incompatible") { vault.resolve("connection-a") }
        expectCode("incompatible") { vault.save("connection-a", "synthetic-replacement", 1) }
        expectCode("incompatible") { vault.remove("connection-a", 1) }
        assertArrayEquals(future, file.readBytes())
        file.writeText("{broken-envelope")
        val damaged = file.readBytes()
        assertEquals("corrupt", vault.metadata("connection-a").state)
        expectCode("corrupt") { vault.save("connection-a", "synthetic-replacement", 1) }
        assertArrayEquals(damaged, file.readBytes())
        file.writeBytes(original) // Restore only this dedicated synthetic fixture for cleanup.
        vault.remove("connection-a", 1)
    }

    @Test fun actualProtectionKeyHasNoPerUseAuthAndRecordsItsSecurityLevel() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-lock-screen-key", 0)
        val alias = JSONObject(envelope(namespace).readText()).getString("alias")
        val key = keyStore().getKey(alias, null) as SecretKey
        val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertNull(key.encoded)
        assertFalse(info.isUserAuthenticationRequired)
        assertFalse(info.isUserAuthenticationRequirementEnforcedBySecureHardware)
        assertEquals("synthetic-lock-screen-key", vault.resolve("connection-a").key)
        evidence("keystore-policy", JSONObject().put("securityLevel", info.securityLevel)
            .put("keySize", info.keySize).put("userAuthenticationRequired", info.isUserAuthenticationRequired)
            .put("userUnlocked", context.getSystemService(UserManager::class.java).isUserUnlocked)
            .put("deviceLocked", context.getSystemService(KeyguardManager::class.java).isDeviceLocked)
            .put("keyguardLocked", context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
            .put("secretResolved", true).put("exportable", key.encoded != null))
        vault.remove("connection-a", 1)
    }

    @Test fun narrowNativeAdapterOnlyReturnsPlaintextAtExplicitRequestTimeResolve() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        val access = NativeCredentialAccess(vault)
        val secret = "synthetic-native-secret-${UUID.randomUUID()}"
        val saved = access.saveJson("connection-a", secret, 0)
        assertTrue(JSONObject(saved).getBoolean("ok"))
        assertFalse(saved.contains(secret))
        assertFalse(access.metadataJson("connection-a").contains(secret))
        assertFalse(vault.resolve("connection-a").toString().contains(secret))
        val resolved = JSONObject(access.resolveJson("connection-a"))
        assertEquals(secret, resolved.getJSONObject("value").getString("key"))
        val conflict = access.saveJson("connection-a", secret, 0)
        assertEquals("generation-conflict", JSONObject(conflict).getJSONObject("error").getString("code"))
        assertFalse(conflict.contains(secret))
        assertFalse(conflict.contains("cause"))
        assertTrue(JSONObject(access.removeJson("connection-a", 1)).getBoolean("ok"))
    }

    @Test fun failedAtomicReplacementKeepsPreviousCredentialAndNeverFallsBackToPlaintext() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-previous", 0)
        val file = envelope(namespace)
        val original = file.readBytes()
        val staging = File(file.parentFile, file.name + ".new")
        assertTrue(staging.mkdir()) // Real filesystem failure at the atomic write boundary.
        val secret = "synthetic-must-not-persist-${UUID.randomUUID()}"
        expectCode("temporarily-unavailable") { vault.save("connection-a", secret, 1) }
        assertArrayEquals(original, file.readBytes())
        assertEquals("synthetic-previous", CredentialVault(context, namespace).resolve("connection-a").key)
        assertEquals(1L, vault.metadata("connection-a").generation)
        file.parentFile!!.walkTopDown().filter { it.isFile }.forEach {
            assertFalse(it.readBytes().toString(Charsets.UTF_8).contains(secret))
        }
        // The failed staging directory may have been removed during cleanup; only this fixture is involved.
        if (staging.exists()) assertTrue(staging.delete())
        assertEquals(2L, vault.save("connection-a", "synthetic-retry", 1).generation)
        vault.remove("connection-a", 2)
    }

    @Test fun sameUidCompetitorCannotEnterVaultAndProcessDeathReleasesItsLease() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        vault.save("connection-a", "synthetic-owned-credential", 0)
        val connected = CompletableFuture<IBinder>()
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) { connected.complete(binder) }
            override fun onServiceDisconnected(name: ComponentName) { }
        }
        val responses = LinkedBlockingQueue<Bundle>()
        val receiver = Messenger(Handler(Looper.getMainLooper()) { message -> responses.offer(Bundle(message.data)); true })
        assertTrue(context.bindService(Intent(context, CredentialLeaseProbeService::class.java), connection, Context.BIND_AUTO_CREATE))
        try {
            val binder = connected.get(10, TimeUnit.SECONDS)
            val remote = Messenger(binder)
            fun command(what: Int) {
                remote.send(Message.obtain(null, what).apply {
                    data = Bundle().apply { putString("namespace", namespace) }
                    replyTo = receiver
                })
            }
            command(1)
            val held = responses.poll(10, TimeUnit.SECONDS) ?: error("Lease probe did not respond")
            assertTrue(held.getBoolean("held"))
            assertNotEquals(android.os.Process.myPid(), held.getInt("pid"))
            assertEquals("temporarily-unavailable", vault.metadata("connection-a").state)
            expectCode("temporarily-unavailable") { vault.save("connection-a", "synthetic-conflicting", 1) }
            val died = CountDownLatch(1)
            binder.linkToDeath({ died.countDown() }, 0)
            command(3) // Terminates only the dedicated debug lease process, not the product host.
            assertTrue("Lease process did not exit", died.await(10, TimeUnit.SECONDS))
            assertEquals("synthetic-owned-credential", vault.resolve("connection-a").key)
            assertEquals(1L, vault.metadata("connection-a").generation)
            evidence("cross-process-lease", JSONObject().put("distinctProcess", true)
                .put("blockedWhileHeld", true).put("recoveredAfterProcessDeath", true))
        } finally { context.unbindService(connection); vault.remove("connection-a", 1) }
    }

    @Test fun externalCryptoFailuresAreDistinguishedWithoutLeakingTheirCauseOrChangingCiphertext() {
        val namespace = "vault-test-${UUID.randomUUID()}"
        val vault = CredentialVault(context, namespace)
        val secret = "synthetic-platform-failure-${UUID.randomUUID()}"
        vault.save("connection-a", secret, 0)
        val file = envelope(namespace)
        val original = file.readBytes()
        var decryptCalls = 0
        val invalidated = CredentialVault(context, namespace, decryptCiphertext = { _, _ ->
            decryptCalls++
            throw KeyPermanentlyInvalidatedException(secret)
        })
        assertEquals("configured", invalidated.metadata("connection-a").state)
        assertEquals("configured", invalidated.list().single().state)
        assertEquals(0, decryptCalls)
        val access = NativeCredentialAccess(invalidated)
        val response = access.resolveJson("connection-a")
        assertEquals(1, decryptCalls)
        assertEquals("permanently-invalidated", JSONObject(response).getJSONObject("error").getString("code"))
        assertFalse(response.contains(secret))
        assertFalse(response.contains("cause"))
        assertArrayEquals(original, file.readBytes())
        assertEquals("permanently-invalidated", JSONObject(access.metadataJson("connection-a")).getJSONObject("value").getString("state"))
        assertEquals(1, decryptCalls)
        val unavailable = CredentialVault(context, namespace, decryptCiphertext = { _, _ ->
            throw ProviderException(secret)
        })
        expectCode("temporarily-unavailable") { unavailable.resolve("connection-a") }
        assertArrayEquals(original, file.readBytes())
        assertEquals(secret, CredentialVault(context, namespace).resolve("connection-a").key)
        evidence("crypto-fault-classification", JSONObject().put("faultSource", "injected external Cipher finalization")
            .put("permanentInvalidation", "classified, not physical hardware invalidation")
            .put("metadataDecryptCalls", 0).put("ciphertextPreserved", true))
        vault.save("connection-a", "synthetic-reconfigured", 1)
        assertEquals("configured", JSONObject(access.metadataJson("connection-a")).getJSONObject("value").getString("state"))
        assertEquals(1, decryptCalls)
        vault.remove("connection-a", 2)
    }
}
