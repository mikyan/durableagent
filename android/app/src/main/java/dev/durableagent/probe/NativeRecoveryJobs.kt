package dev.durableagent.probe

import android.app.job.*
import android.content.*
import android.os.*
import org.json.JSONObject

/** Android eligibility/wake adapter. It never owns an SDK task or manufactures a submission. */
object NativeRecoveryJobs {
    fun schedule(context:Context,mode:String,run:String?,wake:JSONObject,networkWait:Boolean=false,force:Boolean=false){
        val namespace=NativeInputBridge.namespace(mode,run)
        val id=if(mode=="product")18012 else 0x40000000 or(namespace.hashCode() and 0x3fffffff)
        val manager=context.getSystemService(JobScheduler::class.java)
        val old=manager.getPendingJob(id)
        check(old==null||old.extras.getString("namespace")==namespace){"RECOVERY_JOB_ID_CONFLICT"}
        if(!wake.has("at")&&!wake.optBoolean("active")){manager.cancel(id);return}
        if(!wake.has("at")&&!networkWait&&!force)return
        val extras=PersistableBundle().apply{putString("namespace",namespace);putString("mode",mode);if(run!=null)putString("run",run)}
        val builder=JobInfo.Builder(id,ComponentName(context,NativeRecoveryJobService::class.java)).setPersisted(true).setExtras(extras)
        if(wake.has("at"))builder.setMinimumLatency((wake.getLong("at")-System.currentTimeMillis()).coerceAtLeast(0))
        if(networkWait)builder.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        check(manager.schedule(builder.build())==JobScheduler.RESULT_SUCCESS){"RECOVERY_JOB_REJECTED"}
    }
}

/** A bounded system job may bind the unique owner. A job is not permission to launch an FGS. */
class NativeRecoveryJobService:JobService() {
    private val main=Handler(Looper.getMainLooper())
    private var client:ApplicationClient?=null
    private var parameters:JobParameters?=null
    override fun onStartJob(params:JobParameters):Boolean {
        if(!getSystemService(UserManager::class.java).isUserUnlocked)return false
        val mode=params.extras.getString("mode")?:"product";val run=params.extras.getString("run")
        if(params.extras.getString("namespace")!=runCatching{NativeInputBridge.namespace(mode,run)}.getOrNull())return false
        parameters=params
        client=ApplicationClient(this,mode,run){what,json->
            if(what==12){val state=runCatching{JSONObject(json)}.getOrNull();val wake=state?.optJSONObject("recovery")?.optJSONObject("wake")
                if(state?.optString("phase") in setOf("closed","failed")||(state?.optString("phase")=="ready"&&wake!=null&&!wake.optBoolean("active")))finish()
            }
        }.also{it.connect(startService=false);it.control(61)}
        main.postDelayed(::inspect,500);main.postDelayed(::finish,50000)
        return true
    }
    private fun inspect(){if(parameters!=null){client?.control(12);main.postDelayed(::inspect,500)}}
    private fun finish(){val params=parameters?:return;parameters=null;main.removeCallbacksAndMessages(null);client?.control(60);client?.disconnect();client=null;jobFinished(params,false)}
    override fun onStopJob(params:JobParameters):Boolean {parameters=null;main.removeCallbacksAndMessages(null);client?.control(60);client?.disconnect();client=null;return false}
}

class NativeRecoveryReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){
    if(intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_USER_UNLOCKED,Intent.ACTION_MY_PACKAGE_REPLACED,Intent.ACTION_TIME_CHANGED))return
    if(!context.getSystemService(UserManager::class.java).isUserUnlocked)return
    // Before first unlock no CE directory, key, SDK store or submission is opened.
    runCatching{NativeRecoveryStore(context,"input-v1").use{NativeRecoveryJobs.schedule(context,"product",null,it.readWake(),force=true)}}
}}
