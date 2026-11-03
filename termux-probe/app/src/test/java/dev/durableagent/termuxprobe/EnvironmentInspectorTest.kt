package dev.durableagent.termuxprobe

import org.junit.Assert.*
import org.junit.Test

class EnvironmentInspectorTest {
    private val installed = PlatformFacts(installed = true, trusted = true, permission = true, uid = 10234)
    private val goodOutput = "protocol=1\nnonce=challenge\nuid=10234\ninstance=423\nprefix=/data/data/com.termux/files/usr\nshell=5.2.37\ntools=ok\nworkspace=/data/data/com.termux/files/home/.local/share/durableagent-probe/workspace\nwritable=yes\nrepo_begin=1\ndeb https://packages.termux.dev/apt/termux-main stable main\nrepo_end=1\n"
    @Test fun missingInstallationIsActionableAndNeverReady() {
        val inspector = EnvironmentInspector()
        val result = inspector.inspect(PlatformFacts(installed = false), "request-1", 100)
        assertEquals(Phase.INSTALL_REQUIRED, result.phase)
        assertNull(result.request)
        assertEquals(Fact.UNKNOWN, result.bootstrap)
    }

    @Test fun platformPreconditionsHaveDistinctRemedies() {
        val inspector = EnvironmentInspector()
        assertEquals(Phase.UNTRUSTED_INSTALL, inspector.inspect(installed.copy(trusted = false), "a", 0).phase)
        assertEquals(Phase.PERMISSION_REQUIRED, inspector.inspect(installed.copy(permission = false), "b", 0).phase)
        assertEquals(Phase.FORCE_STOPPED, inspector.inspect(installed.copy(stopped = true), "c", 0).phase)
        assertEquals(Phase.CHECKING, inspector.inspect(installed, "d", 0).phase)
    }

    @Test fun checkingCoalescesClicksAndTimesOutWithoutInventingCause() {
        val inspector = EnvironmentInspector()
        val first = inspector.inspect(installed, "first", 100)
        assertEquals(first, inspector.inspect(installed, "second", 200))
        assertEquals(Phase.CHECKING, inspector.expire(20_099).phase)
        assertEquals(Phase.UNKNOWN_TIMEOUT, inspector.expire(20_100).phase)
        assertEquals("retry", inspector.inspect(installed, "retry", 20_101).request?.nonce)
    }

    @Test fun readyRequiresAuthenticatedCompleteExecutionEvidence() {
        val inspector = EnvironmentInspector()
        inspector.inspect(installed, "challenge", 100)
        val result = inspector.complete("challenge", ProbeResult(goodOutput), installed, 300)
        assertEquals(Phase.READY, result.phase)
        assertEquals(Fact.VERIFIED, result.bootstrap)
        assertEquals(Fact.VERIFIED, result.externalCalls)
        assertEquals(Fact.VERIFIED, result.protocol)
        assertTrue(result.evidence.contains("instance=423"))
    }

    @Test fun neverAcceptsStaleOrRevokedOrIncompleteProof() {
        val inspector = EnvironmentInspector()
        val checking = inspector.inspect(installed, "challenge", 100)
        assertEquals(checking, inspector.complete("old", ProbeResult(goodOutput), installed, 200))
        assertEquals(Phase.PERMISSION_REQUIRED, inspector.complete("challenge", ProbeResult(goodOutput), installed.copy(permission = false), 300).phase)
        for (result in listOf(ProbeResult(goodOutput, truncated = true), ProbeResult(goodOutput, exitCode = 1), ProbeResult(goodOutput.replace("uid=10234", "uid=2")), ProbeResult(goodOutput + "uid=10234\n"), ProbeResult(goodOutput.replace("tools=ok\n", "")))) {
            inspector.inspect(installed, "challenge", 400)
            assertEquals(Phase.INVALID_RESPONSE, inspector.complete("challenge", result, installed, 500).phase)
        }
        inspector.inspect(installed, "challenge", 600)
        val timedOut = inspector.expire(20_600)
        assertEquals(timedOut, inspector.complete("challenge", ProbeResult(goodOutput), installed, 20_601))
    }

    @Test fun knownFailuresRemainDistinctFromUnknownTimeout() {
        val inspector = EnvironmentInspector()
        for ((response, phase) in listOf(
            ProbeResult("", error = 1, errorMessage = "RunCommandService requires `allow-external-apps` to be true") to Phase.EXTERNAL_CALLS_DISABLED,
            ProbeResult("status=setup-required\n", exitCode = 78) to Phase.SETUP_REQUIRED,
            ProbeResult(goodOutput.replace("protocol=1", "protocol=2")) to Phase.PROTOCOL_MISMATCH,
            ProbeResult("busy=1\n", exitCode = 75) to Phase.BUSY
        )) {
            inspector.inspect(installed, "challenge", 100)
            assertEquals(phase, inspector.complete("challenge", response, installed, 200).phase)
        }
        inspector.inspect(installed, "challenge", 300)
        assertEquals(Phase.START_RESTRICTED, inspector.dispatchFailed("challenge", Phase.START_RESTRICTED, "platform forbids start").phase)
    }

    @Test fun pinnedTermuxWireUsesResultOkMinusOneAndStringLengths() {
        val wire = mapOf("stdout" to goodOutput, "stderr" to "", "stdout_original_length" to goodOutput.length.toString(), "stderr_original_length" to "0", "exitCode" to 0, "err" to -1, "errmsg" to "")
        val inspector = EnvironmentInspector()
        inspector.inspect(installed, "challenge", 100)
        assertEquals(Phase.READY, inspector.complete("challenge", decodeTermuxResult(wire), installed, 200).phase)
        inspector.inspect(installed, "challenge", 300)
        assertEquals(Phase.INVALID_RESPONSE, inspector.complete("challenge", decodeTermuxResult(wire + ("stdout_original_length" to "99999")), installed, 400).phase)
        inspector.inspect(installed, "challenge", 500)
        assertEquals(Phase.INVALID_RESPONSE, inspector.complete("challenge", decodeTermuxResult(wire - "err"), installed, 600).phase)
    }

    @Test fun failureToReadFreshPlatformFactsCannotRetainEarlierReadiness() {
        val inspector = EnvironmentInspector()
        inspector.inspect(installed, "challenge", 100)
        assertEquals(Phase.READY, inspector.complete("challenge", ProbeResult(goodOutput), installed, 200).phase)
        val result = inspector.platformCheckFailed("package changed during verification")
        assertEquals(Phase.PLATFORM_CHECK_FAILED, result.phase)
        assertEquals(Fact.UNKNOWN, result.bootstrap)
        assertNull(result.request)
    }
}
