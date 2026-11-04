package dev.durableagent.probe

import android.app.ActivityManager
import android.app.job.JobScheduler
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Actual JobScheduler and bound/started Service lifetime; controlled SDK model transport. */
@RunWith(AndroidJUnit4::class)
class RecoveryJobApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(40)}}
    @Suppress("DEPRECATION") private fun service()=context.getSystemService(ActivityManager::class.java).getRunningServices(Int.MAX_VALUE).find{it.service.className==ApplicationService::class.java.name}
    private inner class Wire(mode:String,run:String):AutoCloseable {
        private val connection=id();private val responses=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val states=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->if(what==10){val value=JSONObject(text);responses.remove(value.optString("requestId"))?.complete(value)}else if(what==12)states.offer(JSONObject(text))}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val key=id();val future=CompletableFuture<JSONObject>();responses[key]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",key).put("method",method).put("payload",payload).toString());val response=future.get(30,TimeUnit.SECONDS);assertTrue(response.toString(),response.getBoolean("ok"));return response.getJSONObject("value")}
        fun state():JSONObject{states.clear();client.control(12);return states.poll(30,TimeUnit.SECONDS)?:error("Job owner status timed out")}
        fun ready(){until("Job owner ready"){val value=state();check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")=="ready"}}
        fun closeHost(){client.control(20,"close");until("Owner closes naturally"){state().optString("phase")=="closed"}}
        override fun close(){client.disconnect()}
    }
    @Test(timeout=240000) fun legalJobWakeRetainsItsForegroundOwnerAfterTheJobBindingEnds(){
        val mode="recovery-hang";val run=id();val namespace=NativeInputBridge.namespace(mode,run);val product="job-$run"
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));var wire:Wire?=Wire(mode,run)
        val jobs=context.getSystemService(JobScheduler::class.java)
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->NativeRecoveryStore(context,namespace).use{recovery->
            try{
                wire!!.ready();wire!!.call("create",JSONObject().put("creationId",product))
                val expectation=wire!!.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
                val saved=store.save(product,0,id(),"one input across the system job lifetime",emptyList());val frozen=store.freeze(product,saved.getLong("revision"),id())
                val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",frozen.getString("token")).put("expectedContext",expectation).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
                wire!!.call("send",JSONObject().put("intentId",intent.getString("intentId")))
                until("Initial SDK request and foreground owner"){wire!!.state().getJSONObject("metrics").getInt("modelRequests")==1&&service()?.foreground==true}
                val admission=wire!!.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId"))).getJSONObject("receipt").toString()
                page.close();wire!!.closeHost();wire!!.close();wire=null
                // Remove the earlier UI's started-service lifetime. Only the scheduled job may recreate it.
                context.stopService(Intent(context,ApplicationService::class.java));until("Earlier started/bound owner removed"){service()==null}
                NativeRecoveryJobs.schedule(context,mode,run,recovery.readWake(),force=true)
                until("Android starts the eligible recovery job and its native foreground owner"){service()?.foreground==true&&jobs.allPendingJobs.any{it.extras.getString("namespace")==namespace}}
                val owner=service()!!;val started=SystemClock.elapsedRealtime()
                instrumentation.sendStatus(0,Bundle().apply{putString("jobRecoveryStarted",JSONObject().put("run",run).put("product",product).put("pid",owner.pid).put("clientBindings","job only").toString())})
                // Native job has a 50-second bounded lifetime. There is no UI or Wire binding here.
                until("The system job releases its binding",70000){SystemClock.elapsedRealtime()-started>51000&&jobs.allPendingJobs.none{it.extras.getString("namespace")==namespace}}
                val retained=service();assertNotNull("An allowed foreground owner must survive the job's last unbind",retained);assertTrue(retained!!.foreground);assertEquals(owner.pid,retained.pid)
                wire=Wire(mode,run);wire!!.ready()
                assertEquals(admission,wire!!.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId"))).getJSONObject("receipt").toString())
                assertEquals(1,wire!!.state().getJSONObject("metrics").getInt("modelRequests"))
                val history=wire!!.call("history",JSONObject().put("id",product)).getJSONArray("items");assertEquals(1,(0 until history.length()).count{history.getJSONObject(it).optString("role")=="user"})
                NativeStopController.request(context,mode,run,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",store.readControl(product).getLong("version")))
                until("Original input stops after job recovery"){wire!!.call("open",JSONObject().put("id",product)).getString("phase")=="stopped"}
                wire!!.close();wire=null;until("Idle foreground owner exits after stop",30000){service()==null}
                instrumentation.sendStatus(0,Bundle().apply{putString("jobRecoveryEvidence",JSONObject().put("run",run).put("product",product).put("pid",owner.pid).put("sameAdmission",true).put("requests",1).put("stopped",true).put("serviceExited",true).toString())})
            }finally{
                page.close();jobs.allPendingJobs.filter{it.extras.getString("namespace")==namespace}.forEach{jobs.cancel(it.id)}
                if(service()!=null){if(wire==null)wire=Wire(mode,run);wire!!.ready();val control=store.readControl(product);if(control.getLong("stoppedThrough")<control.getLong("generation")){NativeStopController.request(context,mode,run,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",control.getLong("version")));until("Fixture stop cleanup"){!store.readControl(product).has("pendingAbort")}};wire!!.closeHost();wire!!.close();context.stopService(Intent(context,ApplicationService::class.java))}
            }
        }}
    }
}
