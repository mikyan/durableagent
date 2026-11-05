package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
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

@RunWith(AndroidJUnit4::class)
class DataSaverApplicationTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private inner class Wire(val run:String):AutoCloseable {
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>()
        private val statuses=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,"fixture",run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else if(what==12)statuses.offer(value)}}.apply{connect()}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {
            val request=id();val result=CompletableFuture<JSONObject>();replies[request]=result
            client.post(JSONObject().put("protocol",1).put("connectionId","data-saver-test").put("requestId",request).put("method",method).put("payload",payload).toString())
            return result.get(30,TimeUnit.SECONDS).also{assertTrue(it.toString(),it.getBoolean("ok"))}.getJSONObject("value")
        }
        fun awaitPhase(expected:String):JSONObject {
            val until=SystemClock.elapsedRealtime()+90000;var last=JSONObject()
            while(SystemClock.elapsedRealtime()<until){statuses.clear();client.control(12);val value=statuses.poll(500,TimeUnit.MILLISECONDS)?:continue;last=value;if(value.optString("phase")==expected)return value;if(value.optString("phase")=="failed")error(value.toString());Thread.sleep(25)}
            error("Expected $expected; last=$last")
        }
        fun closeHost(){client.control(20,"close");awaitPhase("closed")}
        override fun close(){client.disconnect()}
    }
    @Test(timeout=180000) fun publicSettingUsesNativeFactsAndSurvivesFreshSdkOwnerWithoutRequests(){
        val run=id();var wire=Wire(run);var primary:Throwable?=null
        try {
            val before=wire.awaitPhase("ready");val setting=wire.call("dataSaver.get")
            assertFalse(setting.getBoolean("enabled"));assertTrue(setting.getJSONObject("network").has("known"))
            val saved=wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",setting.getLong("version")))
            assertTrue(saved.getBoolean("enabled"));assertEquals(setting.getLong("version")+1,saved.getLong("version"))
            assertEquals(0,wire.awaitPhase("ready").getJSONObject("metrics").optInt("modelRequests"))
            wire.closeHost();wire.close();wire=Wire(run);val reopened=wire.awaitPhase("ready")
            assertNotEquals(before.getString("instance"),reopened.getString("instance"))
            val restored=wire.call("dataSaver.get");assertTrue(restored.getBoolean("enabled"));assertEquals(saved.getLong("version"),restored.getLong("version"));assertEquals(0,reopened.getJSONObject("metrics").optInt("modelRequests"))
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverEvidence",JSONObject().put("case","public-native-setting-reopen").put("setting",restored).put("requests",0).put("freshOwner",true).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{try{wire.closeHost()}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}
    }
}
