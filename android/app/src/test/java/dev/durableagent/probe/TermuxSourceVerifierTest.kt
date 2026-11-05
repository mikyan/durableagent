package dev.durableagent.probe

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Installed-artifact source contract; capability/runtime behavior remains a device test. */
class TermuxSourceVerifierTest {
    @get:Rule val folder = TemporaryFolder()
    private val universal = TermuxArtifact("0.118.3", "7600078440c3c34ef050bc009b00fc3215cb87ec4a449e01a696f74cf4249db2", TermuxSourceVerifier.GITHUB_SIGNER)

    @Test fun anotherOfficialApkCanBeVerifiedThenReopenedOfflineWithoutRepeatingTheNetworkRequest() {
        val cache = folder.newFolder().resolve("proof")
        val requests = mutableListOf<String>()
        val verifier = TermuxSourceVerifier(cache, { url, _ ->
            requests += url
            "7600078440c3c34ef050bc009b00fc3215cb87ec4a449e01a696f74cf4249db2  termux-app_v0.118.3+github-debug_universal.apk\n"
        })
        val error = assertThrows(ExecutionChannelException::class.java) { verifier.requireTrusted(universal, false) }
        assertEquals("TERMUX_SOURCE_UNVERIFIED", error.code)
        assertTrue(requests.isEmpty())
        verifier.requireTrusted(universal, true)
        assertEquals(listOf("https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_sha256sums"), requests)
        TermuxSourceVerifier(cache, { _, _ -> fail("Verified bytes must reopen without networking"); null }).requireTrusted(universal, false)
    }

    @Test fun anApkUpdateCannotReuseTheOldSourceProofOrCauseAnOfflineNetworkRequest() {
        val cache = folder.newFolder().resolve("proof")
        val verifier = TermuxSourceVerifier(cache, { url, _ -> if(url.contains("%2Bgithub-debug")) "${universal.apkSha256}  termux-app_v0.118.3+github-debug_universal.apk\n" else null })
        verifier.requireTrusted(universal, true)
        val updated = universal.copy(apkSha256 = "a".repeat(64))
        val offline = TermuxSourceVerifier(cache, { _, _ -> fail("Background recovery must stay offline"); null })
        assertEquals("TERMUX_SOURCE_UNVERIFIED", assertThrows(ExecutionChannelException::class.java) { offline.requireTrusted(updated, false) }.code)
        assertEquals("TERMUX_SOURCE_UNVERIFIED", assertThrows(ExecutionChannelException::class.java) { verifier.requireTrusted(updated, true) }.code)
        offline.requireTrusted(universal, false)
    }

    @Test fun newerOfficialChecksumNamingWorksWithoutAMatchingHardcodedVersion() {
        val artifact = TermuxArtifact("0.119.0-beta.3", "ecf7b280268ae6963876f5663ed7a00622e458c0425bb41f0ab8e1998bfbbac5", TermuxSourceVerifier.GITHUB_SIGNER)
        val requests = mutableListOf<String>()
        val verifier = TermuxSourceVerifier(folder.newFolder().resolve("proof"), { url, _ ->
            requests += url
            if (url.contains("%2Bgithub-debug")) null else "${artifact.apkSha256}  termux-app_v0.119.0-beta.3+apt-android-7-github-debug_x86_64.apk\n"
        })
        verifier.requireTrusted(artifact, true)
        assertEquals(2, requests.size)
        assertEquals("https://github.com/termux/termux-app/releases/download/v0.119.0-beta.3/termux-app_v0.119.0-beta.3%2Bapt-android-7-github-debug_sha256sums", requests.last())
    }

    @Test fun fdroidPrivateSignerIsIndependentOfTheGithubPublicTestSigner() {
        val verifier = TermuxSourceVerifier(folder.newFolder().resolve("proof"), { _, _ -> fail("F-Droid identity must not need GitHub"); null })
        verifier.requireTrusted(universal.copy(versionName = "0.119.0-beta.3", signerSha256 = TermuxSourceVerifier.FDROID_SIGNER), false)
        assertEquals("TERMUX_SOURCE_UNSUPPORTED", assertThrows(ExecutionChannelException::class.java) {
            verifier.requireTrusted(universal.copy(signerSha256 = "e".repeat(64)), true)
        }.code)
        assertEquals("TERMUX_SOURCE_UNSUPPORTED", assertThrows(ExecutionChannelException::class.java) {
            verifier.requireTrusted(universal.copy(signerSha256 = TermuxSourceVerifier.FDROID_SIGNER, hasSplits = true), true)
        }.code)
    }

    @Test fun officialDocumentMustBeCompleteAndUnambiguousBeforeItCanAuthorizeAnyHash() {
        val valid = "${universal.apkSha256}  termux-app_v0.118.3+github-debug_universal.apk\n"
        for (body in listOf("", valid + valid, valid + "malformed\n", valid.replace("universal.apk", "../universal.apk"), valid.replace("v0.118.3", "v0.119.0"), valid + " ".repeat(32768))) {
            val cache = folder.newFolder().resolve("proof")
            val verifier = TermuxSourceVerifier(cache, { _, _ -> body })
            assertEquals("TERMUX_SOURCE_UNAVAILABLE", assertThrows(ExecutionChannelException::class.java) { verifier.requireTrusted(universal, true) }.code)
            assertFalse(cache.exists())
        }
    }

    @Test fun unavailableOrLateProofIsNotSavedAndDoesNotAuthorizeBackgroundRecovery() {
        val cache = folder.newFolder().resolve("proof")
        val unavailable = TermuxSourceVerifier(cache, { _, _ -> throw java.io.IOException("offline") })
        assertEquals("TERMUX_SOURCE_UNAVAILABLE", assertThrows(ExecutionChannelException::class.java) { unavailable.requireTrusted(universal, true) }.code)
        var time = 0L
        val late = TermuxSourceVerifier(cache, { _, _ ->
            time = 15001
            "${universal.apkSha256}  termux-app_v0.118.3+github-debug_universal.apk\n"
        }, { time })
        assertEquals("TERMUX_SOURCE_UNAVAILABLE", assertThrows(ExecutionChannelException::class.java) { late.requireTrusted(universal, true) }.code)
        assertFalse(cache.exists())
    }

    @Test fun checksumDownloadRejectsArbitraryOrDowngradedLocationsBeforeConnecting() {
        for (url in listOf("http://github.com/termux/termux-app/releases/download/v0.118.3/x", "https://evil.example/test", "https://github.com/another/repo/releases/download/v0.118.3/x")) {
            assertThrows(java.io.IOException::class.java) { TermuxChecksumDownload.read(url, 1000) }
        }
    }

    @Test(timeout=5000) fun aBlockedDownloadCannotHoldTheCallerPastItsBudgetOrSaveALateProof() {
        val cache = folder.newFolder().resolve("proof")
        val release = java.util.concurrent.CountDownLatch(1)
        val finished = java.util.concurrent.CountDownLatch(1)
        val verifier = TermuxSourceVerifier(cache, { _, _ ->
            // Model a native resolver that does not stop on thread interruption.
            val delayedUntil = System.nanoTime() + 2_000_000_000
            while (release.count != 0L && System.nanoTime() < delayedUntil)
                try { release.await(100, java.util.concurrent.TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { }
            finished.countDown()
            "${universal.apkSha256}  termux-app_v0.118.3+github-debug_universal.apk\n"
        }, sourceBudgetMs = 50)
        val started = System.nanoTime()
        try {
            assertEquals("TERMUX_SOURCE_UNAVAILABLE", assertThrows(ExecutionChannelException::class.java) { verifier.requireTrusted(universal, true) }.code)
            assertTrue("The blocked source must not occupy the caller", (System.nanoTime() - started) / 1_000_000 < 1500)
            assertFalse(cache.exists())
        } finally { release.countDown() }
        assertTrue(finished.await(1, java.util.concurrent.TimeUnit.SECONDS))
        assertFalse(cache.exists())
    }
}
