package dev.durableagent.probe

import android.app.ActivityManager
import android.app.job.JobScheduler
import android.app.job.JobInfo
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
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
    @Test(timeout=180000) fun anUnavailablePlatformWakeCanBeRepublishedWithoutAnotherInput(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("actualNetworkOffline")=="true")
        val mode="recovery-fixture";val run=id();val namespace=NativeInputBridge.namespace(mode,run);val product="wake-$run"
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run)
        val jobs=context.getSystemService(JobScheduler::class.java);val jobId=0x40000000 or(namespace.hashCode() and 0x3fffffff);var created=false
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->NativeRecoveryStore(context,namespace).use{recovery->try{
            wire.ready();assertEquals("Root must disable actual device networking", "offline",wire.state().getJSONObject("recovery").getString("network"));assertNull("Never overwrite an existing unrelated system job",jobs.getPendingJob(jobId))
            wire.call("create",JSONObject().put("creationId",product));created=true;val expected=wire.call("open",JSONObject().put("id",product)).getJSONObject("conversation").getJSONObject("submissionContext")
            // Actual Android scheduling cannot publish while this owned conflict is present.
            val conflict=PersistableBundle().apply{putString("namespace","owned-conflict-$run");putString("mode",mode);putString("run",run)}
            assertEquals(JobScheduler.RESULT_SUCCESS,jobs.schedule(JobInfo.Builder(jobId,ComponentName(context,NativeRecoveryJobService::class.java)).setExtras(conflict).setMinimumLatency(3600000).build()))
            val saved=store.save(product,0,id(),"one offline input across a rejected wake publication",emptyList());val fixed=store.freeze(product,saved.getLong("revision"),id())
            val intent=store.createSend(JSONObject().put("id",product).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",expected).put("expectedControlVersion",store.readControl(product).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            wire.call("send",JSONObject().put("intentId",intent.getString("intentId")))
            until("Native wake persisted while the platform publication is unavailable"){try{recovery.readWake().optBoolean("active")&&wire.call("open",JSONObject().put("id",product)).optJSONObject("recovery")?.optString("reason")=="network-offline"}catch(error:IllegalStateException){if(error.message=="RECOVERY_STORAGE_BUSY")false else throw error}}
            val admission=wire.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId"))).getJSONObject("receipt").toString();assertEquals("owned-conflict-$run",jobs.getPendingJob(jobId)?.extras?.getString("namespace"));assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            jobs.cancel(jobId);wire.client.control(61)
            until("Same pending work republishes its actual Android wake after the conflict clears",10000){jobs.getPendingJob(jobId)?.extras?.getString("namespace")==namespace}
            assertEquals(admission,wire.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId"))).getJSONObject("receipt").toString());assertEquals(0,wire.state().getJSONObject("metrics").optInt("modelRequests"))
            instrumentation.sendStatus(0,Bundle().apply{putString("wakeRepublished",JSONObject().put("run",run).put("product",product).put("sameAdmission",true).put("actualJobId",jobId).put("modelRequests",0).toString())})
        }finally{
            jobs.getPendingJob(jobId)?.let{if(it.extras.getString("namespace") in setOf(namespace,"owned-conflict-$run"))jobs.cancel(jobId)}
            if(created){val control=store.readControl(product);if(control.getLong("generation")>control.getLong("stoppedThrough")){NativeStopController.request(context,mode,run,JSONObject().put("id",product).put("actionId",id()).put("expectedControlVersion",control.getLong("version")));until("Own offline fixture stops"){!store.readControl(product).has("pendingAbort")}}}
            page.close();wire.closeHost();wire.close()
        }}}
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
