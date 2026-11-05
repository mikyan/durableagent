package dev.durableagent.probe

import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.net.ssl.HttpsURLConnection

/** The installed bytes and signer are supplied by Android, never by UI or a model. */
data class TermuxArtifact(
    val versionName: String,
    val apkSha256: String,
    val signerSha256: String,
    val packageName: String = "com.termux",
    val hasSplits: Boolean = false,
)

/** Source proof only. Permission, bootstrap and authenticated execution capabilities are separate. */
class TermuxSourceVerifier(
    private val cacheFile: File,
    private val fetch: (String, Long) -> String? = TermuxChecksumDownload::read,
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
    private val sourceBudgetMs: Long = 15_000,
) {
    init { require(sourceBudgetMs in 1..15_000) }
    fun requireTrusted(artifact: TermuxArtifact, allowOnline: Boolean) {
        if (artifact.packageName != "com.termux" || artifact.hasSplits || !HASH.matches(artifact.apkSha256)) fail("TERMUX_SOURCE_UNSUPPORTED")
        if (artifact.signerSha256 == FDROID_SIGNER) return
        if (artifact.signerSha256 != GITHUB_SIGNER) fail("TERMUX_SOURCE_UNSUPPORTED")
        if (artifact.apkSha256 in KNOWN_GITHUB_APKS || cached(artifact)) return
        if (!allowOnline) fail("TERMUX_SOURCE_UNVERIFIED")
        if (!VERSION.matches(artifact.versionName) || artifact.versionName.length > 80) fail("TERMUX_SOURCE_UNVERIFIED")
        val deadline = clock() + sourceBudgetMs
        var unavailable = false
        for (family in FAMILIES) {
            val url = checksumUrl(artifact.versionName, family)
            val remaining = remaining(deadline)
            val body = try { fetchWithin(url, remaining) } catch (_: java.io.IOException) { unavailable = true; continue }
            remaining(deadline)
            if (body == null) continue
            if (matchesChecksum(body, artifact, family)) {
                save(artifact)
                return
            }
        }
        fail(if (unavailable) "TERMUX_SOURCE_UNAVAILABLE" else "TERMUX_SOURCE_UNVERIFIED")
    }

    private fun fetchWithin(url: String, budgetMs: Long): String? {
        // Native DNS is not always interruptible. A fixed, non-queueing pool bounds
        // abandoned resolver work; a late result can never write a source proof.
        val future = try { downloads.submit(Callable { fetch(url, budgetMs) }) }
        catch (_: RejectedExecutionException) { throw IOException("Source check busy") }
        try { return future.get(budgetMs, TimeUnit.MILLISECONDS) }
        catch (_: TimeoutException) { future.cancel(true); throw IOException("Source check expired") }
        catch (_: InterruptedException) { future.cancel(true); Thread.currentThread().interrupt(); fail("CHANNEL_CLOSED") }
        catch (error: ExecutionException) { throw IOException("Source check unavailable", error.cause) }
    }

    private fun remaining(deadline: Long): Long {
        if (Thread.currentThread().isInterrupted) fail("CHANNEL_CLOSED")
        return (deadline - clock()).also { if (it <= 0) fail("TERMUX_SOURCE_UNAVAILABLE") }
    }

    private fun matchesChecksum(body: String, artifact: TermuxArtifact, family: String): Boolean {
        if (body.toByteArray(Charsets.UTF_8).size > MAX_CHECKSUM_BYTES) fail("TERMUX_SOURCE_UNAVAILABLE")
        val files = linkedMapOf<String, String>()
        val filename = Regex("termux-app_v${Regex.escape(artifact.versionName)}\\+${Regex.escape(family)}_(?:arm64-v8a|armeabi-v7a|x86|x86_64|universal)\\.apk")
        for (line in body.lineSequence().filter { it.isNotEmpty() }) {
            val match = CHECKSUM.matchEntire(line) ?: fail("TERMUX_SOURCE_UNAVAILABLE")
            val hash = match.groupValues[1].lowercase()
            val name = match.groupValues[2]
            if (!filename.matches(name) || files.put(name, hash) != null || files.size > 32) fail("TERMUX_SOURCE_UNAVAILABLE")
        }
        if (files.isEmpty()) fail("TERMUX_SOURCE_UNAVAILABLE")
        return artifact.apkSha256 in files.values
    }

    private fun key(artifact: TermuxArtifact): String = MessageDigest.getInstance("SHA-256")
        .digest(listOf(artifact.packageName, artifact.versionName, artifact.signerSha256, artifact.apkSha256).joinToString("\u0000").toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun cached(artifact: TermuxArtifact): Boolean = try {
        !Files.isSymbolicLink(cacheFile.toPath()) && cacheFile.isFile && cacheFile.length() == 67L && cacheFile.readText(Charsets.US_ASCII) == "1\n${key(artifact)}\n"
    } catch (_: Exception) { false }

    private fun save(artifact: TermuxArtifact) {
        val parent = cacheFile.parentFile ?: fail("TERMUX_SOURCE_UNAVAILABLE")
        if ((!parent.isDirectory && !parent.mkdirs()) || Files.isSymbolicLink(cacheFile.toPath())) fail("TERMUX_SOURCE_UNAVAILABLE")
        val temporary = File(parent, ".termux-source-${UUID.randomUUID()}.tmp")
        try {
            if (!temporary.createNewFile()) fail("TERMUX_SOURCE_UNAVAILABLE")
            FileOutputStream(temporary).use { output -> output.write("1\n${key(artifact)}\n".toByteArray(Charsets.US_ASCII)); output.fd.sync() }
            Files.move(temporary.toPath(), cacheFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.io.IOException) { fail("TERMUX_SOURCE_UNAVAILABLE") }
        finally { temporary.delete() }
    }

    companion object {
        // Official TermuxConstants at 5b657c6adf4304e5198951ce815fe0205dcac29c.
        // GitHub's public test certificate requires an independent complete-APK source proof.
        const val GITHUB_SIGNER = "b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1"
        const val FDROID_SIGNER = "228fb2cfe90831c1499ec3ccaf61e96e8e1ce70766b9474672ce427334d41c42"
        const val MAX_CHECKSUM_BYTES = 32_768
        private val HASH = Regex("[0-9a-f]{64}")
        private val VERSION = Regex("[0-9]+(?:\\.[0-9]+){1,3}(?:[-.][0-9A-Za-z]+)*")
        private val CHECKSUM = Regex("([0-9a-fA-F]{64})[ \\t]+\\*?([^\\s]+)")
        private val FAMILIES = listOf("github-debug", "apt-android-7-github-debug")
        private val downloads = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, SynchronousQueue(),
            { task -> Thread(task, "TermuxSourceDownload").apply { isDaemon = true } }, ThreadPoolExecutor.AbortPolicy())
        private val KNOWN_GITHUB_APKS = setOf(
            "72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e",
            "3550e61f4d9eb49b712fd1bd9519dc37085a4d8eb597c57a340f0a64859b7144",
        )
        private fun checksumUrl(version: String, family: String) = "https://github.com/termux/termux-app/releases/download/v$version/termux-app_v$version%2B${family}_sha256sums"
        private fun fail(code: String): Nothing = throw ExecutionChannelException(code)
    }
}

/** Only official release checksum documents; downloaded text is never executed. */
object TermuxChecksumDownload {
    fun read(url: String, budgetMs: Long): String? {
        var location = try { URI(url) } catch (_: Exception) { throw IOException("Invalid source location") }
        if (!initialLocation(location) || budgetMs !in 1..15_000) throw IOException("Unsupported source location")
        val deadline = System.nanoTime() / 1_000_000 + budgetMs
        fun remaining(): Int {
            if (Thread.currentThread().isInterrupted) throw IOException("Source check interrupted")
            return (deadline - System.nanoTime() / 1_000_000).coerceAtMost(3000).toInt().also { if (it <= 0) throw IOException("Source check expired") }
        }
        repeat(5) { hop ->
            if (!deliveryLocation(location)) throw IOException("Unsupported source redirect")
            val connection = location.toURL().openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = remaining()
                connection.readTimeout = remaining()
                connection.useCaches = false
                connection.setRequestProperty("Accept", "text/plain")
                connection.setRequestProperty("User-Agent", "DurableAgent-Termux-Source/1")
                when (val status = connection.responseCode) {
                    404 -> return null
                    301, 302, 303, 307, 308 -> {
                        if (hop == 4) throw IOException("Too many source redirects")
                        val next = connection.getHeaderField("Location") ?: throw IOException("Missing source redirect")
                        location = try { location.resolve(next) } catch (_: Exception) { throw IOException("Invalid source redirect") }
                    }
                    200 -> {
                        if (connection.contentLengthLong > TermuxSourceVerifier.MAX_CHECKSUM_BYTES) throw IOException("Oversized source document")
                        val output = ByteArrayOutputStream()
                        connection.inputStream.use { input ->
                            val buffer = ByteArray(4096)
                            while (true) {
                                connection.readTimeout = remaining()
                                val count = input.read(buffer)
                                if (count < 0) break
                                if (output.size() + count > TermuxSourceVerifier.MAX_CHECKSUM_BYTES) throw IOException("Oversized source document")
                                output.write(buffer, 0, count)
                            }
                        }
                        remaining()
                        return try {
                            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
                        } catch (_: Exception) { throw IOException("Invalid source encoding") }
                    }
                    else -> throw IOException("Source response unavailable: $status")
                }
            } finally { connection.disconnect() }
        }
        throw IOException("Source check incomplete")
    }

    private fun deliveryLocation(uri: URI): Boolean = uri.scheme == "https" && uri.userInfo == null && uri.fragment == null &&
        uri.port in setOf(-1, 443) && when (uri.host) {
            "github.com" -> initialLocation(uri)
            "release-assets.githubusercontent.com" -> uri.path.startsWith("/github-production-release-asset/")
            else -> false
        }

    private fun initialLocation(uri: URI): Boolean {
        if (uri.scheme != "https" || uri.host != "github.com" || uri.port !in setOf(-1, 443) || uri.userInfo != null || uri.query != null || uri.fragment != null) return false
        val parts = uri.path.split('/')
        if (parts.size != 7 || parts.take(5) != listOf("", "termux", "termux-app", "releases", "download")) return false
        val tag = parts[5]
        if (tag.length > 81 || !tag.matches(Regex("v[0-9]+(?:\\.[0-9]+){1,3}(?:[-.][0-9A-Za-z]+)*"))) return false
        return parts[6] in listOf("termux-app_$tag+github-debug_sha256sums", "termux-app_$tag+apt-android-7-github-debug_sha256sums")
    }
}
