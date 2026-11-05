package dev.durableagent.probe

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.UUID

/** Fixed public bootstrap/launcher only. Arbitrary commands never cross RUN_COMMAND. */
class ExecutionTermuxGateway(private val context: Context) {
    fun connect(): ExecutionPairing {
        requireReady(allowSourceCheck = true)
        val previous = ExecutionPairingStore(context).use { it.read() }
        val identity = ExecutionIdentity(context,"production-v1",allowCreate=previous==null)
        val clientHash = identity.certificateSha256()
        if(previous!=null)ExecutionPairingStore(context).use { it.requireClient(clientHash) }
        val nonce = UUID.randomUUID().toString()
        val cert = Base64.encodeToString(identity.certificatePem().toByteArray(Charsets.UTF_8),Base64.NO_WRAP)
        val callback = PendingIntent.getBroadcast(context,0,
            Intent(context,ExecutionBootstrapReceiver::class.java).setAction(ExecutionBootstrapReceiver.ACTION)
                .setData(Uri.parse("durableagent-execution://bootstrap/$nonce")),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_CANCEL_CURRENT)
        val bootstrap = "if [ ! -x '$PYTHON' ] || [ ! -f '$SCRIPT' ]; then exit 78; fi; exec '$PYTHON' '$SCRIPT' bootstrap --client-cert-base64 '$cert' --nonce '$nonce'"
        val response = ExecutionBootstrapStore(context).use { mailbox ->
            mailbox.register(nonce)
            val started = SystemClock.elapsedRealtime()
            var dispatched = false
            try {
                var receipt: String? = null
                while (SystemClock.elapsedRealtime()-started < 19000) {
                    receipt = mailbox.take(nonce)
                    if (receipt != null) break
                    if (!dispatched && SystemClock.elapsedRealtime()-started < 3000) {
                        requireReady()
                        dispatched = dispatch(bootstrap,callback)
                    }
                    Thread.sleep(100)
                }
                val value = receipt?.let(::JSONObject) ?: throw ExecutionChannelException("BOOTSTRAP_TIMEOUT_UNKNOWN")
                if (value.opt("ok") != true) throw ExecutionChannelException(value.optString("error","BOOTSTRAP_UNCONFIRMED"))
                JSONObject(value.getString("stdout"))
            } finally { callback.cancel(); mailbox.forget(nonce) }
        }
        if (response.opt("protocol") != 1 || response.optString("nonce") != nonce) throw ExecutionChannelException("BOOTSTRAP_PROTOCOL_MISMATCH")
        val pairing = ExecutionPairing(response.getInt("port"),response.getString("serverSpkiSha256"),response.getString("executorId"),response.getString("ledgerEpoch"))
        if (pairing.port != PORT || (previous != null && previous != pairing)) throw ExecutionChannelException("PAIRING_CONFLICT")
        val publicCert = Base64.decode(response.getString("serverCertificateDer"),Base64.NO_WRAP)
        if (publicCert.size !in 1..8192) throw ExecutionChannelException("INVALID_SERVER_IDENTITY")
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(publicCert.inputStream()) as X509Certificate
        if (ExecutionIdentity.sha256(certificate.publicKey.encoded) != pairing.serverSpkiSha256) throw ExecutionChannelException("INVALID_SERVER_IDENTITY")
        certificate.checkValidity(); certificate.verify(certificate.publicKey)
        val deadline = SystemClock.elapsedRealtime()+10000
        var launched = false
        var last: ExecutionChannelException? = null
        do {
            if (!launched) { requireReady(); launched = dispatch("if [ ! -x '$PYTHON' ] || [ ! -f '$SCRIPT' ]; then exit 78; fi; exec '$PYTHON' '$SCRIPT' serve >/dev/null 2>&1",null) }
            try {
                val ping = ExecutionTlsClient(identity,pairing).request("ping",JSONObject())
                if (ping.opt("protocol") != 1 || ping.optString("executorId") != pairing.executorId || ping.optString("ledgerEpoch") != pairing.ledgerEpoch) throw ExecutionChannelException("INSTANCE_MISMATCH")
                return ExecutionPairingStore(context).use { it.saveIfAbsent(pairing,clientHash) }
            } catch (error: ExecutionChannelException) { last=error }
            Thread.sleep(100)
        } while (SystemClock.elapsedRealtime()<deadline)
        throw last
    }
    /** Reopen only an already-paired authority; never initialize trust or replay an operation. */
    fun ensureExisting(eligible:()->Boolean={true}):ExecutionPairing {
        val deadline=SystemClock.elapsedRealtime()+10000
        fun remaining():Long {
            if(Thread.currentThread().isInterrupted||!eligible())throw ExecutionChannelException("CHANNEL_CLOSED")
            return (deadline-SystemClock.elapsedRealtime()).also{if(it<=0)throw ExecutionChannelException("EXISTING_EXECUTOR_UNAVAILABLE")}
        }
        remaining();requireReady()
        val identity=ExecutionIdentity(context,"production-v1",allowCreate=false)
        val pairing=ExecutionPairingStore(context).use{it.requireClient(identity.certificateSha256())}
        fun reachable():Boolean = try {
            val value=ExecutionTlsClient(identity,pairing).request("ping",JSONObject(),minOf(2000L,remaining()))
            if(value.opt("protocol")!=1||value.optString("executorId")!=pairing.executorId||value.optString("ledgerEpoch")!=pairing.ledgerEpoch)throw ExecutionChannelException("INSTANCE_MISMATCH")
            remaining();true
        }catch(error:ExecutionChannelException){if(error.code!="CONNECTION_ABSENT")throw error;false}
        if(reachable())return pairing
        // The independent control socket remains separate. Only overlapping
        // absent-listener launches are coalesced, outside every native input lease.
        if(!existingStart.tryLock(remaining(),java.util.concurrent.TimeUnit.MILLISECONDS))throw ExecutionChannelException("EXISTING_EXECUTOR_UNAVAILABLE")
        try{
            remaining();if(reachable())return pairing
            requireReady();remaining()
            if(!dispatch("if [ ! -x '$PYTHON' ] || [ ! -f '$SCRIPT' ]; then exit 78; fi; exec '$PYTHON' '$SCRIPT' serve-existing >/dev/null 2>&1",null))throw ExecutionChannelException("TERMUX_START_UNCONFIRMED")
            do{remaining();if(reachable())return pairing;Thread.sleep(minOf(100L,remaining()))}while(true)
        }finally{existingStart.unlock()}
    }
    fun requireReady() = requireReady(allowSourceCheck = false)

    /** Only the explicit connect action may fetch source proof for newly installed GitHub bytes. */
    private fun requireReady(allowSourceCheck: Boolean) {
        val pm=context.packageManager
        val pkg=try { pm.getPackageInfo("com.termux",PackageManager.GET_SIGNING_CERTIFICATES) }
        catch (_: PackageManager.NameNotFoundException) { throw ExecutionChannelException("TERMUX_MISSING") }
        val info=pkg.applicationInfo ?: throw ExecutionChannelException("TERMUX_SOURCE_UNSUPPORTED")
        val signers=pkg.signingInfo?.apkContentsSigners.orEmpty().map { ExecutionIdentity.sha256(it.toByteArray()) }
        if (signers.size != 1 || !info.splitSourceDirs.isNullOrEmpty()) throw ExecutionChannelException("TERMUX_SOURCE_UNSUPPORTED")
        val digest=MessageDigest.getInstance("SHA-256")
        File(info.sourceDir).inputStream().use { input -> val buffer=ByteArray(65536); while(true) { val count=input.read(buffer); if(count<0)break; digest.update(buffer,0,count) } }
        val hash=digest.digest().joinToString("") { "%02x".format(it) }
        if (info.flags and ApplicationInfo.FLAG_STOPPED != 0) throw ExecutionChannelException("TERMUX_FORCE_STOPPED")
        if (context.checkSelfPermission(PERMISSION)!=PackageManager.PERMISSION_GRANTED) throw ExecutionChannelException("TERMUX_PERMISSION_REQUIRED")
        TermuxSourceVerifier(File(context.noBackupFilesDir, "termux-source-proof")).requireTrusted(
            TermuxArtifact(pkg.versionName.orEmpty(), hash, signers.single()), allowSourceCheck)
        val service = try { pm.getServiceInfo(ComponentName("com.termux", "com.termux.app.RunCommandService"), 0) }
        catch (_: PackageManager.NameNotFoundException) { throw ExecutionChannelException("TERMUX_CAPABILITY_UNSUPPORTED") }
        if (!info.enabled || !service.enabled || !service.exported || service.permission != PERMISSION) throw ExecutionChannelException("TERMUX_CAPABILITY_UNSUPPORTED")
    }
    private fun dispatch(script: String, callback: PendingIntent?): Boolean {
        val intent=Intent("com.termux.RUN_COMMAND").apply {
            component=ComponentName("com.termux","com.termux.app.RunCommandService")
            putExtra("com.termux.RUN_COMMAND_PATH","/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS",arrayOf("-c",script))
            putExtra("com.termux.RUN_COMMAND_WORKDIR","/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND",true)
            putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL","DurableAgent execution channel")
            if(callback!=null)putExtra("com.termux.RUN_COMMAND_PENDING_INTENT",callback)
        }
        return try { context.startForegroundService(intent)!=null }
        catch (_: Exception) { throw ExecutionChannelException("TERMUX_START_UNCONFIRMED") }
    }
    companion object {
        private val existingStart=java.util.concurrent.locks.ReentrantLock()
        const val PERMISSION="com.termux.permission.RUN_COMMAND"
        const val PORT=47193
        private const val PYTHON="/data/data/com.termux/files/usr/bin/python"
        private const val SCRIPT="/data/data/com.termux/files/home/.local/share/durableagent-execution/durable_executor.py"
    }
}
