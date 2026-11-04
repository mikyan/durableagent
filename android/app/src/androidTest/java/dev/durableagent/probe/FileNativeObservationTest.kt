package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith

/** Does not bind ApplicationService, open the SDK, select a resource or dispatch input. */
@RunWith(AndroidJUnit4::class)
class FileNativeObservationTest {
 @Test(timeout=30000) fun inspectExistingNativeDraftsWithoutOpeningOwner(){
  val instrument=InstrumentationRegistry.getInstrumentation();val args=InstrumentationRegistry.getArguments()
  val run=args.getString("executionRun")?:error("executionRun required");require(run.matches(Regex("[A-Za-z0-9-]{1,80}")))
  val mode=args.getString("executionMode")?:"execution-real";require(mode in setOf("execution","execution-real"))
  fun emit(method:String,id:String?,value:JSONObject?,code:String?,elapsed:Long){instrument.sendStatus(0,Bundle().apply{putString("nativeFileObservation",JSONObject().put("run",run).put("mode",mode).put("interface",method).put("id",id).put("value",value).put("errorCode",code).put("elapsedMs",elapsed).put("ownerNotOpened",true).toString())})}
  NativeInputStore(instrument.targetContext,NativeInputBridge.namespace(mode,run)).withLeaseWait(1000).use{store->
   val list=store.list();emit("input.list",null,list,null,0);val rows=list.getJSONArray("conversations")
   for(i in 0 until minOf(rows.length(),8)){
    val id=rows.getJSONObject(i).getString("id")
    for(method in listOf("input.inspect","input.readControl","input.listSends")){
     val before=SystemClock.elapsedRealtime();var code:String?=null
     val value=try{when(method){"input.inspect"->store.inspect(id);"input.readControl"->store.readControl(id);else->store.listSends(JSONObject().put("id",id))}}catch(error:NativeInputException){code=error.code;null}
     emit(method,id,value,code,SystemClock.elapsedRealtime()-before)
    }
   }
  }
 }
}
