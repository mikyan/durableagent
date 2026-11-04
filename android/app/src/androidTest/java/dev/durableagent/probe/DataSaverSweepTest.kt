package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DataSaverSweepTest {
    @Test fun interruptedUnknownDoesNotStarveLaterExactCancellationOrTouchUnstartedWork(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext;val free=DataSaverNetwork("synthetic",true,false);val metered=DataSaverNetwork("synthetic",true,true)
        NativeDataSaverStore(context,"data-saver-sweep-${UUID.randomUUID()}").use{store->
            store.configure(true,0,free)
            for(index in 0..65){
                val id="execution-"+index.toString().padStart(3,'0');val request=JSONObject().put("executionId",id).put("command",JSONObject().put("kind","shell").put("script","synthetic-$index"))
                    .put("context",JSONObject().put("productId","chat").put("controlGeneration",1).put("namespace","termux:synthetic"))
                val registered=store.register(request,free);store.prepared(id,registered.getString("requestDigest"),"a".repeat(64),free)
                if(index<65)store.requireStart(id,"a".repeat(64),free)
            }
            val called=mutableListOf<String>();val sweep=NativeDataSaverSweep(store,{metered}){row->
                called.add(row.getString("executionId"))
                JSONObject().put("executionId",row.getString("executionId")).put("namespace",row.getString("namespace")).put("requestDigest",row.getString("requestDigest")).put("finalDigest",row.getString("finalDigest"))
                    .put("state",if(row.getString("executionId")=="execution-000")"unknown" else "stopped").put("scopeConfirmed",row.getString("executionId")!="execution-000").put("sequence",3)
            }
            val result=sweep.run();assertEquals(65,called.size);assertEquals(65,result.getInt("attempted"));assertEquals(64,result.getInt("confirmed"));assertFalse(called.contains("execution-065"))
            assertEquals("result-unverified",store.decision("execution-000",metered).getString("phase"));assertEquals("terminal",store.decision("execution-064",metered).getString("phase"));assertEquals("waiting",store.decision("execution-065",metered).getString("phase"))
            repeat(6){sweep.run()};assertEquals("Unknown cancellation retries are bounded, terminal work is not revisited",67,called.size)
        }
    }
}
