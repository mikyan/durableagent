package dev.durableagent.probe

import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Read-only final observation for the external real picker/UI process-death driver. */
@RunWith(AndroidJUnit4::class)
class ConsolePickerObservationTest {
 @Test(timeout=30000) fun savedCancelledPickerDraftRemainsUnsentWithoutOpeningOwner(){
  val arguments=InstrumentationRegistry.getArguments()
  val run=arguments.getString("pickerRun");assumeTrue(run!=null)
  require(run!!.matches(Regex("[a-zA-Z0-9-]{1,80}")))
  val id=arguments.getString("pickerConversation")?:error("Missing dedicated conversation")
  val expectedText="选择器打开期间继续编辑的草稿 🌍"
  val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
   NativeInputStore(context,NativeInputBridge.namespace("fixture",run)).withLeaseWait(1000).use{store->
    val draft=store.inspect(id);val sends=store.listSends(JSONObject().put("id",id))
    assertTrue(draft.getBoolean("committed"));assertEquals(expectedText,draft.getString("text"))
    assertEquals(0,draft.getJSONArray("selections").length());assertEquals(0,sends.getJSONArray("intents").length())
    instrumentation.sendStatus(0,Bundle().apply{putString("consolePickerObservation",JSONObject().put("run",run).put("conversationId",id).put("draft",draft).put("sendIntents",0).put("ownerNotOpened",true).toString())})
   }
 }
}
