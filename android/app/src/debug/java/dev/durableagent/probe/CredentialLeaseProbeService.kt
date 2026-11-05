package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.UserManager
import java.io.File

/** Isolated debug process used only to hold the public OS lease over dedicated synthetic data. */
class CredentialLeaseProbeService : Service() {
    private var lease: StorageDomainLease? = null
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { message ->
        val namespace = message.data.getString("namespace") ?: ""
        if (!namespace.matches(Regex("vault-test-[0-9a-f-]{36}"))) return@Handler true
        if (!getSystemService(UserManager::class.java).isUserUnlocked) return@Handler true
        when (message.what) {
            1 -> {
                if (lease == null) lease = StorageDomainLease.acquire(File(noBackupFilesDir, namespace))
                message.replyTo?.send(Message.obtain(null, 1).apply {
                    data = Bundle().apply { putBoolean("held", lease != null); putInt("pid", android.os.Process.myPid()) }
                })
            }
            2 -> { lease?.close(); lease = null }
            3 -> android.os.Process.killProcess(android.os.Process.myPid())
        }
        true
    })
    override fun onBind(intent: Intent): IBinder? =
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) messenger.binder else null
    override fun onDestroy() { lease?.close(); lease = null; super.onDestroy() }
}
