package dev.durableagent.termuxprobe

enum class Fact { UNKNOWN, VERIFIED, FAILED }
enum class Phase { UNCHECKED, INSTALL_REQUIRED, UNTRUSTED_INSTALL, PERMISSION_REQUIRED, FORCE_STOPPED, CHECKING, UNKNOWN_TIMEOUT, READY, INVALID_RESPONSE, EXTERNAL_CALLS_DISABLED, SETUP_REQUIRED, PROTOCOL_MISMATCH, BUSY, START_RESTRICTED, DISPATCH_FAILED, PLATFORM_CHECK_FAILED }
data class PlatformFacts(val installed: Boolean, val trusted: Boolean = false, val permission: Boolean = false, val stopped: Boolean = false, val uid: Int = -1)
data class ProbeRequest(val nonce: String, val startedAt: Long, val unavailableStarts: Int = 0)
data class ProbeResult(val stdout: String, val stderr: String = "", val exitCode: Int = 0, val error: Int = -1, val errorMessage: String = "", val truncated: Boolean = false)
data class Inspection(val phase: Phase, val request: ProbeRequest? = null, val bootstrap: Fact = Fact.UNKNOWN, val externalCalls: Fact = Fact.UNKNOWN, val protocol: Fact = Fact.UNKNOWN, val evidence: String = "", val retryAfterMillis: Long? = null)

/** High-level inspection seam. Platform observations are facts, never saved ready flags. */
class EnvironmentInspector {
    var state = Inspection(Phase.UNCHECKED)
        private set

    @Synchronized fun inspect(facts: PlatformFacts, nonce: String, now: Long): Inspection {
        val precondition = when {
            !facts.installed -> Phase.INSTALL_REQUIRED
            !facts.trusted -> Phase.UNTRUSTED_INSTALL
            !facts.permission -> Phase.PERMISSION_REQUIRED
            facts.stopped -> Phase.FORCE_STOPPED
            else -> null
        }
        if (precondition != null) return Inspection(precondition).also { state = it }
        expire(now)
        if (state.phase == Phase.CHECKING) return state
        state = Inspection(Phase.CHECKING, ProbeRequest(nonce, now))
        return state
    }

    @Synchronized fun expire(now: Long): Inspection {
        if (state.phase == Phase.CHECKING && now - state.request!!.startedAt >= 20_000)
            state = Inspection(Phase.UNKNOWN_TIMEOUT)
        return state
    }

    @Synchronized fun complete(nonce: String, result: ProbeResult, facts: PlatformFacts, now: Long): Inspection {
        expire(now)
        val request = state.request ?: return state
        if (request.nonce != nonce) return state
        if (!facts.installed || !facts.trusted || !facts.permission || facts.stopped) return inspect(facts, nonce, now)
        val fields = result.stdout.lines().filter { '=' in it }
        val values = fields.associate { it.substringBefore('=') to it.substringAfter('=') }
        val knownFailure = when {
            result.error != -1 && result.errorMessage.contains("allow-external-apps") -> Phase.EXTERNAL_CALLS_DISABLED
            result.exitCode == 78 && result.stdout == "status=setup-required\n" -> Phase.SETUP_REQUIRED
            result.exitCode == 75 && result.stdout == "busy=1\n" -> Phase.BUSY
            values["nonce"] == nonce && values["protocol"] != null && values["protocol"] != "1" -> Phase.PROTOCOL_MISMATCH
            else -> null
        }
        if (knownFailure != null) {
            state = Inspection(knownFailure, externalCalls = if (knownFailure == Phase.EXTERNAL_CALLS_DISABLED) Fact.FAILED else Fact.VERIFIED, bootstrap = if (result.exitCode == 78) Fact.VERIFIED else Fact.UNKNOWN, evidence = result.toString())
            return state
        }
        val valid = fields.size == values.size && result.stdout.length <= 16_384 &&
            result.exitCode == 0 && result.error == -1 && !result.truncated &&
            values["protocol"] == "1" && values["nonce"] == nonce && values["uid"] == facts.uid.toString() &&
            values["instance"]?.toLongOrNull()?.let { it > 0 } == true &&
            values["prefix"] == "/data/data/com.termux/files/usr" && !values["shell"].isNullOrBlank() &&
            values["tools"] == "ok" && values["writable"] == "yes" &&
            values["workspace"] == "/data/data/com.termux/files/home/.local/share/durableagent-probe/workspace" &&
            values["repo_begin"] == "1" && values["repo_end"] == "1"
        state = if (valid) Inspection(Phase.READY, bootstrap = Fact.VERIFIED, externalCalls = Fact.VERIFIED, protocol = Fact.VERIFIED, evidence = result.stdout)
        else Inspection(Phase.INVALID_RESPONSE, evidence = result.toString())
        return state
    }

    @Synchronized fun dispatchFailed(nonce: String, phase: Phase, detail: String): Inspection {
        require(phase in setOf(Phase.START_RESTRICTED, Phase.PERMISSION_REQUIRED, Phase.DISPATCH_FAILED))
        if (state.request?.nonce == nonce) state = Inspection(phase, evidence = detail)
        return state
    }

    @Synchronized fun platformCheckFailed(detail: String): Inspection {
        state = Inspection(Phase.PLATFORM_CHECK_FAILED, evidence = detail)
        return state
    }

    @Synchronized fun dispatchUnavailable(nonce: String, now: Long): Inspection {
        val request = state.request ?: return state
        if (request.nonce != nonce) return state
        val delays = listOf(250L, 500L, 1000L, 1250L)
        val remaining = 3000L - (now - request.startedAt)
        if (remaining <= 0 || request.unavailableStarts >= delays.size)
            return dispatchFailed(nonce, Phase.DISPATCH_FAILED, "Android returned no service after bounded startup retries; cause unknown")
        state = state.copy(request = request.copy(unavailableStarts = request.unavailableStarts + 1),
            evidence = "Android returned no service; retrying the same inspection and callback capability",
            retryAfterMillis = minOf(delays[request.unavailableStarts], remaining))
        return state
    }
}
