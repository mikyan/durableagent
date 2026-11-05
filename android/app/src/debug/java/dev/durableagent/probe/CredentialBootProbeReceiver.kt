package dev.durableagent.probe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.UserManager
import org.json.JSONObject
import java.io.File

/** Debug-only Direct Boot guard probe. No key creation, write, resolution, or model execution. */
class CredentialBootProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        val unlocked = context.getSystemService(UserManager::class.java).isUserUnlocked
        // Do not even obtain a CE directory path before the actual first unlock.
        val existed: Any = if (unlocked) File(context.noBackupFilesDir, NAMESPACE).exists() else JSONObject.NULL
        val metadata = CredentialVault(context, NAMESPACE).metadata("boot-probe")
        resultCode = 0
        resultData = JSONObject().put("userUnlocked", unlocked).put("metadata", metadata.toJson())
            .put("ceNamespaceExistedBeforeQuery", existed).put("resolvedSecret", false).toString()
    }
    companion object { private const val NAMESPACE = "credential-boot-probe" }
}
