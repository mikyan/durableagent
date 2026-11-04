package dev.durableagent.probe

import android.app.Activity
import android.content.Intent
import android.provider.Settings
import org.json.JSONObject

/** Only Activity-owned notification controls. Neither action starts or submits Agent work. */
class NativeRecoveryBridge(private val activity:Activity,private val mode:String,private val run:String?,private val deliver:(String)->Unit) {
    fun accept(json:String):Boolean {
        val request=runCatching{JSONObject(json)}.getOrNull()?:return false
        val method=request.optString("method");if(method !in setOf("recovery.status","recovery.requestNotifications"))return false
        if(request.optInt("protocol")!=1||request.optString("connectionId").length !in 1..128||request.optString("requestId").length !in 1..128)return true
        val response=JSONObject().put("type","response").put("protocol",1).put("connectionId",request.getString("connectionId")).put("requestId",request.getString("requestId"))
        try{
            val visibility=NativeRecoveryNotifications.visibility(activity)
            if(method=="recovery.requestNotifications")when(visibility){
                "permission-denied"->activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),4612)
                "channel-disabled"->activity.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,activity.packageName).putExtra(Settings.EXTRA_CHANNEL_ID,NativeRecoveryNotifications.blockedChannel(activity)))
                "app-disabled"->activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,activity.packageName))
            }
            var delivery:JSONObject?=null
            val host=runCatching{NativeRecoveryStore(activity,NativeInputBridge.namespace(mode,run)).use{store->delivery=store.notificationState();store.readHostState()}}.getOrNull()
            @Suppress("DEPRECATION") val foreground=activity.getSystemService(android.app.ActivityManager::class.java).getRunningServices(Int.MAX_VALUE).any{it.service.className==ApplicationService::class.java.name&&it.foreground}
            val background=if(host?.optString("background")=="running"&&!foreground)"unknown" else host?.optString("background")?:"unknown"
            response.put("ok",true).put("value",JSONObject().put("notifications",visibility).put("background",background).put("foreground",foreground).put("notificationDelivery",delivery?:JSONObject.NULL).put("requested",method=="recovery.requestNotifications"&&visibility!="visible"))
        }catch(_:RuntimeException){response.put("ok",false).put("error",JSONObject().put("code","HOST_NOTIFICATION_UNAVAILABLE").put("message","系统通知设置暂不可用。"))}
        deliver(response.toString());return true
    }
}
