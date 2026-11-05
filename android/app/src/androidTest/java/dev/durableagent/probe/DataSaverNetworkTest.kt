package dev.durableagent.probe

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Collections

/** Root changes only this disposable emulator's actual metering setting; the test never changes it. */
@RunWith(AndroidJUnit4::class)
class DataSaverNetworkTest {
    @Test fun observesRealDefaultNetworkTransitionWhileJavascriptIsAbsent(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val events=Collections.synchronizedList(mutableListOf<DataSaverNetwork>())
        AndroidDataSaverNetwork(context){events.add(it)}.use{network->
            fun until(message:String,milliseconds:Long=60000,predicate:()->Boolean){val end=SystemClock.elapsedRealtime()+milliseconds;while(!predicate()){assertTrue(message,SystemClock.elapsedRealtime()<end);Thread.sleep(20)}}
            until("Current actual unmetered Android network was not observed",5000){val value=network.current();value.known&&!value.metered&&!value.blocked}
            val initial=network.current();println("T13_NETWORK_WAIT_METERED "+initial.json())
            until("Actual metered transition did not arrive"){network.current().metered&&network.current().known}
            until("Native callback did not report actual metered transition"){synchronized(events){events.any{it.known&&it.metered}}}
            val restricted=network.current();val meteredObservedAt=SystemClock.elapsedRealtime();println("T13_NETWORK_WAIT_UNMETERED "+restricted.json())
            until("Actual unmetered restoration did not arrive"){val value=network.current();value.known&&!value.metered&&!value.blocked}
            until("Native callback did not report restoration"){synchronized(events){events.lastOrNull()?.let{it.known&&!it.metered}==true}}
            println("T13_NETWORK_EVIDENCE "+org.json.JSONObject().put("javascriptOwners",0).put("initial",initial.json()).put("restricted",restricted.json()).put("restored",network.current().json()).put("meteredObservedElapsed",meteredObservedAt).put("restoredObservedElapsed",SystemClock.elapsedRealtime()).put("callbackCount",events.size))
        }
    }
}
