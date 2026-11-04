package dev.durableagent.probe

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import org.json.JSONObject

/** Only identifiers and state reach Android notifications. No input, output or credential text. */
object NativeRecoveryNotifications {
    const val RUNNING_ID=18012
    const val RUNNING_CHANNEL="agent-running"
    const val COMPLETION_CHANNEL="agent-completion"
    private fun channels(context:Context):NotificationManager=context.getSystemService(NotificationManager::class.java).also{
        it.createNotificationChannel(NotificationChannel(RUNNING_CHANNEL,"正在进行的会话",NotificationManager.IMPORTANCE_LOW))
        it.createNotificationChannel(NotificationChannel(COMPLETION_CHANNEL,"会话完成",NotificationManager.IMPORTANCE_DEFAULT))
    }
    fun visibility(context:Context):String {
        val manager=channels(context)
        return when{
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED->"permission-denied"
            !manager.areNotificationsEnabled()->"app-disabled"
            listOf(RUNNING_CHANNEL,COMPLETION_CHANNEL).any{manager.getNotificationChannel(it)?.importance==NotificationManager.IMPORTANCE_NONE}->"channel-disabled"
            else->"visible"
        }
    }
    fun blockedChannel(context:Context):String? {val manager=channels(context);return listOf(RUNNING_CHANNEL,COMPLETION_CHANNEL).firstOrNull{manager.getNotificationChannel(it)?.importance==NotificationManager.IMPORTANCE_NONE}}
    fun target(context:Context,mode:String,run:String?,id:String):PendingIntent? {
        if(!id.matches(Regex("[-A-Za-z0-9_]{1,128}")))return null
        val namespace=NativeInputBridge.namespace(mode,run)
        val intent=Intent(context,AgentActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("durable-conversation:$namespace:$id"))
            .putExtra("targetConversationId",id).putExtra("validationMode",mode).putExtra("validationRun",run).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context,0,intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    fun running(context:Context,mode:String,run:String?,projection:JSONObject):Notification? {
        channels(context)
        val rows=projection.optJSONArray("conversations")?:return null
        val active=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.optString("phase") in setOf("running","waiting")}
        val first=active.firstOrNull()?:return null
        val id=first.getString("id");val waiting=first.optString("phase")=="waiting"
        val builder=builder(context,RUNNING_CHANNEL,if(waiting)"会话等待继续" else "会话正在运行",if(active.size>1)"${active.size} 个会话有未完成工作" else "会话 ${id.take(8)} · ${if(waiting)"等待条件恢复" else "正在处理"}")
            .setOngoing(true).setOnlyAlertOnce(true)
        target(context,mode,run,id)?.let{builder.setContentIntent(it)}
        val namespace=NativeInputBridge.namespace(mode,run)
        runCatching{NativeInputStore(context,namespace).withLeaseWait(1000).use{it.readControl(id)}}.getOrNull()?.let{control->
            if(control.getLong("generation")>control.getLong("stoppedThrough")){
                val request=JSONObject().put("id",id).put("actionId","recovery-stop-${java.util.UUID.randomUUID()}").put("expectedControlVersion",control.getLong("version"))
                val intent=Intent(context,NativeStopService::class.java).setAction("stop").setData(Uri.parse("durable-recovery-stop:$namespace:$id:${control.getLong("version")}"))
                    .putExtra("mode",mode).putExtra("run",run).putExtra("request",request.toString())
                builder.addAction(Notification.Action.Builder(null,"停止此会话",PendingIntent.getForegroundService(context,0,intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build())
            }
        }
        return builder.build()
    }
    fun completions(context:Context,mode:String,run:String?,store:NativeRecoveryStore,projection:JSONObject){
        val manager=channels(context);val values=projection.optJSONArray("completions")?:return
        for(index in 0 until values.length()){
            val value=values.getJSONObject(index);val identity=value.getString("identity");val id=value.getString("conversationId")
            if(store.pendingCompletion(identity,id).getString("state")=="published")continue
            if(context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED||!manager.areNotificationsEnabled()||manager.getNotificationChannel(COMPLETION_CHANNEL)?.importance==NotificationManager.IMPORTANCE_NONE)continue
            val builder=builder(context,COMPLETION_CHANNEL,"会话工作已完成","会话 ${id.take(8)} · 点击查看已保存结果").setOnlyAlertOnce(true).setAutoCancel(true)
            target(context,mode,run,id)?.let{builder.setContentIntent(it)}
            manager.notify(NativeInputBridge.namespace(mode,run)+":"+identity,18013,builder.build())
            store.completeNotification(identity)
        }
    }
    private fun builder(context:Context,channel:String,title:String,text:String):Notification.Builder {
        val public=Notification.Builder(context,channel).setSmallIcon(android.R.drawable.ic_menu_info_details).setContentTitle("DurableAgent").setContentText("解锁后查看会话状态").build()
        return Notification.Builder(context,channel).setSmallIcon(android.R.drawable.ic_menu_info_details).setContentTitle(title).setContentText(text).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public)
    }
}
