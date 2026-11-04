package dev.durableagent.probe

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import org.json.JSONObject
import java.util.concurrent.Executors

/** A bounded user-requested control job, independent of the UI and Node owner processes. */
class NativeStopService:Service(){
    private val main=Handler(Looper.getMainLooper())
    private val workers=Executors.newFixedThreadPool(2)
    // Short native admission must not queue behind a 20-second external verification job.
    private val admissions=Executors.newFixedThreadPool(2)
    private class Work(val mode:String,val run:String?,val namespace:String){var revision=1L;var attempted=0L}
    private val jobs=linkedMapOf<String,Work>()
    private val links=mutableSetOf<StopHostLink>()
    private var admitting=0
    private var latestStart=0
    @Volatile private var closing=false
    private val expiry=Runnable{stopSelf()}
    override fun onBind(intent:Intent?)=null
    // Pinned lint 31.13.2 reports a missing type despite the merged/package manifest's
    // shortService declaration. Keep the explicit runtime type; device tests execute it.
    @android.annotation.SuppressLint("ForegroundServiceType")
    override fun onCreate(){super.onCreate();val manager=getSystemService(NotificationManager::class.java);NativeStopController.channel(manager)
        startForeground(18012,Notification.Builder(this,NativeStopController.CHANNEL).setSmallIcon(android.R.drawable.ic_media_pause).setContentTitle("正在处理停止请求").setContentText("核验会话与相关受管操作").build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        main.postDelayed(expiry,45000)
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
        NativeStopTrace.event(this,"service.start")
        latestStart=startId;main.removeCallbacks(expiry);main.postDelayed(expiry,45000)
        val mode=intent?.getStringExtra("mode")?:"product";val run=intent?.getStringExtra("run")
        val namespace=try{NativeInputBridge.namespace(mode,run)}catch(_:Exception){stopSelfResult(startId);return START_NOT_STICKY}
        val request=intent?.takeIf{it.action=="stop"}?.getStringExtra("request")
        // Admission of a repeated notification is still checked by the same stable action/version.
        synchronized(jobs){admitting++}
        admissions.execute{try{
            if(request!=null)try{NativeInputStore(this,namespace).withLeaseWait(1500).use{it.requestStop(JSONObject(request))}}catch(error:Exception){
                NativeStopTrace.failure(this,"service.admission.failed",error)
                getSystemService(NotificationManager::class.java).notify(18013,Notification.Builder(this,NativeStopController.CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_alert).setContentTitle("停止请求尚未确认").setContentText("原生控制记录提交结果未确认，请打开应用核验当前状态。").build())
                return@execute
            }
            synchronized(jobs){if(!closing){val old=jobs[namespace];if(old!=null)old.revision++ else{
                val work=Work(mode,run,namespace);jobs[namespace]=work;workers.execute{perform(work)}
            }}}
        }finally{synchronized(jobs){admitting--};stopWhenIdle()}}
        return START_NOT_STICKY
    }
    private fun stopWhenIdle(){main.post{if(synchronized(jobs){jobs.isEmpty()&&admitting==0})stopSelfResult(latestStart)}}
    private fun perform(work:Work){
            val mode=work.mode;val run=work.run;val namespace=work.namespace
            val link=StopHostLink(mode,run,namespace)
            synchronized(jobs){if(closing)return;links.add(link)}
            try{NativeInputStore(this,namespace).use{store->
                val deadline=SystemClock.elapsedRealtime()+20000;val products=linkedSetOf<String>()
                fun barriers(){val stops=read(deadline){store.pendingStops()};for(index in 0 until stops.length()){val item=stops.getJSONObject(index);products.add(item.getString("id"));link.offer(item.getJSONObject("control"))}}
                ExecutionAccess(this).use{transport->
                val sweep=NativeStopSweep(store){row->
                    products.add(row.getString("productId"))
                    if(row.getString("source")!="termux"||row.getString("kind")!="command")throw ExecutionChannelException("EXTERNAL_EFFECT_UNCONFIRMED")
                    if(SystemClock.elapsedRealtime()>=deadline)throw ExecutionChannelException("CANCEL_DEADLINE")
                    val begun=JSONObject(transport.beginVerifiedCancelJson(row.getString("operationId")));if(!begun.getBoolean("ok"))throw ExecutionChannelException(begun.getJSONObject("error").getString("code"))
                    val operation=begun.getJSONObject("value").getString("operationId");var result:JSONObject
                    while(true){if(Thread.currentThread().isInterrupted||SystemClock.elapsedRealtime()>=deadline)throw ExecutionChannelException("CANCEL_DEADLINE")
                        val poll=JSONObject(transport.pollJson(operation));if(!poll.getBoolean("ok"))throw ExecutionChannelException(poll.getJSONObject("error").getString("code"))
                        val value=poll.getJSONObject("value");if(!value.getBoolean("pending")){val reply=value.getJSONObject("result");if(!reply.getBoolean("ok"))throw ExecutionChannelException(reply.getJSONObject("error").getString("code"));result=reply.getJSONObject("value");break};Thread.sleep(20)
                    }
                    if(result.optString("namespace")!=row.getString("namespace")||result.has("requestDigest")&&result.getString("requestDigest")!=row.getString("requestDigest"))throw ExecutionChannelException("EXECUTION_IDENTITY_CONFLICT")
                    JSONObject().put("operationId",row.getString("operationId")).put("namespace",row.getString("namespace")).put("requestDigest",row.getString("requestDigest"))
                        .put("state",result.getString("state")).put("scopeConfirmed",result.optBoolean("scopeConfirmed")).put("sequence",result.optLong("sequence",-1))
                }
                while(SystemClock.elapsedRealtime()<deadline){
                    val sweepRequired=synchronized(jobs){if(work.attempted==work.revision)false else{work.attempted=work.revision;true}}
                    barriers()
                    if(sweepRequired){NativeStopTrace.event(this,"service.scope",JSONObject().put("products",products.size));sweep.run(deadline)}
                    if(read(deadline){store.pendingStops()}.length()==0&&synchronized(jobs){work.attempted==work.revision})break
                    Thread.sleep(100)
                }}
                for(product in products){val state=read(deadline){store.stopStatus(product)};NativeStopController.publish(this,mode,run,state.getJSONObject("control"),when(state.getString("phase")){"stopped"->"停止完成 · 相关受管操作已核验";"waiting"->"停止请求已保存 · 会话中断待核验";else->"停止已请求，外部结果待核验"})}
            }}catch(error:Exception){NativeStopTrace.failure(this,"service.failed",error)/* Persistent barriers/effects remain unresolved; never synthesize completion. */}
            finally{link.close();synchronized(jobs){links.remove(link)
                // Exit and a new request use the same lock. Only an actual later user request
                // can schedule a follow-on job; an unresolved effect alone never loops forever.
                if(!closing&&work.revision>work.attempted)workers.execute{perform(work)} else jobs.remove(namespace)
            };stopWhenIdle()}
    }
    private fun <T> read(deadline:Long,action:()->T):T{while(true){try{return action()}catch(error:NativeInputException){if(error.code!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()>=deadline)throw error;Thread.sleep(20)}}}
    private inner class StopHostLink(val mode:String,val run:String?,val namespace:String):AutoCloseable{
        private var peer:Messenger?=null;private var bound=false;private var closed=false;private var restarted=false;private var started=false
        private val pending=linkedMapOf<String,JSONObject>();private val sent=hashSetOf<String>()
        private fun host()=Intent(this@NativeStopService,ApplicationService::class.java).putExtra("validationMode",mode).putExtra("validationRun",run)
        private val connection=object:ServiceConnection{
            override fun onServiceConnected(name:ComponentName,binder:IBinder){NativeStopTrace.event(this@NativeStopService,"host.connected");peer=Messenger(binder);sent.clear();flush()}
            override fun onServiceDisconnected(name:ComponentName){NativeStopTrace.event(this@NativeStopService,"host.disconnected");peer=null;sent.clear();if(!closed&&!restarted){restarted=true;startService(host())}}
        }
        fun offer(control:JSONObject){main.post{if(!closed){val barrier=control.optJSONObject("pendingAbort")?:return@post;pending[barrier.getString("stopId")]=JSONObject().put("namespace",namespace).put("id",control.getString("id")).put("stopId",barrier.getString("stopId"));if(!started){started=true;startService(host());bound=bindService(host(),connection,Context.BIND_AUTO_CREATE)};flush()}}}
        private fun flush(){val remote=peer?:return;for((id,value)in pending){if(id in sent)continue;try{remote.send(Message.obtain(null,55).apply{data=Bundle().apply{putString("json",JSONObject(value.toString()).put("allowRebuild",!restarted).toString())}});sent.add(id);NativeStopTrace.event(this@NativeStopService,"host.stop.sent")}catch(_:RemoteException){return}}}
        override fun close(){val release={closed=true;peer=null;if(bound){unbindService(connection);bound=false}};if(Looper.myLooper()==main.looper)release()else main.post{release()}}
    }
    override fun onTimeout(startId:Int){stopSelf()}
    override fun onTimeout(startId:Int,fgsType:Int){stopSelf()}
    override fun onDestroy(){val owned=synchronized(jobs){closing=true;links.toList()};admissions.shutdownNow();workers.shutdownNow();main.removeCallbacksAndMessages(null);owned.forEach{it.close()};stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
}
