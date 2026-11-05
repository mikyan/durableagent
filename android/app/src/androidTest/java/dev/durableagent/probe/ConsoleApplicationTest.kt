package dev.durableagent.probe

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Real bundled page/native picker and Intent boundaries, isolated drafts, no model or Termux access. */
@RunWith(AndroidJUnit4::class)
class ConsoleApplicationTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation()
 private val context=instrumentation.targetContext
 private fun until(test:()->Boolean){val end=System.currentTimeMillis()+30000;while(!test()){assertTrue("Console public UI timeout",System.currentTimeMillis()<end);Thread.sleep(40)}}
 private fun js(page:ActivityScenario<AgentActivity>,source:String):String{val result=CompletableFuture<String>();page.onActivity{it.webView!!.evaluateJavascript(source,result::complete)};return result.get(10,TimeUnit.SECONDS)}
 private fun js(page:AgentActivity,source:String):String{val result=CompletableFuture<String>();instrumentation.runOnMainSync{page.webView!!.evaluateJavascript(source,result::complete)};return result.get(10,TimeUnit.SECONDS)}
 private fun delivered(page:AgentActivity,data:String):Boolean{val result=CompletableFuture<Boolean>();instrumentation.runOnMainSync{result.complete(page.intent.dataString==data&&page.hasWindowFocus())};return result.get(10,TimeUnit.SECONDS)}
 private fun text(page:AgentActivity,expected:String)=js(page,"document.querySelector('[data-testid=message-input]')?.value==="+JSONObject.quote(expected))=="true"
 private fun intent(run:String,id:String?=null)=Intent(context,AgentActivity::class.java).putExtra("validationMode","input-only").putExtra("validationRun",run).apply{if(id!=null){putExtra("targetConversationId",id);data=Uri.parse("durable-conversation:input-"+run+":"+id)}}
 private fun seed(store:NativeInputStore,id:String,text:String){store.rememberConversation(JSONObject().put("id",id).put("title",id).put("model",JSONObject().put("provider","fixture").put("modelId","text").put("name","离线验证")));store.save(id,0,UUID.randomUUID().toString(),text,emptyList())}
 private fun delivered(page:ActivityScenario<AgentActivity>,data:String):Boolean{val result=CompletableFuture<Boolean>();page.onActivity{result.complete(it.intent.dataString==data&&it.hasWindowFocus())};return result.get(10,TimeUnit.SECONDS)}
 private fun text(page:ActivityScenario<AgentActivity>,expected:String)=js(page,"document.querySelector('[data-testid=message-input]')?.value==="+JSONObject.quote(expected))=="true"
 private fun report(name:String,value:JSONObject){instrumentation.sendStatus(0,Bundle().apply{putString("consoleEvidence",JSONObject().put("case",name).put("result",value).toString())})}
 @Test fun notificationTargetsSelectKnownDraftsWithoutCreatingOrSending(){
  val run=UUID.randomUUID().toString()
  NativeInputStore(context,"input-"+run).use{store->
   seed(store,"console-one","第一个会话的草稿");seed(store,"console-two","第二个会话的草稿")
   // ActivityScenario keys lifecycle tracking by its launch Intent. setIntent during a
   // genuine onNewIntent changes that identity; use the platform Activity handle here.
   val page=instrumentation.startActivitySync(intent(run,"console-one").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as AgentActivity
   try{
    until{text(page,"第一个会话的草稿")}
    context.startActivity(intent(run,"console-two").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    until{text(page,"第二个会话的草稿")}
    context.startActivity(intent(run,"console-one").setData(Uri.parse("durable-conversation:wrong:console-one")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    until{delivered(page,"durable-conversation:wrong:console-one")};assertTrue(text(page,"第二个会话的草稿"))
    context.startActivity(intent(run,"unknown-target").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    until{delivered(page,"durable-conversation:input-"+run+":unknown-target")};assertTrue(text(page,"第二个会话的草稿"))
    assertEquals(2,store.list().getJSONArray("conversations").length())
    assertEquals(0,store.inspect("console-one").getJSONArray("selections").length())
    assertEquals("第一个会话的草稿",store.inspect("console-one").getString("text"))
    assertEquals("第二个会话的草稿",store.inspect("console-two").getString("text"))
    assertEquals("0",js(page,"document.querySelectorAll('[data-testid=history-message]').length"))
    report("known-notification-target-only",JSONObject().put("run",run).put("conversations",2).put("wrongNamespaceIgnored",true).put("unknownTargetIgnored",true).put("draftsPreserved",true))
   }finally{instrumentation.runOnMainSync{page.finish()};instrumentation.waitForIdleSync()}
  }
 }
 @Test fun cancelledSystemCameraRetainsConfirmedDraft(){
  val run=UUID.randomUUID().toString()
  NativeInputStore(context,"input-"+run).use{store->
   seed(store,"console-camera","取消拍照前的已保存草稿")
   val monitor=instrumentation.addMonitor(IntentFilter(MediaStore.ACTION_IMAGE_CAPTURE),Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null),true)
   try{ActivityScenario.launch<AgentActivity>(intent(run,"console-camera")).use{page->
    until{text(page,"取消拍照前的已保存草稿")}
    js(page,"document.querySelector('[data-testid=add-attachment]').click()")
    val available=Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(context.packageManager)!=null
    if(available){
     until{js(page,"[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent==='拍照')")=="true"}
     js(page,"[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent==='拍照').click()")
     until{monitor.hits==1}
     until{js(page,"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved'&&!document.querySelector('[data-testid=add-attachment]')?.disabled")=="true"}
    }else assertEquals("false",js(page,"[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent==='拍照')"))
    assertTrue(text(page,"取消拍照前的已保存草稿"))
    val saved=store.inspect("console-camera");assertEquals(1L,saved.getLong("revision"));assertEquals(0,saved.getJSONArray("selections").length())
    report("camera-cancel-public-ui",JSONObject().put("run",run).put("systemCameraAvailable",available).put("cameraLaunches",monitor.hits).put("draftRevision",saved.getLong("revision")).put("draftPreserved",true).put("cameraResult","controlled cancellation; no capture success claim"))
   }}finally{instrumentation.removeMonitor(monitor)}
  }
 }
}
