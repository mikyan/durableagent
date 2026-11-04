package dev.durableagent.probe

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Native callback + control transport. Neither the UI nor Node's event loop runs this work. */
class NativeDataSaverMonitor(context:Context,namespace:String):AutoCloseable {
    private val closed=AtomicBoolean(false)
    private val ready=AtomicBoolean(false)
    private val queued=AtomicBoolean(false)
    private val worker=Executors.newSingleThreadScheduledExecutor{task->Thread(task,"DataSaverControl").apply{isDaemon=true}}
    private val network=AndroidDataSaverNetwork(context){wake()}
    private val store=NativeDataSaverStore(context,namespace,network::current)
    private val transport=ExecutionAccess(context)
    private val sweep=NativeDataSaverSweep(store,network::current,::cancel)
    init{ready.set(true);worker.scheduleWithFixedDelay({pass()},0,1000,TimeUnit.MILLISECONDS)}
    private fun wake(){if(ready.get()&&!closed.get()&&queued.compareAndSet(false,true))runCatching{worker.execute{queued.set(false);pass()}}}
    private fun pass(){if(closed.get())return;try{sweep.run(4)}catch(_:Exception){/* Persistent records remain unresolved. Final start still fails closed. */}}
    private fun request(method:String,payload:JSONObject,expected:JSONObject?=null):JSONObject {
        val begun=JSONObject(if(expected==null)transport.beginJson(method,payload.toString())else transport.beginPolicyCancelJson(expected))
        if(!begun.getBoolean("ok"))throw ExecutionChannelException(begun.getJSONObject("error").getString("code"))
        val id=begun.getJSONObject("value").getString("operationId");val deadline=SystemClock.elapsedRealtime()+10000
        while(!closed.get()&&!Thread.currentThread().isInterrupted&&SystemClock.elapsedRealtime()<deadline){
            val response=JSONObject(transport.pollJson(id));if(!response.getBoolean("ok"))throw ExecutionChannelException(response.getJSONObject("error").getString("code"))
            val result=response.getJSONObject("value")
            if(!result.getBoolean("pending")){val envelope=result.getJSONObject("result");if(!envelope.getBoolean("ok"))throw ExecutionChannelException(envelope.getJSONObject("error").getString("code"));return envelope.getJSONObject("value")}
            Thread.sleep(20)
        }
        throw ExecutionChannelException("CANCEL_UNCONFIRMED")
    }
    private fun cancel(row:JSONObject):JSONObject {
        var result=request("cancel",JSONObject(),row);val deadline=SystemClock.elapsedRealtime()+4000
        while(result.optString("state") in setOf("starting","running","stop_requested")&&SystemClock.elapsedRealtime()<deadline&&!closed.get()){
            Thread.sleep(50);result=request("query",JSONObject().put("executionId",row.getString("executionId")))
        }
        return result
    }
    override fun close(){if(closed.compareAndSet(false,true)){network.close();worker.shutdownNow();transport.close();store.close()}}
}
