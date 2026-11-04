package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Read-only final observation for the external real picker/UI process-death driver. */
@RunWith(AndroidJUnit4::class)
class ConsolePickerObservationTest {
 @Test(timeout=45000) fun savedCancelledPickerDraftRemainsUnsentOnTheOriginalOwner(){
  val arguments=InstrumentationRegistry.getArguments()
  val run=arguments.getString("pickerRun");assumeTrue(run!=null)
  require(run!!.matches(Regex("[a-zA-Z0-9-]{1,80}")))
  val id=arguments.getString("pickerConversation")?:error("Missing dedicated conversation")
  val expectedText="选择器打开期间继续编辑的草稿 🌍"
  val expectedPid=arguments.getString("pickerAgentPid")?.toInt()?:error("Missing original owner PID")
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
  val states=LinkedBlockingQueue<JSONObject>()
  val client=ApplicationClient(context,"fixture",run){what,text->if(what==12)states.offer(JSONObject(text))}.apply{connect()}
  try{
   var state=JSONObject();val deadline=SystemClock.elapsedRealtime()+20000
   do{
    states.clear();client.control(12);state=states.poll(2,TimeUnit.SECONDS)?:JSONObject()
    if(state.optString("phase")=="failed")error(state.toString())
    assertTrue("Original fixture owner remains observable",SystemClock.elapsedRealtime()<deadline)
   }while(state.optString("phase")!="ready")
   assertEquals("Expected the retained host process",expectedPid,state.getInt("pid"))
   assertEquals(0,state.getJSONObject("metrics").optInt("modelRequests",0))
   NativeInputStore(context,NativeInputBridge.namespace("fixture",run)).withLeaseWait(1000).use{store->
    val draft=store.inspect(id);val sends=store.listSends(JSONObject().put("id",id))
    assertTrue(draft.getBoolean("committed"));assertEquals(expectedText,draft.getString("text"))
    assertEquals(0,draft.getJSONArray("selections").length());assertEquals(0,sends.getJSONArray("intents").length())
    instrumentation.sendStatus(0,Bundle().apply{putString("consolePickerObservation",JSONObject().put("run",run).put("conversationId",id).put("agentPid",expectedPid).put("hostInstance",state.optString("instance")).put("draft",draft).put("sendIntents",0).put("modelRequests",0).put("requestCountScope","current owner counter; no cross-owner total claimed").put("observationOnly",true).toString())})
   }
  }finally{client.disconnect()}
 }
}
