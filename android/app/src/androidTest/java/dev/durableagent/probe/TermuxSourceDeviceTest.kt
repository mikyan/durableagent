package dev.durableagent.probe

import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.system.ErrnoException
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/** Explicit live-source diagnosis only. No production proof, pairing or Termux command is changed. */
@RunWith(AndroidJUnit4::class)
class TermuxSourceDeviceTest {
    private fun safeReason(error: Throwable): String = when (error) {
        is ExecutionChannelException -> when (error.code) {
            "TERMUX_SOURCE_UNVERIFIED" -> "SOURCE_UNVERIFIED"
            "TERMUX_SOURCE_UNAVAILABLE" -> "SOURCE_UNAVAILABLE"
            "TERMUX_SOURCE_UNSUPPORTED" -> "SOURCE_UNSUPPORTED"
            "CHANNEL_CLOSED" -> "CHANNEL_CLOSED"
            else -> "CHANNEL_FAILURE"
        }
        is UnknownHostException -> "DNS_FAILURE"
        is SocketTimeoutException -> "IO_TIMEOUT"
        is SSLHandshakeException -> "TLS_HANDSHAKE_FAILURE"
        is SSLPeerUnverifiedException -> "TLS_PEER_UNVERIFIED"
        is SSLException -> "TLS_FAILURE"
        is ConnectException -> "CONNECT_FAILURE"
        is NoRouteToHostException -> "ROUTE_UNAVAILABLE"
        is ErrnoException -> "OS_ERRNO_${error.errno}"
        else -> when (error.message) {
            "Invalid source location" -> "INVALID_LOCATION"
            "Unsupported source location" -> "LOCATION_REJECTED"
            "Source check interrupted" -> "INTERRUPTED"
            "Source check expired" -> "DEADLINE"
            "Unsupported source redirect" -> "REDIRECT_REJECTED"
            "Too many source redirects" -> "REDIRECT_LIMIT"
            "Missing source redirect" -> "REDIRECT_MISSING"
            "Invalid source redirect" -> "REDIRECT_INVALID"
            "Oversized source document" -> "BODY_LIMIT"
            "Invalid source encoding" -> "BODY_ENCODING"
            "Source check incomplete" -> "INCOMPLETE"
            "Source check busy" -> "WORKER_BUSY"
            else -> Regex("Source response unavailable: ([0-9]{3})").matchEntire(error.message.orEmpty())?.let { "HTTP_${it.groupValues[1]}" } ?: "UNCLASSIFIED"
        }
    }

    private fun safeErrors(error: Throwable): JSONArray {
        val values = JSONArray()
        var current: Throwable? = error
        repeat(4) {
            val item = current ?: return values
            // Never include exception messages, stack traces, URLs, headers or downloaded text.
            values.put(JSONObject().put("class", item.javaClass.name).put("reason", safeReason(item)))
            current = item.cause?.takeUnless { it === item }
        }
        return values
    }

    @Test(timeout = 20_000) fun verifiesInstalledOfficialArtifactOnlineThenReusesOnlyItsOwnOfflineProof() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("termuxSourceOnline") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val started = SystemClock.elapsedRealtime()
        fun evidence(stage: String, fields: JSONObject = JSONObject()) {
            fields.put("stage", stage).put("elapsedMs", SystemClock.elapsedRealtime() - started)
            instrumentation.sendStatus(0, Bundle().apply { putString("termuxSourceDiagnostic", fields.toString()) })
        }
        var directory: File? = null
        var stage = "installed_artifact"
        try {
            val info = context.packageManager.getPackageInfo("com.termux", PackageManager.GET_SIGNING_CERTIFICATES)
            val app = requireNotNull(info.applicationInfo)
            val signers = info.signingInfo?.apkContentsSigners.orEmpty()
            assertEquals("Expected one installed signer", 1, signers.size)
            val digest = MessageDigest.getInstance("SHA-256")
            File(app.sourceDir).inputStream().use { input ->
                val buffer = ByteArray(65_536)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
            }
            val artifact = TermuxArtifact(info.versionName.orEmpty(), digest.digest().joinToString("") { "%02x".format(it) },
                ExecutionIdentity.sha256(signers.single().toByteArray()), hasSplits = !app.splitSourceDirs.isNullOrEmpty())
            assertEquals("This opt-in test targets an official GitHub artifact", TermuxSourceVerifier.GITHUB_SIGNER, artifact.signerSha256)
            evidence(stage)
            directory = Files.createTempDirectory(context.cacheDir.toPath(), "termux-source-device-").toFile()
            val cache = File(directory, "proof")
            val requests = AtomicInteger()
            val verifier = TermuxSourceVerifier(cache, { url, budget ->
                val family = if (url.contains("%2Bapt-android-7-github-debug_")) "APT_ANDROID_7" else "LEGACY"
                val fetchStarted = SystemClock.elapsedRealtime()
                requests.incrementAndGet()
                evidence("download_start", JSONObject().put("family", family).put("budgetMs", budget))
                try {
                    TermuxChecksumDownload.read(url, budget).also { document ->
                        evidence("download_return", JSONObject().put("family", family).put("outcome", if (document == null) "NOT_FOUND" else "DOCUMENT")
                            .put("fetchElapsedMs", SystemClock.elapsedRealtime() - fetchStarted))
                    }
                } catch (error: Throwable) {
                    evidence("download_error", JSONObject().put("family", family).put("errors", safeErrors(error))
                        .put("fetchElapsedMs", SystemClock.elapsedRealtime() - fetchStarted))
                    throw error
                }
            })
            stage = "online_authorization"
            verifier.requireTrusted(artifact, allowOnline = true)
            assertTrue("Installed artifact must exercise the live source path", requests.get() > 0)
            assertEquals("Successful verification writes only the test's exact-artifact proof", 67L, cache.length())
            evidence(stage, JSONObject().put("outcome", "VERIFIED").put("requests", requests.get()))
            stage = "offline_authorization"
            TermuxSourceVerifier(cache, { _, _ -> fail("Offline proof must not make a network request"); null }).requireTrusted(artifact, allowOnline = false)
            evidence(stage, JSONObject().put("outcome", "VERIFIED"))
        } catch (error: Throwable) {
            evidence(stage, JSONObject().put("outcome", "FAILED").put("errors", safeErrors(error)))
            // Do not let JUnit serialize a network exception containing a signed redirect URL.
            fail("Termux source diagnosis failed at $stage; see safe termuxSourceDiagnostic events")
        } finally {
            directory?.let { File(it, "proof").delete(); it.delete() }
        }
    }
}
