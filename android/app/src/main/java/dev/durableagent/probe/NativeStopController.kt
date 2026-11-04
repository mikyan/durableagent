package dev.durableagent.probe

import android.content.Context
import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import org.json.JSONObject

/** Both UI and notification actions use this durable authority; no JS response is required. */
object NativeStopController {
    fun request(context:Context,mode:String,run:String?,request:JSONObject):JSONObject {
        val control=NativeInputStore(context,NativeInputBridge.namespace(mode,run)).use{it.requestStop(request)}
        // The commit is the acknowledgement. OS service-start refusal cannot undo that fact.
        runCatching{resume(context,mode,run)}
        publish(context,mode,run,control,"停止请求已保存，正在核验")
        return control
    }
    fun resume(context:Context,mode:String,run:String?){context.startForegroundService(Intent(context,NativeStopService::class.java).putExtra("mode",mode).putExtra("run",run))}
    fun publish(context:Context,mode:String,run:String?,control:JSONObject,message:String="原生停止入口，不依赖会话界面"){
        val manager=context.getSystemService(NotificationManager::class.java);channel(manager)
        val identity=NativeInputBridge.namespace(mode,run)+":"+control.getString("id")
        val title=runCatching{NativeInputStore(context,NativeInputBridge.namespace(mode,run)).use{it.conversationTitle(control.getString("id"))}}.getOrDefault("会话").replace(Regex("[\\u0000-\\u001f]")," ").take(60)
        val public=Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_media_pause).setContentTitle("DurableAgent 会话控制").setContentText("解锁后查看会话控制").build()
        val builder=Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_media_pause).setContentTitle(title).setContentText(message).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public)
        if(control.getLong("generation")>control.getLong("stoppedThrough")){
            val action=JSONObject().put("id",control.getString("id")).put("actionId","notification-"+java.util.UUID.randomUUID()).put("expectedControlVersion",control.getLong("version"))
            val intent=Intent(context,NativeStopService::class.java).setAction("stop").setData(android.net.Uri.parse("durable-stop:"+android.net.Uri.encode(identity+":"+control.getLong("version"))))
                .putExtra("mode",mode).putExtra("run",run).putExtra("request",action.toString())
            val pending=PendingIntent.getForegroundService(context,identity.hashCode(),intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            builder.addAction(Notification.Action.Builder(null,"停止此会话",pending).build())
        }
        runCatching{manager.notify(identity,18011,builder.build())}
    }
    internal const val CHANNEL="native-stop"
    internal fun channel(manager:NotificationManager){manager.createNotificationChannel(NotificationChannel(CHANNEL,"原生停止控制",NotificationManager.IMPORTANCE_LOW))}
}
