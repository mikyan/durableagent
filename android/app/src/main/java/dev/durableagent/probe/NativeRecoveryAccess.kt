package dev.durableagent.probe

import android.app.Service
import android.content.*
import android.content.pm.ServiceInfo
import android.os.UserManager
import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/** Trusted host capability; Android callbacks only invalidate current facts. */
class NativeRecoveryAccess(private val service:Service,private val mode:String,private val run:String?):AutoCloseable {
    private val store=NativeRecoveryStore(service,NativeInputBridge.namespace(mode,run))
    private val changes=AtomicLong(1)
    private val network=AndroidDataSaverNetwork(service){changes.incrementAndGet()}
    private var observed=0L
    private var due:Long?=null
    private var fired:Long?=null
    private var lastWake=""
    private var lastProjection=""
    var pendingWork=true
        private set
    @Volatile var foreground=false
        private set
    @Volatile var startBlocked=false
        private set
    private val receiver=object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){fired=null;changes.incrementAndGet()}}
    init{service.registerReceiver(receiver,IntentFilter().apply{addAction(Intent.ACTION_TIME_CHANGED);addAction(Intent.ACTION_USER_UNLOCKED)},Context.RECEIVER_NOT_EXPORTED)}
    /** Called before bundle unpack on a legally started host; no model/effect permission is inferred. */
    fun restoreRunning(){
        val wake=store.readWake();lastWake=wake.toString();due=if(wake.has("at"))wake.getLong("at")else null
        if(!wake.optBoolean("active")&&!wake.has("at")){pendingWork=false;return}
        val projection=store.readProjection().put("restoring",true)
        NativeRecoveryNotifications.running(service,mode,run,projection)?.let{publishForeground(it)}
    }
    private fun publishForeground(notification:android.app.Notification){try{
        service.startForeground(NativeRecoveryNotifications.RUNNING_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        // startForeground alone does not turn a job-only binding into a started
        // Service. Retain the owner only after Android has accepted foreground
        // execution; startService is still subject to platform eligibility.
        if(!foreground)service.startService(Intent(service,ApplicationService::class.java).putExtra("validationMode",mode).putExtra("validationRun",run))
        foreground=true;startBlocked=false
    }catch(_:RuntimeException){if(!foreground)service.stopForeground(Service.STOP_FOREGROUND_REMOVE);startBlocked=true}}
    fun conditions():JSONObject {
        val value=network.current()
        return JSONObject().put("userUnlocked",service.getSystemService(UserManager::class.java).isUserUnlocked)
            .put("network",if(value.known)"available" else if(value.identity==null)"offline" else "unknown")
            .put("notifications",NativeRecoveryNotifications.visibility(service)).put("background",if(startBlocked)"system-blocked" else if(foreground)"running" else "not-requested")
    }
    fun state():JSONObject=conditions().put("foreground",foreground).put("wake",store.readWake())
    fun poll():Boolean {
        val current=changes.get();val at=due;val dueNow=at!=null&&System.currentTimeMillis()>=at&&fired!=at
        if(current==observed&&!dueNow)return false
        observed=current;if(dueNow)fired=at
        return true
    }
    @V8Function fun conditionsJson():String=result{conditions()}
    @V8Function fun probeJson(workId:String):String=result{store.probe(workId,System.currentTimeMillis())}
    @V8Function fun wakeJson(json:String):String=result{
        val wake=store.wake(JSONObject(json));due=if(wake.has("at"))wake.getLong("at")else null
        val encoded=wake.toString();if(encoded!=lastWake){lastWake=encoded;fired=null;NativeRecoveryJobs.schedule(service,mode,run,wake,!network.current().known)}
        JSONObject()
    }
    @V8Function fun projectionJson(json:String):String=result{
        val projection=JSONObject(json);store.projection(projection)
        val rows=projection.optJSONArray("conversations")
        pendingWork=rows!=null&&(0 until rows.length()).any{rows.getJSONObject(it).optString("phase") in setOf("running","waiting")}
        if(json!=lastProjection||startBlocked){lastProjection=json
            val notification=NativeRecoveryNotifications.running(service,mode,run,projection)
            if(notification!=null)publishForeground(notification)
            else if(foreground){service.stopForeground(Service.STOP_FOREGROUND_REMOVE);foreground=false}
        }
        store.hostState(JSONObject().put("background",if(startBlocked)"system-blocked" else if(foreground)"running" else "not-requested").put("foreground",foreground))
        NativeRecoveryNotifications.completions(service,mode,run,store,projection)
        JSONObject()
    }
    private fun result(action:()->Any):String=try{JSONObject().put("ok",true).put("value",action()).toString()}catch(_:Exception){JSONObject().put("ok",false).put("error",JSONObject().put("code","HOST_RECOVERY_UNAVAILABLE").put("message","恢复记录尚不可用，保留原工作等待核验。")).toString()}
    override fun close(){network.close();runCatching{service.unregisterReceiver(receiver)};runCatching{store.hostState(JSONObject().put("background","not-requested").put("foreground",false))};store.close();if(foreground)service.stopForeground(Service.STOP_FOREGROUND_REMOVE);foreground=false}
}
