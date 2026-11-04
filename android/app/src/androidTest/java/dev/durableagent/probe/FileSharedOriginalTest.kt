package dev.durableagent.probe

import android.content.*
import android.os.*
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

@RunWith(AndroidJUnit4::class)
class FileSharedOriginalTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation();private val context=instrumentation.targetContext
 private fun uuid()=UUID.randomUUID().toString()
 private fun target(id:String)=JSONObject().put("id",id)
 private fun until(timeout:Long=60000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(!condition()){assertTrue("Public file queue state timed out",SystemClock.elapsedRealtime()<end);Thread.sleep(25)}}
 private inner class Wire(val run:String):AutoCloseable {
  private val connection=uuid();private val pending=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val controls=ConcurrentHashMap<Int,LinkedBlockingQueue<JSONObject>>()
  val client=ApplicationClient(context,"execution",run){what,text->if(what>=10){val value=JSONObject(text);if(what==10)pending.remove(value.optString("requestId"))?.complete(value)else controls.computeIfAbsent(what){LinkedBlockingQueue()}.offer(value)}}.apply{connect()}
  fun call(method:String,payload:JSONObject=JSONObject()):JSONObject{val id=uuid();val future=CompletableFuture<JSONObject>();pending[id]=future;client.post(JSONObject().put("protocol",1).put("connectionId",connection).put("requestId",id).put("method",method).put("payload",payload).toString());val value=future.get(30,TimeUnit.SECONDS);check(value.getBoolean("ok")){value.toString()};return value.getJSONObject("value")}
  fun control(what:Int,text:String=""):JSONObject{val queue=controls.computeIfAbsent(what){LinkedBlockingQueue()};queue.clear();client.control(what,text);return queue.poll(10,TimeUnit.SECONDS)?:error("File queue control timeout $what")}
  fun ready(){until{val state=control(12);check(state.optString("phase")!="failed"){state.toString()};state.optString("phase")=="ready"}}
  fun closeHost(){client.control(20,"close");until(15000){control(12).optString("phase")=="closed"}}
  override fun close(){client.disconnect()}
 }
 private var activeRun="";private var activeOrder="shared-original"
 private fun trace(phase:String,id:String?=null,code:String?=null){instrumentation.sendStatus(0,Bundle().apply{putString("fileQueuePhase",JSONObject().put("run",activeRun).put("order",activeOrder).put("phase",phase).put("id",id).put("code",code).toString())})}
 private fun <T> nativeStep(id:String,phase:String,action:()->T):T{trace(phase+".before",id);return try{action().also{trace(phase+".after",id)}}catch(error:NativeInputException){trace(phase+".failed",id,error.code);throw IllegalStateException("Native fixture $phase failed for $id in $activeRun: ${error.code}",error)}}
 private fun prepare(store:NativeInputStore,id:String,text:String):String {
  val before=nativeStep(id,"inspect"){store.inspect(id)}
  val saved=nativeStep(id,"save"){store.save(id,before.getLong("revision"),uuid(),text,emptyList())}
  val frozen=nativeStep(id,"freeze"){store.freeze(id,saved.getLong("revision"),uuid())}
  val current=nativeStep(id,"inspect-context"){store.inspect(id)}
  val control=nativeStep(id,"read-control"){store.readControl(id)}
  return nativeStep(id,"create-send"){store.createSend(JSONObject().put("actionId",uuid()).put("id",id).put("inputToken",frozen.getString("token")).put("expectedContext",current.getJSONObject("submissionContext")).put("expectedControlVersion",control.getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))}.getString("intentId")
 }
 private fun execution(wire:Wire,id:String):JSONObject? {val rows=wire.call("execution.list",target(id)).getJSONArray("executions");return if(rows.length()==0)null else rows.getJSONObject(rows.length()-1)}
 private fun texts(wire:Wire,id:String):List<String>{val rows=wire.call("open",target(id)).getJSONArray("entries");return (0 until rows.length()).map{rows.getJSONObject(it).optString("text","")}}
 private fun completed(wire:Wire,intentId:String){until{wire.call("sendStatus",JSONObject().put("intentId",intentId)).optJSONObject("submission")?.optString("status")=="done"}}


 private val fixture="dev.durableagent.documentsfixture"
 private fun fixtureControl(operation:String):JSONObject {
  val response=CompletableFuture<JSONObject>();context.sendOrderedBroadcast(Intent().setComponent(ComponentName(fixture,"$fixture.ControlReceiver")).putExtra("operation",operation).putExtra("targetPackage",context.packageName),null,
   object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(resultCode==0)response.complete(JSONObject(resultData?:"{}"))else response.completeExceptionally(IllegalStateException("Fixture control $operation failed"))}},Handler(Looper.getMainLooper()),-99,null,null)
  return response.get(10,TimeUnit.SECONDS)
 }
 @Test(timeout=150000) fun actualProviderWriteHoldsTheSameOriginalAgainstQueuedBash(){
  val path=InstrumentationRegistry.getArguments().getString("sharedOriginalPath")?:error("Root-verified sharedOriginalPath required")
  require(path.matches(Regex("/storage/emulated/0/Download/DurableAgent-SAF-[a-f0-9-]{36}/original\\.bin")))
  val uri=android.net.Uri.parse("content://$fixture.documents/document/original")
  val grant=context.contentResolver.persistedUriPermissions.firstOrNull{it.uri==uri}
  assertTrue("Main product UID requires its own real system-picker grant",grant?.isReadPermission==true&&grant.isWritePermission)
  val run=uuid();activeRun=run;trace("shared.begin");val wire=Wire(run)
  val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","execution").putExtra("validationRun",run))
  // Trusted fixture admission waits only before entering one native action. No action or commit is retried.
  val store=NativeInputStore(context,NativeInputBridge.namespace("execution",run)).withLeaseWait(1000)
  val documents=NativeDocumentStore(context,NativeDocumentBridge.namespace("execution",run),NativeInputBridge.namespace("execution",run))
  var operation:String?=null
  try{
   wire.ready();for(id in listOf("document","shell","pure"))wire.call("create",JSONObject().put("creationId",id))
   val resource=documents.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
   val opened=documents.open(resource.getString("resourceId"));val closed=documents.closeRead(opened.getString("readerId"));assertTrue(closed.getBoolean("unchanged"))
   val before=fixtureControl("read");assertNotEquals(android.os.Process.myUid(),before.getInt("providerUid"));val content="native-$run\n"
   val docIntent=prepare(store,"document","FILE_DOCUMENT_WRITE:"+JSONObject().put("resourceId",resource.getString("resourceId")).put("expectedDigest",opened.getString("contentDigest")).put("content",content).toString())
   val shellIntent=prepare(store,"shell","FILE_SHARED_BASH:$path");val pureIntent=prepare(store,"pure","FILE_PURE")
   fixtureControl("hold-readback");wire.call("send",JSONObject().put("intentId",docIntent))
   until(15000){val actual=fixtureControl("read");actual.getInt("writeOpens")==before.getInt("writeOpens")+1&&String(android.util.Base64.decode(actual.getString("base64"),android.util.Base64.DEFAULT),Charsets.UTF_8)==content}
   val changes=wire.call("files.list",target("document")).getJSONObject("documents").getJSONArray("changes");assertEquals(1,changes.length());val held=changes.getJSONObject(0);operation=held.getString("operationId")
   val nativeHeld=documents.query(operation!!);assertEquals("running",nativeHeld.getString("state"));assertFalse(nativeHeld.getBoolean("scopeConfirmed"))
   wire.call("send",JSONObject().put("intentId",shellIntent));until(10000){execution(wire,"shell")?.optString("state")=="queued"};val queued=execution(wire,"shell")!!
   wire.call("send",JSONObject().put("intentId",pureIntent));completed(wire,pureIntent);assertTrue(texts(wire,"pure").contains("FILE-PURE-PASS"))
   assertEquals("running",documents.query(operation!!).getString("state"));assertFalse(documents.query(operation!!).getBoolean("scopeConfirmed"));assertEquals("queued",execution(wire,"shell")!!.getString("state"))
   assertEquals(content,String(android.util.Base64.decode(fixtureControl("read").getString("base64"),android.util.Base64.DEFAULT),Charsets.UTF_8))
   fixtureControl("release");completed(wire,docIntent);completed(wire,shellIntent)
   val final=fixtureControl("read");val actual=android.util.Base64.decode(final.getString("base64"),android.util.Base64.DEFAULT);assertEquals(content+"shell-$run\n",String(actual,Charsets.UTF_8));assertEquals(before.getInt("writeOpens")+1,final.getInt("writeOpens"))
   val original=documents.query(operation!!);assertEquals("completed",original.getString("state"));assertTrue(original.getBoolean("scopeConfirmed"));val shell=execution(wire,"shell")!!;assertEquals("completed",shell.getString("state"));assertEquals(0,shell.getInt("exitCode"));assertTrue(shell.getBoolean("scopeConfirmed"))
   instrumentation.sendStatus(0,Bundle().apply{putString("sharedOriginalEvidence",JSONObject().put("run",run).put("pathVerifiedByRoot",path).put("resource",resource).put("beforeDigest",opened.getString("contentDigest")).put("held",nativeHeld).put("queuedShell",queued).put("pureToolContinued",true).put("originalReceipt",original).put("shell",shell).put("actualBase64",final.getString("base64")).put("actualSha256",NativeInputStore.sha256(actual)).put("providerWriteOpens",final.getInt("writeOpens")).toString())})
  }finally{
   runCatching{fixtureControl("release")};if(operation!=null)runCatching{val receipt=documents.query(operation!!);trace("shared.finally.scope."+receipt.optString("state"))}
   page.close();documents.close();store.close();try{wire.closeHost()}finally{wire.close()}
  }
 }
}
