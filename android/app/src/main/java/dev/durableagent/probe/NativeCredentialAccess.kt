package dev.durableagent.probe

import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject

/**
 * Only metadataJson/resolveJson are bindable to the trusted Node host. Never bind this object to
 * WebView or expose resolveJson through the ordinary Application Interface. The native UI write
 * route checks its immutable connection target and readiness before calling saveJson/removeJson.
 */
class NativeCredentialAccess(private val vault: CredentialVault) {
    private data class ObservedFailure(val revision: String, val generation: Long, val state: String)
    private val observedFailures = mutableMapOf<String, ObservedFailure>()

    @Synchronized
    @V8Function
    fun metadataJson(connectionId: String): String = result {
        val metadata = vault.metadata(connectionId)
        val observed = observedFailures[connectionId]
        if (observed == null || metadata.state != "configured") metadata.toJson()
        else if (metadata.generation == observed.generation && vault.revision(connectionId) == observed.revision)
            metadata.copy(state = observed.state).toJson()
        else { observedFailures.remove(connectionId); metadata.toJson() }
    }

    /** The returned key exists only in authorized request-time memory, never SDK options. */
    @Synchronized
    @V8Function
    fun resolveJson(connectionId: String): String = result {
        val before = vault.metadata(connectionId)
        val revision = vault.revision(connectionId)
        try {
            val value = vault.resolve(connectionId)
            observedFailures.remove(connectionId)
            JSONObject().put("key", value.key).put("generation", value.generation)
        } catch (error: CredentialVaultException) {
            if (error.code in setOf("corrupt", "permanently-invalidated") && revision != null) {
                // Do not attribute a failure on an old ciphertext to a concurrent replacement.
                val currentRevision = try { vault.revision(connectionId) } catch (_: CredentialVaultException) { null }
                if (currentRevision == revision)
                    observedFailures[connectionId] = ObservedFailure(revision, before.generation, error.code)
            }
            throw error
        }
    }

    // Deliberately not @V8Function: plaintext writes never enter generic Node Application.request.
    @Synchronized
    fun saveJson(connectionId: String, key: String, expectedGeneration: Long): String = result {
        val metadata = vault.save(connectionId, key, expectedGeneration)
        observedFailures.remove(connectionId)
        metadata.toJson()
    }

    @Synchronized
    fun removeJson(connectionId: String, expectedGeneration: Long): String = result {
        val metadata = vault.remove(connectionId, expectedGeneration)
        observedFailures.remove(connectionId)
        metadata.toJson()
    }

    private fun result(action: () -> JSONObject): String = try {
        JSONObject().put("ok", true).put("value", action()).toString()
    } catch (error: CredentialVaultException) {
        JSONObject().put("ok", false).put("error", JSONObject().put("code", error.code).put("message", error.message)).toString()
    } catch (_: Exception) {
        // Never serialize unexpected platform errors, messages, causes or supplied input.
        val error = CredentialVaultException("temporarily-unavailable")
        JSONObject().put("ok", false).put("error", JSONObject().put("code", error.code).put("message", error.message)).toString()
    }
}
