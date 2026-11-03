package dev.durableagent.termuxprobe

import android.app.Application
import android.app.BackgroundServiceStartNotAllowedException
import android.app.ForegroundServiceStartNotAllowedException
import android.app.PendingIntent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** Activity recreation detaches only an observer. The application owns the in-flight probe. */
class ProbeApplication : Application() {
    val inspector = EnvironmentInspector()
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var gateway: AndroidTermuxGateway
    private var callback: PendingIntent? = null
    private var dispatched: String? = null
    var observer: (() -> Unit)? = null
    var platformDescription = "尚未检查"
        private set
    var lastRun = ""
        private set
    private var checkingFacts = false

    override fun onCreate() {
        super.onCreate()
        gateway = AndroidTermuxGateway(this)
        val previous = File(noBackupFilesDir, "last-inspection.txt")
        if (previous.exists()) lastRun = "上次进程留下的历史诊断（不是当前就绪证明）：\n" + previous.readText().take(20_000)
    }

    fun inspect() {
        if (checkingFacts) return
        checkingFacts = true
        worker.execute {
            val facts = runCatching { gateway.facts() }
            main.post {
                checkingFacts = false
                platformDescription = facts.fold({ gateway.description }, { "平台核验失败：${it.javaClass.simpleName}: ${it.message}" })
                if (facts.isFailure) {
                    inspector.platformCheckFailed(platformDescription)
                    callback?.cancel(); callback = null
                    publish(); return@post
                }
                val state = inspector.inspect(facts.getOrThrow(), UUID.randomUUID().toString(), SystemClock.elapsedRealtime())
                val request = state.request
                if (request != null && request.nonce != dispatched) {
                    callback?.cancel()
                    dispatched = request.nonce
                    try { callback = gateway.dispatch(request) }
                    catch (error: RuntimeException) {
                        val phase = when (error) {
                            is SecurityException -> if (checkSelfPermission(TERMUX_PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED) Phase.PERMISSION_REQUIRED else Phase.DISPATCH_FAILED
                            is ForegroundServiceStartNotAllowedException, is BackgroundServiceStartNotAllowedException -> Phase.START_RESTRICTED
                            else -> Phase.DISPATCH_FAILED
                        }
                        inspector.dispatchFailed(request.nonce, phase, "${error.javaClass.name}: ${error.message}")
                    }
                    main.postDelayed({
                        inspector.expire(SystemClock.elapsedRealtime())
                        if (inspector.state.request == null) { callback?.cancel(); callback = null }
                        publish()
                    }, 20_050)
                }
                publish()
            }
        }
    }

    fun receive(nonce: String, result: ProbeResult, finished: () -> Unit) {
        worker.execute {
            val facts = runCatching { gateway.facts() }
            main.post {
                try {
                    facts.onSuccess { inspector.complete(nonce, result, it, SystemClock.elapsedRealtime()) }
                    if (facts.isFailure && inspector.state.request?.nonce == nonce)
                        inspector.platformCheckFailed("回调后无法重新读取平台事实：${facts.exceptionOrNull()?.javaClass?.simpleName}")
                    if (inspector.state.request == null) { callback?.cancel(); callback = null }
                    publish()
                } finally { finished() }
            }
        }
    }

    private fun publish() {
        val snapshot = "time=${System.currentTimeMillis()}\n$platformDescription\n${inspector.state}\n"
        val file = AtomicFile(File(noBackupFilesDir, "last-inspection.txt"))
        var stream: java.io.FileOutputStream? = null
        try { stream = file.startWrite(); stream.write(snapshot.toByteArray()); file.finishWrite(stream) }
        catch (_: Exception) { if (stream != null) file.failWrite(stream) }
        Log.i("DurableAgentProbe", snapshot)
        observer?.invoke()
    }
}
