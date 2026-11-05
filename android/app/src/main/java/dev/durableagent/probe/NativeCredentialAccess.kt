package dev.durableagent.probe

import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject

/**
 * This capability is bindable only to the trusted Node host. Never bind this object to
 * WebView or expose resolveJson through the ordinary Application Interface. The native UI write
 * route checks its immutable connection target and readiness before calling saveJson/removeJson.
 */
class NativeCredentialAccess(private val vault: CredentialVault,private val openAuthUrl:((String)->Unit)?=null) : AutoCloseable {
    private val mutations = mutableMapOf<String, Pair<String,StorageDomainLease>>()
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

    /** The returned key exists only in authorized request-time memory, never durable SDK options. */
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
        val metadata = vault.acquireMutation(connectionId).use { vault.save(connectionId, key, expectedGeneration) }
        observedFailures.remove(connectionId)
        metadata.toJson()
    }

    @Synchronized
    fun removeJson(connectionId: String, expectedGeneration: Long): String = result {
        val metadata = vault.acquireMutation(connectionId).use { vault.remove(connectionId, expectedGeneration) }
        observedFailures.remove(connectionId)
        metadata.toJson()
    }

    @Synchronized @V8Function fun acquireMutationJson(connectionId:String):String = result {
        val lease=vault.acquireMutation(connectionId);val token=java.util.UUID.randomUUID().toString()
        mutations[token]=connectionId to lease;JSONObject().put("lease",token)
    }
    @Synchronized @V8Function fun releaseMutationJson(connectionId:String,token:String):String = result {
        val held=mutations[token] ?: throw CredentialVaultException("invalid-input")
        if(held.first!=connectionId)throw CredentialVaultException("invalid-input")
        mutations.remove(token);held.second.close();JSONObject()
    }
    @Synchronized @V8Function fun saveManagedJson(connectionId:String,secret:String,generation:Long,token:String):String = result {
        if(mutations[token]?.first!=connectionId)throw CredentialVaultException("invalid-input")
        val payload=JSONObject(secret)
        if(payload.optString("format")!="durableagent-sdk-credential"||payload.optInt("version")!=1||payload.optJSONObject("credential")?.optString("type") !in setOf("api_key","oauth"))throw CredentialVaultException("invalid-input")
        val saved=vault.save(connectionId,secret,generation);observedFailures.remove(connectionId);saved.toJson()
    }
    @Synchronized @V8Function fun deviceIdJson():String = result { JSONObject().put("id",vault.deviceId()) }
    @V8Function fun openAuthUrlJson(url:String):String = result {
        val uri=android.net.Uri.parse(url)
        if(url.length>8192||uri.scheme!="https"||uri.host.isNullOrEmpty()||uri.userInfo!=null||openAuthUrl==null)throw CredentialVaultException("invalid-input")
        openAuthUrl.invoke(url);JSONObject()
    }
    @Synchronized override fun close(){mutations.values.forEach{it.second.close()};mutations.clear()}

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
