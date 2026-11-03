package dev.durableagent.termuxprobe

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import java.io.File
import java.security.MessageDigest

const val TERMUX_PERMISSION = "com.termux.permission.RUN_COMMAND"

/** The sole external boundary. No caller-controlled executable, script, path or shell arguments. */
class AndroidTermuxGateway(private val context: Context) {
    var description: String = "Termux 未核验"
        private set

    fun facts(): PlatformFacts {
        val pm = context.packageManager
        val pkg = try { pm.getPackageInfo("com.termux", PackageManager.GET_SIGNING_CERTIFICATES) }
        catch (_: PackageManager.NameNotFoundException) {
            description = "Termux 未安装；请从固定的官方发行页安装，已有安装请勿卸载替换。"
            return PlatformFacts(false)
        }
        val info = requireNotNull(pkg.applicationInfo)
        val certs = pkg.signingInfo?.apkContentsSigners.orEmpty().map { sha256(it.toByteArray()) }
        val digest = MessageDigest.getInstance("SHA-256")
        File(info.sourceDir).inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        val apkHash = hex(digest.digest())
        val trusted = pkg.versionName == "0.118.3" && pkg.longVersionCode == 1002L &&
            certs == listOf("b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1") &&
            info.splitSourceDirs.isNullOrEmpty() && apkHash in setOf(
                "72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e", // official arm64
                "3550e61f4d9eb49b712fd1bd9519dc37085a4d8eb597c57a340f0a64859b7144"  // test emulator only
            )
        val permission = context.checkSelfPermission(TERMUX_PERMISSION) == PackageManager.PERMISSION_GRANTED
        description = "Termux ${pkg.versionName} / ${pkg.longVersionCode}; target=${info.targetSdkVersion}; uid=${info.uid}\nAPK SHA256=$apkHash\ncert=${certs.joinToString()}\n固定发行物校验=$trusted; RUN_COMMAND 系统授权=$permission"
        return PlatformFacts(true, trusted, permission, info.flags and ApplicationInfo.FLAG_STOPPED != 0, info.uid)
    }

    fun dispatch(request: ProbeRequest): PendingIntent {
        require(request.nonce.matches(Regex("[a-zA-Z0-9-]+")))
        val callbackIntent = Intent(context, ProbeReceiver::class.java)
            .setAction("dev.durableagent.termuxprobe.RESULT")
            .setData(Uri.parse("durableagent-probe://result/${request.nonce}"))
        // Only Termux receives this explicit capability; fill-in cannot replace set data/component.
        val callback = PendingIntent.getBroadcast(context, 0, callbackIntent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_CANCEL_CURRENT)
        val bridge = "/data/data/com.termux/files/home/.local/share/durableagent-probe/probe-v1.sh"
        val command = "if [ ! -f '$bridge' ]; then printf 'status=setup-required\\n'; exit 78; fi; exec /data/data/com.termux/files/usr/bin/timeout -k 2s 12s /data/data/com.termux/files/usr/bin/bash '$bridge' '${request.nonce}'"
        val intent = Intent("com.termux.RUN_COMMAND").apply {
            component = ComponentName("com.termux", "com.termux.app.RunCommandService")
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", command))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", callback)
            putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "DurableAgent environment probe")
        }
        try { checkNotNull(context.startForegroundService(intent)) { "Termux service unavailable" } }
        catch (error: RuntimeException) { callback.cancel(); throw error }
        return callback
    }

    private fun sha256(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
}
