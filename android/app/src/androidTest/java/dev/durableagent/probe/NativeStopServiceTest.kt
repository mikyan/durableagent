package dev.durableagent.probe

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Actual private service + SQLite. Synthetic SAF ownership cannot be falsely declared cancelled. */
@RunWith(AndroidJUnit4::class)
class NativeStopServiceTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun until(label:String,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+5000;while(!condition()){assertTrue(label,SystemClock.elapsedRealtime()<end);Thread.sleep(30)}}
    @Test(timeout=40000) fun aSecondStopIsExaminedWhileTheFirstSdkBarrierStillWaits(){
        val run=UUID.randomUUID().toString();val mode="fixture";val namespace=NativeInputBridge.namespace(mode,run)
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->
            for(id in listOf("first","second")){
                store.rememberConversation(JSONObject().put("id",id).put("title",id).put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic service scope")).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))))
                store.registerEffect(JSONObject().put("operationId","file-$id").put("kind","file").put("source","saf").put("namespace","saf:synthetic").put("productId",id).put("controlGeneration",1).put("sdkConversationId",101).put("requestDigest","a".repeat(64)))
            }
            try{
                store.requestStop(JSONObject().put("id","first").put("actionId","first-stop").put("expectedControlVersion",0));NativeStopController.resume(context,mode,run)
                until("First native sweep recorded an unconfirmed file effect"){store.stopStatus("first").getInt("externalUnknown")==1}
                assertTrue("No SDK conversation exists in this dedicated fixture; its barrier remains unresolved",store.readControl("first").has("pendingAbort"))
                store.requestStop(JSONObject().put("id","second").put("actionId","second-stop").put("expectedControlVersion",0));NativeStopController.resume(context,mode,run)
                until("Second stop reached native verification while the first job was active"){store.stopStatus("second").getInt("externalUnknown")==1}
                for(id in listOf("first","second")){val state=store.stopStatus(id);assertEquals(1,state.getInt("externalPending"));assertEquals("waiting",state.getString("phase"));assertTrue(state.getJSONObject("control").has("pendingAbort"))}
                instrumentation.sendStatus(0,Bundle().apply{putString("stopServiceEvidence",JSONObject().put("first",store.stopStatus("first")).put("second",store.stopStatus("second")).put("actualCancellationClaimed",false).toString())})
            }finally{
                context.stopService(Intent(context,NativeStopService::class.java))
                context.stopService(Intent(context,ApplicationService::class.java))
            }
        }
    }
}
