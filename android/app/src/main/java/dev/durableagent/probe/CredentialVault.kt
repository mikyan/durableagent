package dev.durableagent.probe

import android.content.Context
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class CredentialMetadata(val connectionId: String, val state: String, val generation: Long) {
    val configured: Boolean get() = state == "configured"
    fun toJson(): JSONObject = JSONObject().put("connectionId", connectionId).put("state", state)
        .put("generation", generation).put("configured", configured)
}

/** Deliberately not a data class: logging a successful result must not print its secret. */
class CredentialValue(val key: String, val generation: Long) {
    override fun toString(): String = "CredentialValue(generation=$generation, key=[redacted])"
}

/** Only fixed safe messages cross native/JS boundaries; platform exceptions and causes stay private. */
class CredentialVaultException(val code: String) : RuntimeException(messageFor(code), null, false, false) {
    companion object {
        private fun messageFor(code: String): String = when (code) {
            "absent" -> "API Key has not been configured."
            "waiting-first-unlock" -> "Unlock the device once after startup to use credentials."
            "key-missing" -> "The credential protection key is missing. Configure the API Key again."
            "permanently-invalidated" -> "The credential protection key is invalid. Configure the API Key again."
            "corrupt" -> "The saved credential is damaged. Reconfigure it; if its metadata cannot be read, create a new connection and select it for the retained conversation."
            "incompatible" -> "The saved credential format is not supported. Preserve this connection, create a new connection and select it for the retained conversation."
            "generation-conflict" -> "The credential changed. Refresh its status before saving again."
            "invalid-input" -> "The credential request is invalid."
            else -> "Credentials are temporarily unavailable. Retry when the device is ready."
        }
    }
}

/**
 * App-owned CE ciphertext + non-exportable AndroidKeyStore protection keys. Ordinary queries do
 * not obtain keys or decrypt. "configured" means structurally present with an existing alias,
 * not authenticated ciphertext or remote account validity. Only resolve() uses plaintext.
 *
 * The stable OS lease covers every operation, including reads and key replacement. The process
 * monitor prevents opening a second descriptor to the same POSIX-locked inode in this process.
 * No CE path is obtained until UserManager confirms the first unlock. Screen lock thereafter
 * does not add per-use authentication or an unlocked-device requirement.
 */
class CredentialVault(
    context: Context,
    private val namespace: String = "credentials-v1",
    // External Cipher boundary for unavailable/permanently-invalidated provider faults that
    // cannot safely be induced on a person's hardware. Production always uses the real Cipher.
    private val decryptCiphertext: (Cipher, ByteArray) -> ByteArray = { cipher, bytes -> cipher.doFinal(bytes) }
) {
    private val context = context.applicationContext
    init { require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}"))) { "Invalid credential namespace" } }

    fun metadata(connectionId: String): CredentialMetadata {
        validateId(connectionId)
        return try {
            locked { directory -> metadataInside(connectionId, read(directory, connectionId)) }
        } catch (error: CredentialVaultException) {
            CredentialMetadata(connectionId, error.code, 0)
        }
    }

    fun list(): List<CredentialMetadata> = locked { directory ->
        directory.listFiles()?.filter { it.name.endsWith(".json") }?.map { file ->
            val json = parse(file)
            val id = json.optString("connectionId")
            validateId(id)
            if (file.name != filename(id)) fail("corrupt")
            metadataInside(id, read(directory, id))
        }?.sortedBy { it.connectionId } ?: emptyList()
    }

    /** Opaque non-secret revision for the native observed-failure projection; never decrypts. */
    internal fun revision(connectionId: String): String? {
        validateId(connectionId)
        return locked { directory ->
            val file = File(directory, filename(connectionId))
            if (!file.exists()) null else {
                if (file.length() !in 1..MAX_ENVELOPE_BYTES.toLong()) fail("corrupt")
                MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            }
        }
    }

    /** Product callers always supply expectedGeneration; null is explicit unconditional replace. */
    fun save(connectionId: String, key: String, expectedGeneration: Long? = null): CredentialMetadata {
        validateId(connectionId)
        if (key.isEmpty() || key.length > MAX_KEY_CHARS) fail("invalid-input")
        return locked { directory ->
            val previous = read(directory, connectionId)
            val generation = nextGeneration(previous, expectedGeneration)
            val alias = aliasPrefix(connectionId) + UUID.randomUUID()
            val keyStore = keyStore()
            val plaintext = key.toByteArray(Charsets.UTF_8)
            var published = false
            try {
                val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false)
                    .setUnlockedDeviceRequired(false).build())
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, generator.generateKey())
                cipher.updateAAD(aad(connectionId, generation))
                val envelope = JSONObject().put("version", VERSION).put("connectionId", connectionId)
                    .put("generation", generation).put("deleted", false).put("alias", alias)
                    .put("nonce", encode(cipher.iv)).put("ciphertext", encode(cipher.doFinal(plaintext)))
                persist(directory, connectionId, envelope) { published = true }
                // Cleanup cannot turn an already durable successful replacement into a failed save.
                deleteRetiredKey(keyStore, previous)
                CredentialMetadata(connectionId, "configured", generation)
            } catch (error: Exception) {
                // If rename succeeded but directory sync failed, the new file may be authoritative.
                // Keep both keys and report uncertainty; a CAS retry must reread its generation.
                if (!published) try { keyStore.deleteEntry(alias) } catch (_: Exception) { }
                throw safe(error)
            } finally { plaintext.fill(0) }
        }
    }

    /** A durable tombstone keeps the generation monotonic, so stale saves cannot recreate a key. */
    fun remove(connectionId: String, expectedGeneration: Long? = null): CredentialMetadata {
        validateId(connectionId)
        return locked { directory ->
            val previous = read(directory, connectionId)
            val generation = nextGeneration(previous, expectedGeneration)
            val envelope = JSONObject().put("version", VERSION).put("connectionId", connectionId)
                .put("generation", generation).put("deleted", true)
            persist(directory, connectionId, envelope) { }
            try { deleteRetiredKey(keyStore(), previous) } catch (_: Exception) { }
            CredentialMetadata(connectionId, "absent", generation)
        }
    }

    fun resolve(connectionId: String): CredentialValue {
        validateId(connectionId)
        return locked { directory ->
            val envelope = read(directory, connectionId) ?: fail("absent")
            if (envelope.getBoolean("deleted")) fail("absent")
            val protection = keyStore().getKey(envelope.getString("alias"), null) as? SecretKey ?: fail("key-missing")
            val generation = envelope.getLong("generation")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, protection, GCMParameterSpec(128, decode(envelope.getString("nonce"))))
            cipher.updateAAD(aad(connectionId, generation))
            val plaintext = decryptCiphertext(cipher, decode(envelope.getString("ciphertext")))
            try { CredentialValue(plaintext.toString(Charsets.UTF_8), generation) }
            finally { plaintext.fill(0) }
        }
    }

    private fun metadataInside(id: String, envelope: JSONObject?): CredentialMetadata {
        if (envelope == null) return CredentialMetadata(id, "absent", 0)
        val generation = envelope.getLong("generation")
        if (envelope.getBoolean("deleted")) return CredentialMetadata(id, "absent", generation)
        val state = if (keyStore().containsAlias(envelope.getString("alias"))) "configured" else "key-missing"
        return CredentialMetadata(id, state, generation)
    }

    private fun <T> locked(action: (File) -> T): T = synchronized(processMonitor) {
        try {
            if (context.getSystemService(UserManager::class.java)?.isUserUnlocked != true) fail("waiting-first-unlock")
            // The application's default Context is CE (manifest does not opt into DP defaults).
            // Reject an explicitly device-protected context instead of writing secrets there.
            if (context.isDeviceProtectedStorage) fail("temporarily-unavailable")
            val directory = File(context.noBackupFilesDir, namespace)
            val lease = StorageDomainLease.acquire(directory) ?: fail("temporarily-unavailable")
            lease.use {
                // Persist a newly created namespace's directory entry, not only its contents.
                syncDirectory(directory.parentFile!!)
                action(directory)
            }
        } catch (error: Exception) { throw safe(error) }
    }

    private fun read(directory: File, id: String): JSONObject? {
        val file = File(directory, filename(id))
        if (!file.exists()) return null
        val json = parse(file)
        if (json.optInt("version", -1) != VERSION) fail("incompatible")
        if (json.optString("connectionId") != id) fail("corrupt")
        val generation = json.optLong("generation", -1)
        if (generation !in 1..MAX_GENERATION || json.opt("generation")?.toString() != generation.toString()) fail("corrupt")
        if (json.opt("deleted") !is Boolean) fail("corrupt")
        if (!json.getBoolean("deleted")) {
            if (!json.optString("alias").startsWith(aliasPrefix(id))) fail("corrupt")
            if (decode(json.optString("nonce")).size != 12) fail("corrupt")
            if (decode(json.optString("ciphertext")).size !in 16..MAX_ENVELOPE_BYTES) fail("corrupt")
        }
        return json
    }

    private fun parse(file: File): JSONObject {
        if (file.length() !in 1..MAX_ENVELOPE_BYTES.toLong()) fail("corrupt")
        return try { JSONObject(file.readText(Charsets.UTF_8)) }
        catch (_: org.json.JSONException) { fail("corrupt") }
    }

    private fun nextGeneration(previous: JSONObject?, expected: Long?): Long {
        val current = previous?.getLong("generation") ?: 0
        if (expected != null && expected != current) fail("generation-conflict")
        if (current >= MAX_GENERATION) fail("incompatible")
        return current + 1
    }

    /** Checked equivalent of write/sync/rename. Android AtomicFile only logs some sync failures. */
    private fun persist(directory: File, id: String, json: JSONObject, renamed: () -> Unit) {
        val destination = File(directory, filename(id))
        val staging = File(directory, destination.name + ".new")
        try {
            FileOutputStream(staging).use { it.write(json.toString().toByteArray(Charsets.UTF_8)); it.fd.sync() }
            Os.rename(staging.absolutePath, destination.absolutePath)
            renamed()
            syncDirectory(directory)
        } finally { staging.delete() }
    }

    private fun deleteRetiredKey(store: KeyStore, previous: JSONObject?) {
        if (previous != null && !previous.getBoolean("deleted")) {
            try { store.deleteEntry(previous.getString("alias")) } catch (_: Exception) { }
        }
    }
    private fun syncDirectory(directory: File) {
        val descriptor = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0)
        try { Os.fsync(descriptor) } finally { Os.close(descriptor) }
    }
    private fun aliasPrefix(id: String) = "durableagent.vault.${digest(namespace)}.${digest(id)}."
    private fun filename(id: String) = digest(id) + ".json"
    private fun aad(id: String, generation: Long) = "durableagent-vault|$VERSION|$generation|$id".toByteArray(Charsets.UTF_8)
    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    companion object {
        private const val VERSION = 1
        private const val MAX_KEY_CHARS = 16_384
        private const val MAX_ENVELOPE_BYTES = 100_000
        private const val MAX_GENERATION = 9_007_199_254_740_991L
        private val processMonitor = Any()
        private fun fail(code: String): Nothing = throw CredentialVaultException(code)
        private fun validateId(id: String) {
            if (!id.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}"))) fail("invalid-input")
        }
        private fun digest(value: String) = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
        private fun decode(value: String): ByteArray = try { Base64.decode(value, Base64.NO_WRAP) }
            catch (_: IllegalArgumentException) { fail("corrupt") }
        private fun safe(error: Exception): CredentialVaultException {
            if (error is CredentialVaultException) return error
            // ProviderException may wrap the platform's stable authentication/key failure types.
            val causes = generateSequence(error as Throwable?) { it.cause }.take(8).toList()
            return CredentialVaultException(when {
                causes.any { it is KeyPermanentlyInvalidatedException } -> "permanently-invalidated"
                causes.any { it is AEADBadTagException || it is BadPaddingException } -> "corrupt"
                else -> "temporarily-unavailable"
            })
        }
    }
}
