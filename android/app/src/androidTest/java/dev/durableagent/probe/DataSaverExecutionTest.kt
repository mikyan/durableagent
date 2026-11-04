package dev.durableagent.probe

import android.content.Intent
import android.os.Bundle
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
import java.util.concurrent.atomic.AtomicLong
import android.util.Base64

/** Root provisions the paired Termux endpoint and an actually metered Android network. */
@RunWith(AndroidJUnit4::class)
class DataSaverExecutionTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun id()=UUID.randomUUID().toString()
    private fun until(label:String,timeout:Long=90000,read:()->Boolean){val deadline=SystemClock.elapsedRealtime()+timeout;while(!read()){assertTrue(label,SystemClock.elapsedRealtime()<deadline);Thread.sleep(40)}}
    private inner class Wire(val mode:String,val run:String):AutoCloseable{
        private val replies=ConcurrentHashMap<String,CompletableFuture<JSONObject>>();private val statuses=LinkedBlockingQueue<JSONObject>();private val busy=LinkedBlockingQueue<JSONObject>()
        val client=ApplicationClient(context,mode,run){what,text->if(what!=0){val value=JSONObject(text);if(what==10)replies.remove(value.optString("requestId"))?.complete(value)else if(what==12)statuses.offer(value)else if(what==35)busy.offer(value)}}.apply{connect()}
        fun envelope(method:String,payload:JSONObject=JSONObject()):JSONObject{val request=id();val pending=CompletableFuture<JSONObject>();replies[request]=pending;client.post(JSONObject().put("protocol",1).put("connectionId","data-saver-execution").put("requestId",request).put("method",method).put("payload",payload).toString());return pending.get(35,TimeUnit.SECONDS)}
        fun call(method:String,payload:JSONObject=JSONObject()):JSONObject=envelope(method,payload).also{assertTrue(it.toString(),it.getBoolean("ok"))}.getJSONObject("value")
        fun phase(expected:String):JSONObject{var last=JSONObject();until("Host $expected: $last"){statuses.clear();client.control(12);val value=statuses.poll(1,TimeUnit.SECONDS)?:return@until false;last=value;check(value.optString("phase")!="failed"){value.toString()};value.optString("phase")==expected};return last}
        fun policy()=call("dataSaver.operations",JSONObject().put("id","policy-chat")).getJSONArray("operations")
        fun execution(executionId:String):JSONObject?{val rows=call("execution.list",JSONObject().put("id","policy-chat")).getJSONArray("executions");return (0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.getString("executionId")==executionId}}
        fun busy():JSONObject{busy.clear();client.control(35);return busy.poll(2,TimeUnit.SECONDS)?:error("Native busy observation unavailable")}
        override fun close(){client.disconnect()}
    }
    private fun send(store:NativeInputStore,wire:Wire,text:String,productId:String="policy-chat"):JSONObject{
        val draft=store.inspect(productId);val saved=store.save(productId,draft.getLong("revision"),id(),text,emptyList());val fixed=store.freeze(productId,saved.getLong("revision"),id())
        val location=wire.call("open",JSONObject().put("id",productId)).getJSONObject("conversation").getJSONObject("submissionContext")
        val intent=store.createSend(JSONObject().put("id",productId).put("actionId",id()).put("inputToken",fixed.getString("token")).put("expectedContext",location).put("expectedControlVersion",store.readControl(productId).getLong("version")).put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
        wire.call("send",JSONObject().put("intentId",intent.getString("intentId")));return intent
    }
    private fun js(page:ActivityScenario<AgentActivity>,code:String):String{val future=CompletableFuture<String>();page.onActivity{it.webView?.evaluateJavascript(code){value->future.complete(value)}?:future.complete("null")};return future.get(10,TimeUnit.SECONDS)}
    private fun click(page:ActivityScenario<AgentActivity>,selector:String){until("Actual React control becomes enabled"){js(page,"document.querySelector(${JSONObject.quote(selector)})?.disabled===false")=="true"};js(page,"document.querySelector(${JSONObject.quote(selector)}).click()")}
    private fun visible(page:ActivityScenario<AgentActivity>,selector:String,executionId:String):JSONObject {
        js(page,"document.querySelector(${JSONObject.quote(selector)})?.scrollIntoView({block:'center',inline:'nearest'})")
        var result=JSONObject()
        fun ready():Boolean{result=JSONObject(js(page,"(()=>{const e=document.querySelector(${JSONObject.quote(selector)});if(!e)return {};const r=e.getBoundingClientRect(),v=window.visualViewport,x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y),left=v?.offsetLeft??0,top=v?.offsetTop??0,w=v?.width??innerWidth,t=v?.height??innerHeight;return {x,y,width:innerWidth,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},viewport:{left,top,width:w,height:t,scale:v?.scale??1},enabled:e.disabled===false,connected:e.isConnected,executionId:e.closest('[data-testid=data-saver-operation]')?.querySelector('code')?.textContent,visible:r.width>0&&r.height>0&&r.left>=left&&r.right<=left+w&&r.top>=top&&r.bottom<=top+t&&(h===e||e.contains(h))}})()"));return result.optBoolean("visible")&&result.optBoolean("enabled")&&result.optBoolean("connected")&&result.optString("executionId")==executionId}
        until("Exact operation control is enabled, visible and not covered"){ready()}
        // The enabled DOM state and scroll must also reach the compositor before
        // screenshot or one physical touch. Observing a disabled button is insufficient.
        drawn(page)
        assertTrue("Exact control changed before the physical observation: $result",ready())
        return result
    }
    private fun touch(page:ActivityScenario<AgentActivity>,selector:String,executionId:String):JSONObject{
        val position=visible(page,selector,executionId);var x=0f;var y=0f;val trace=JSONObject().put("position",position)
        js(page,"window.__dataSaverTouchEvents=[];for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>{const t=e.target,b=t?.closest?.('button'),row=t?.closest?.('[data-testid=data-saver-operation]');window.__dataSaverTouchEvents.push({type:e.type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,target:t?.tagName,button:b?.textContent,disabled:b?.disabled,executionId:row?.querySelector('code')?.textContent})},{capture:true,passive:true})")
        page.onActivity{activity->val view=activity.webView!!;val origin=IntArray(2);view.getLocationOnScreen(origin);val scale=view.width/position.getDouble("width");x=(origin[0]+position.getDouble("x")*scale).toFloat();y=(origin[1]+position.getDouble("y")*scale).toFloat();trace.put("originX",origin[0]).put("originY",origin[1]).put("webViewWidth",view.width).put("webViewHeight",view.height).put("cssToScreenScale",scale).put("screenX",x).put("screenY",y)}
        instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverPointerBefore",trace.toString())})
        val at=SystemClock.uptimeMillis();val down=android.view.MotionEvent.obtain(at,at,android.view.MotionEvent.ACTION_DOWN,x,y,0);val up=android.view.MotionEvent.obtain(at,at+80,android.view.MotionEvent.ACTION_UP,x,y,0)
        try{instrumentation.sendPointerSync(down);Thread.sleep(80);instrumentation.sendPointerSync(up)}finally{down.recycle();up.recycle()}
        until("The one physical touch reaches the exact enabled control",5000){js(page,"window.__dataSaverTouchEvents.some(e=>e.type==='click'&&e.trusted&&e.disabled===false&&e.executionId===${JSONObject.quote(executionId)})")=="true"}
        trace.put("events",org.json.JSONArray(js(page,"window.__dataSaverTouchEvents")))
        instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverPointerAfter",trace.toString())})
        return trace
    }
    private fun drawn(page:ActivityScenario<AgentActivity>){
        val complete=CompletableFuture<Unit>()
        page.onActivity{activity->val view=activity.webView!!;check(view.isAttachedToWindow&&view.visibility==android.view.View.VISIBLE)
            // WebView guarantees the next draw includes this DOM state. Wait two
            // native frame callbacks too; a DOM hit-test alone is not a screenshot.
            view.postVisualStateCallback(SystemClock.uptimeMillis(),object:android.webkit.WebView.VisualStateCallback(){override fun onComplete(requestId:Long){view.postOnAnimation{view.postOnAnimation{complete.complete(Unit)}};view.invalidate()}})
        }
        complete.get(10,TimeUnit.SECONDS);instrumentation.waitForIdleSync()
    }
    private fun sendUi(page:ActivityScenario<AgentActivity>,text:String){until("Actual React composer is ready"){js(page,"document.querySelector('[data-testid=message-input]')?.disabled===false")=="true"};js(page,"(()=>{const e=document.querySelector('[data-testid=message-input]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSONObject.quote(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()");until("Actual React draft is saved"){js(page,"document.querySelector('[data-testid=draft-status]')?.dataset.state==='saved' && document.querySelector('[data-testid=message-input]')?.value===${JSONObject.quote(text)}")=="true"};click(page,"[data-testid=send-message]")}
    @Test(timeout=180000) fun actualReactSingleGrantKeepsGlobalPolicyAndTheNextIdentityWaiting(){
        val run=id();val mode="execution";val namespace=NativeInputBridge.namespace(mode,run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null;var product="";var stage="ready";var lastOps=org.json.JSONArray()
        try{
            wire.phase("ready");assertTrue(wire.call("dataSaver.get").getJSONObject("network").getBoolean("metered"))
            until("Actual bundled React is ready"){js(page,"document.querySelector('[data-testid=application]')?.dataset.status==='ready'")=="true"}
            click(page,"input[aria-label='省流模式']");until("UI setting committed"){wire.call("dataSaver.get").getBoolean("enabled")}
            click(page,"[data-testid=create-conversation]");until("UI conversation registered"){val rows=wire.call("list").getJSONArray("conversations");if(rows.length()!=1)false else{product=rows.getJSONObject(0).getString("id");true}}
            stage="first-ui-send";sendUi(page,"EXEC_SUCCESS")
            fun diagnostics()=JSONObject(js(page,"(()=>({pointerEvents:window.__dataSaverTouchEvents??[],policy:document.querySelector('.data-saver-panel')?.textContent?.slice(0,5000),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent?.slice(0,1000)),sendErrors:[...document.querySelectorAll('.send-error')].map(e=>e.textContent?.slice(0,1000)),sends:document.querySelector('.send-states')?.textContent?.slice(0,5000),draft:document.querySelector('[data-testid=draft-status]')?.textContent,status:document.querySelector('[data-testid=conversation-status]')?.textContent,sendDisabled:document.querySelector('[data-testid=send-message]')?.disabled}))()"))
            stage="first-ui-admission";until("Actual UI send confirms its original intent"){
                // Observation must not compete for the native input lease with the
                // single user send. Panel refresh failures are not send failures.
                val item=JSONObject(js(page,"(()=>{const rows=[...document.querySelectorAll('[data-testid=submission-item]')],e=rows[0],retry=e?.querySelector('[data-testid=retry-submission]');return {count:rows.length,stage:e?.dataset.stage??'',retryReady:retry?.disabled===false,error:e?.querySelector('.send-error')?.textContent??''}})()"))
                assertTrue("One click must not create multiple intentions: $item",item.getInt("count")<=1)
                val state=item.getString("stage")
                assertFalse("Actual send failed: $item; ${diagnostics()}",state=="failed"||state=="unknown"&&item.getBoolean("retryReady"))
                state in setOf("pending","accepted","queued","placed","settled")
            }
            stage="first-policy-visibility"
            fun operations()=wire.call("dataSaver.operations",JSONObject().put("id",product)).getJSONArray("operations").also{lastOps=it}
            var first=JSONObject();until("Actual waiting operation and fixed scope are visible"){val rows=operations();if(rows.length()!=1)return@until false;first=rows.getJSONObject(0);if(first.optString("phase")!="waiting")return@until false;js(page,"(()=>{const r=document.querySelector('[data-testid=data-saver-operation][data-phase=waiting]');return !!r && r.textContent.includes(${JSONObject.quote(first.getString("executionId"))}) && r.textContent.includes('省流等待') && r.textContent.includes('本次受限网络期间') && r.textContent.includes('printf')})()")=="true"}
            fun screenshot(label:String):String{drawn(page);val directory=java.io.File(context.filesDir,"validation-ui");check(directory.mkdirs()||directory.isDirectory);val file=java.io.File(directory,"t13-$run-$label.png");val bitmap=instrumentation.uiAutomation.takeScreenshot()?:error("Actual screenshot unavailable");try{java.io.FileOutputStream(file).use{check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))}}finally{bitmap.recycle()};return "files/validation-ui/"+file.name}
            val firstVisible=visible(page,"[data-testid=data-saver-operation][data-phase=waiting] button",first.getString("executionId"));val beforePng=screenshot("waiting");assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            stage="first-visible-grant";touch(page,"[data-testid=data-saver-operation][data-phase=waiting] button",first.getString("executionId"))
            until("Only the clicked identity completes"){val rows=operations();rows.length()==1&&rows.getJSONObject(0).getString("executionId")==first.getString("executionId")&&rows.getJSONObject(0).optString("phase")=="terminal"&&wire.call("open",JSONObject().put("id",product)).optString("phase")=="done"}
            assertTrue(wire.call("dataSaver.get").getBoolean("enabled"));assertEquals(2,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            until("UI confirms a single operation grant"){js(page,"document.body.textContent.includes('本操作未更改全局省流设置')")=="true"}
            stage="second-ui-send";sendUi(page,"EXEC_SUCCESS");stage="second-policy-visibility";var next=JSONObject();until("A new UI input does not inherit the grant"){val rows=operations();next=(0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.getString("executionId")!=first.getString("executionId")}?:return@until false;next.optString("phase")=="waiting"&&js(page,"document.querySelector('input[aria-label=省流模式]')?.checked===true && [...document.querySelectorAll('[data-testid=data-saver-operation][data-phase=waiting]')].some(e=>e.textContent.includes(${JSONObject.quote(next.getString("executionId"))}))")=="true"}
            assertTrue(next.isNull("grantPeriod"));assertEquals(3,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"));val nextVisible=visible(page,"[data-testid=data-saver-operation][data-phase=waiting] button",next.getString("executionId"));val afterPng=screenshot("next-waiting")
            stage="second-ui-stop";click(page,"[data-testid=stop-generation]");NativeInputStore(context,namespace).withLeaseWait(1000).use{store->until("UI stop settles only the new waiting identity"){!store.readControl(product).has("pendingAbort")&&wire.call("open",JSONObject().put("id",product)).optString("phase")=="stopped"}}
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case","actual-react-single-grant").put("run",run).put("productId",product).put("firstExecutionId",first.getString("executionId")).put("nextExecutionId",next.getString("executionId")).put("globalEnabled",wire.call("dataSaver.get").getBoolean("enabled")).put("modelRequests",3).put("grantInput","instrumentation-pointer").put("firstVisible",firstVisible).put("nextVisible",nextVisible).put("beforeScreenshot",beforePng).put("afterScreenshot",afterPng).toString())})
        }catch(error:Throwable){primary=error;try{val dom=JSONObject(js(page,"(()=>({pointerEvents:window.__dataSaverTouchEvents??[],policy:document.querySelector('.data-saver-panel')?.textContent?.slice(0,5000),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent?.slice(0,1000)),sendErrors:[...document.querySelectorAll('.send-error')].map(e=>e.textContent?.slice(0,1000)),sends:document.querySelector('.send-states')?.textContent?.slice(0,5000),draft:document.querySelector('[data-testid=draft-status]')?.textContent,status:document.querySelector('[data-testid=conversation-status]')?.textContent,sendDisabled:document.querySelector('[data-testid=send-message]')?.disabled}))()"));instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverUiFailure",JSONObject().put("run",run).put("productId",product).put("stage",stage).put("lastOperations",lastOps).put("dom",dom).toString())})}catch(diagnostic:Throwable){error.addSuppressed(diagnostic)};throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}
    }
    @Test(timeout=240000) fun actualPreparedTermuxCommandNeedsExactGrantAndUserStopInvalidatesTheNextGrant(){flow(false)}
    @Test(timeout=240000) fun realMimoRemainsUsableWhileUnknownToolAwaitsSingleGrant(){assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true");flow(true)}
    @Test(timeout=180000) fun actualMeteredTransitionStopsTheDownloadingChildWhileJavascriptIsBusyWithoutReplay(){
        val run=id();val mode="execution";val namespace=NativeInputBridge.namespace(mode,run);val meteredAt=AtomicLong(0)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->ExecutionAccess(context).use{native->AndroidDataSaverNetwork(context){fact->if(fact.known&&fact.metered)meteredAt.compareAndSet(0,SystemClock.elapsedRealtime())}.use{network->try{
            wire.phase("ready");val current=wire.call("dataSaver.get");assertTrue("Start on actually known unmetered Android network",current.getJSONObject("network").getBoolean("known")&&!current.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",current.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"));val sent=send(store,wire,"EXEC_NETWORK_DOWNLOAD")
            var running=JSONObject();until("Actual HTTP-reading child starts"){
                val rows=wire.call("execution.list",JSONObject().put("id","policy-chat")).getJSONArray("executions");if(rows.length()!=1)return@until false;running=rows.getJSONObject(0);if(running.optString("state")!="running")return@until false
                val chunks=wire.call("execution.readOutput",JSONObject().put("id","policy-chat").put("executionId",running.getString("executionId")).put("cursor",0)).getJSONArray("chunks")
                (0 until chunks.length()).joinToString(""){String(Base64.decode(chunks.getJSONObject(it).getString("data"),Base64.DEFAULT),Charsets.UTF_8)}.contains("t13-download-open")
            }
            val executionId=running.getString("executionId");assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            wire.client.control(34,"15000");until("Real JS busy begins",3000){wire.busy().getLong("started")>0};val busy=wire.busy();assertEquals(0L,busy.getLong("ended"))
            val awaitingMetered=JSONObject().put("run",run).put("executionId",executionId).put("busyStartedElapsed",busy.getLong("started"))
            println("T13_EXECUTION_WAIT_METERED "+awaitingMetered)
            instrumentation.sendStatus(0,Bundle().apply{putString("T13_EXECUTION_WAIT_METERED",awaitingMetered.toString())})
            // Root's automated log watcher changes the actual platform setting. No supplied fact.
            until("Root supplies actual metered transition within the busy interval",8000){meteredAt.get()>0&&network.current().metered}
            fun query():JSONObject{
                val begun=JSONObject(native.beginJson("query",JSONObject().put("executionId",executionId).toString()));assertTrue(begun.toString(),begun.getBoolean("ok"));val operation=begun.getJSONObject("value").getString("operationId");var result=JSONObject()
                until("Read original native execution",5000){val envelope=JSONObject(native.pollJson(operation));assertTrue(envelope.toString(),envelope.getBoolean("ok"));val value=envelope.getJSONObject("value");if(value.getBoolean("pending"))false else{result=value.getJSONObject("result");true}}
                assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value")
            }
            var stopped=JSONObject();until("Whole original download scope confirms stopped while JS is busy",8000){stopped=query();stopped.optString("state")=="stopped"&&stopped.optBoolean("scopeConfirmed")};val confirmedAt=SystemClock.elapsedRealtime()
            assertEquals("network_policy",stopped.getString("cancelReason"));assertEquals(0L,wire.busy().getLong("ended"));assertEquals(0L,store.readControl("policy-chat").getLong("stoppedThrough"))
            val awaitingRestoration=JSONObject().put("run",run).put("observedToConfirmedMs",confirmedAt-meteredAt.get()).put("stopped",stopped)
            println("T13_EXECUTION_WAIT_UNMETERED "+awaitingRestoration)
            instrumentation.sendStatus(0,Bundle().apply{putString("T13_EXECUTION_WAIT_UNMETERED",awaitingRestoration.toString())})
            until("Root restores actual unmetered network",60000){val fact=network.current();fact.known&&!fact.metered};until("Original JS busy finishes",20000){wire.busy().getLong("ended")>0}
            wire.phase("ready");val result=wire.execution(executionId)!!;assertEquals("stopped",result.getString("state"));assertEquals("Network policy stop must not launch a second model request",1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"));assertEquals("Only the original policy operation exists",1,wire.policy().length());assertEquals(0L,store.readControl("policy-chat").getLong("stoppedThrough"))
            val control=store.readControl("policy-chat");NativeStopController.request(context,mode,run,JSONObject().put("id","policy-chat").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            until("Explicit user stop settles the same policy-held invocation"){!store.readControl("policy-chat").has("pendingAbort")};assertEquals("unanswered",wire.call("sendStatus",JSONObject().put("intentId",sent.getString("intentId"))).getJSONObject("submission").getString("status"));assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case","actual-network-download-busy").put("run",run).put("initial",current).put("stopped",stopped).put("busy",busy).put("meteredObservedElapsed",meteredAt.get()).put("confirmedElapsed",confirmedAt).put("observedToConfirmedMs",confirmedAt-meteredAt.get()).put("modelRequests",1).put("executionCount",1).put("networkReturnDidNotReplay",true).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}}}
    }
    @Test(timeout=240000) fun actualLocalFilesAndFixedBashContinueWhileAnotherConversationWaitsForPolicy(){
        val run=id();val mode="execution";val namespace=NativeInputBridge.namespace(mode,run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->try{
            wire.phase("ready");val settings=wire.call("dataSaver.get");assertTrue("Root supplies actual metered network",settings.getJSONObject("network").getBoolean("known")&&settings.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",settings.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"));send(store,wire,"EXEC_SUCCESS")
            var waiting=JSONObject();until("Unknown shell is prepared without holding the writer domain"){val rows=wire.policy();if(rows.length()!=1)return@until false;waiting=rows.getJSONObject(0);waiting.optString("phase")=="waiting"&&!waiting.isNull("finalDigest")}
            wire.call("create",JSONObject().put("creationId","local-chat"))
            val outcomes=org.json.JSONArray()
            for(input in listOf("FILE_QUEUE_SETUP","FILE_QUEUE_LOCAL","FILE_QUEUE_READ","EXEC_LOCAL_PWD")){
                val intent=send(store,wire,input,"local-chat")
                until("Controlled local $input completes without a temporary grant"){wire.call("sendStatus",JSONObject().put("intentId",intent.getString("intentId"))).getJSONObject("submission").optString("status")=="done"}
                val snapshot=wire.call("open",JSONObject().put("id","local-chat"));val entries=snapshot.getJSONArray("entries");var tool=""
                for(index in entries.length()-1 downTo 0){val entry=entries.getJSONObject(index);if(entry.optString("role")=="tool"){tool=entry.optString("text");break}}
                when(input){"FILE_QUEUE_SETUP"->assertTrue(tool,tool.startsWith("FILE-QUEUE-SETUP:"));"FILE_QUEUE_LOCAL"->assertTrue(tool,tool.startsWith("FILE-QUEUE-LOCAL-PASS:"));"FILE_QUEUE_READ"->assertEquals("local\n",JSONObject(tool.removePrefix("FILE-QUEUE-READ:")).getString("text"));else->assertTrue(tool,tool.contains("/workspace"))}
                outcomes.put(JSONObject().put("input",input).put("tool",tool))
                assertEquals("Unknown command remains the same prepared operation","accepted_not_started",wire.execution(waiting.getString("executionId"))!!.getString("state"))
            }
            val local=wire.call("dataSaver.operations",JSONObject().put("id","local-chat")).getJSONArray("operations");assertEquals(3,local.length())
            for(index in 0 until local.length()){val row=local.getJSONObject(index);assertEquals("controlled-local",row.getString("classification"));assertTrue(row.isNull("grantPeriod"));assertEquals("terminal",row.getString("phase"));assertTrue(row.getBoolean("scopeConfirmed"))}
            assertTrue(wire.call("dataSaver.get").getBoolean("enabled"));assertEquals(9,wire.phase("ready").getJSONObject("metrics").getInt("modelRequests"))
            val control=store.readControl("policy-chat");NativeStopController.request(context,mode,run,JSONObject().put("id","policy-chat").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            until("Only the waiting unknown operation is cancelled"){wire.execution(waiting.getString("executionId"))?.optBoolean("neverStarted")==true}
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case","actual-controlled-local-and-policy-writer-order").put("run",run).put("outcomes",outcomes).put("localOperations",local).put("unknownExecutionId",waiting.getString("executionId")).put("temporaryGrants",0).put("modelRequests",9).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}
    }
    @Test(timeout=180000) fun actualSdkOriginalReadAndWriteNeedIndependentPolicyGrants(){originalFlow(false)}
    @Test(timeout=180000) fun actualMimoOriginalReadAndWriteNeedIndependentPolicyGrants(){assumeTrue(InstrumentationRegistry.getArguments().getString("realProvider")=="true");originalFlow(true)}
    private fun originalFlow(real:Boolean){
        val uri=android.net.Uri.parse("content://dev.durableagent.documentsfixture.documents/document/original")
        assertTrue("Requires existing actual system picker read/write grant",context.contentResolver.persistedUriPermissions.any{it.uri==uri&&it.isReadPermission&&it.isWritePermission})
        val before=context.contentResolver.openInputStream(uri)!!.use{it.readBytes()};val beforeText=before.toString(Charsets.UTF_8)
        assertArrayEquals("Dedicated native write fixture must first provide a UTF-8 synthetic original",before,beforeText.toByteArray(Charsets.UTF_8));assertFalse(beforeText.contains('\u0000'))
        val run=id();val mode=if(real)"execution-real" else "execution";val namespace=NativeInputBridge.namespace(mode,run);val documentNamespace=NativeDocumentBridge.namespace(mode,run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));var wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->try{
            wire.phase("ready");val current=wire.call("dataSaver.get");assertTrue(current.getJSONObject("network").getBoolean("known")&&current.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",current.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"))
            val selected=NativeDocumentStore(context,documentNamespace,namespace).use{documents->val waiting=documents.select(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION);val observation=waiting.getJSONObject("observation");assertEquals("waiting",observation.getString("phase"));documents.resumeObservation(waiting.getString("resourceId"),observation.getString("executionId"),observation.getString("requestDigest"),observation.getLong("period"))}
            val resourceId=selected.getString("resourceId");val counter=if(real)"transportRequests" else "modelRequests"
            fun tool(name:String){if(real){wire.client.control(57,name);until("Fixed real tool selected"){wire.phase("ready").getJSONObject("metrics").optString("executionValidationTool")==name}}}
            fun grant(row:JSONObject){wire.call("dataSaver.grant",JSONObject().put("id","policy-chat").put("executionId",row.getString("executionId")).put("requestDigest",row.getString("requestDigest")).put("finalDigest",row.getString("finalDigest")).put("period",row.getLong("period")))}
            fun waitPolicy(kind:String):JSONObject{var result=JSONObject();until("$kind waits independently"){val rows=wire.policy();result=(0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.optString("operationKind")==kind}?:return@until false;result.optString("phase")=="waiting"};return result}
            fun lastTool():String{val entries=wire.call("open",JSONObject().put("id","policy-chat")).getJSONArray("entries");return (entries.length()-1 downTo 0).map(entries::getJSONObject).first{it.optString("role")=="tool"}.getString("text")}
            tool("document_read");val read=send(store,wire,if(real)"Use document_read exactly once on resourceId $resourceId. Then reply with exactly the full observed original text; do not invent content." else "FILE_DOCUMENT_READ:$resourceId")
            val waitingRead=waitPolicy("provider-read");assertEquals(1,wire.phase("ready").getJSONObject("metrics").getInt(counter));grant(waitingRead)
            until("Granted SDK original read finishes"){wire.call("sendStatus",JSONObject().put("intentId",read.getString("intentId"))).getJSONObject("submission").getString("status")=="done"}
            val readResult=JSONObject(lastTool());assertEquals(NativeInputStore.sha256(before),readResult.getString("contentDigest"));assertEquals(beforeText,readResult.getString("text"));assertEquals(2,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            if(real){val entries=wire.call("open",JSONObject().put("id","policy-chat")).getJSONArray("entries");assertTrue("Real model received the original through its actual tool result",(0 until entries.length()).map(entries::getJSONObject).any{it.optString("role")=="assistant"&&it.optString("text").contains(beforeText.trim())})}
            val newContent="native-$run\n";val args=JSONObject().put("resourceId",resourceId).put("expectedDigest",readResult.getString("contentDigest")).put("content",newContent)
            tool("document_write");val write=send(store,wire,if(real)"Use document_write exactly once with these exact JSON arguments: $args . Then report the verified result." else "FILE_DOCUMENT_WRITE:$args")
            val waitingWrite=waitPolicy("provider-write");assertNotEquals(waitingRead.getString("executionId"),waitingWrite.getString("executionId"));assertEquals(3,wire.phase("ready").getJSONObject("metrics").getInt(counter));assertArrayEquals(before,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
            if(!real){wire.call("create",JSONObject().put("creationId","local-chat"));val local=send(store,wire,"FILE_QUEUE_SETUP","local-chat");until("Policy-waiting Provider does not occupy the controlled local writer"){wire.call("sendStatus",JSONObject().put("intentId",local.getString("intentId"))).getJSONObject("submission").getString("status")=="done"};val files=wire.call("files.list",JSONObject().put("id","local-chat")).getJSONArray("changes");assertTrue(files.length()>0);assertEquals("completed",files.getJSONObject(0).getString("state"));assertArrayEquals(before,context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})}
            grant(waitingWrite);until("Independently granted original write finishes"){wire.call("sendStatus",JSONObject().put("intentId",write.getString("intentId"))).getJSONObject("submission").getString("status")=="done"}
            assertTrue(lastTool(),lastTool().startsWith("原件写入已核验"));assertArrayEquals(newContent.toByteArray(Charsets.UTF_8),context.contentResolver.openInputStream(uri)!!.use{it.readBytes()})
            val expectedRequests=if(real)4 else 6;assertEquals(expectedRequests,wire.phase("ready").getJSONObject("metrics").getInt(counter));val history=wire.call("history",JSONObject().put("id","policy-chat").put("limit",25)).getJSONArray("items").toString()
            if(!real){page.close();wire.client.control(20,"close");wire.phase("closed");wire.close();wire=Wire(mode,run);wire.phase("ready");assertEquals(0,wire.phase("ready").getJSONObject("metrics").optInt(counter,0));assertEquals(history,wire.call("history",JSONObject().put("id","policy-chat").put("limit",25)).getJSONArray("items").toString())}
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case",if(real)"real-mimo-original-independent-grants" else "actual-sdk-original-independent-grants").put("run",run).put("resourceId",resourceId).put("uri",uri.toString()).put("oldDigest",NativeInputStore.sha256(before)).put("newDigest",NativeInputStore.sha256(newContent.toByteArray(Charsets.UTF_8))).put("readPolicy",waitingRead).put("writePolicy",waitingWrite).put("requests",expectedRequests).put("hostReopened",!real).put("reopenRequests",if(real)JSONObject.NULL else 0).put("localContinuedWhileProviderWaited",!real).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}
    }
    private fun flow(real:Boolean){
        val run=id();val mode=if(real)"execution-real" else "execution";val namespace=NativeInputBridge.namespace(mode,run)
        val page=ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode",mode).putExtra("validationRun",run));val wire=Wire(mode,run);var primary:Throwable?=null
        NativeInputStore(context,namespace).withLeaseWait(1000).use{store->try{
            wire.phase("ready");val current=wire.call("dataSaver.get");assertTrue("Root must provide an actually known metered network",current.getJSONObject("network").getBoolean("known")&&current.getJSONObject("network").getBoolean("metered"))
            wire.call("dataSaver.configure",JSONObject().put("enabled",true).put("expectedVersion",current.getLong("version")));wire.call("create",JSONObject().put("creationId","policy-chat"))
            val marker="T13-${run.take(8)}";val text=if(real)"Use bash exactly once with: printf '$marker\\n' . Then report its output." else "EXEC_SUCCESS"
            val first=send(store,wire,text);var waiting=JSONObject()
            until("Actual executor has prepared one fixed request awaiting policy"){val rows=wire.policy();if(rows.length()!=1)return@until false;waiting=rows.getJSONObject(0);waiting.optString("phase")=="waiting"&&!waiting.isNull("finalDigest")}
            val executionId=waiting.getString("executionId");assertEquals("unknown",waiting.getString("classification"));assertEquals("accepted_not_started",wire.execution(executionId)!!.getString("state"))
            val counter=if(real)"transportRequests" else "modelRequests";assertEquals("Model communication is exempt while the tool waits",1,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            fun grant(row:JSONObject)=JSONObject().put("id","policy-chat").put("executionId",row.getString("executionId")).put("requestDigest",row.getString("requestDigest")).put("finalDigest",row.getString("finalDigest")).put("period",row.getLong("period"))
            wire.call("dataSaver.grant",grant(waiting));until("Exactly granted command and model follow-up finish"){wire.call("sendStatus",JSONObject().put("intentId",first.getString("intentId"))).optJSONObject("submission")?.optString("status")=="done"}
            val completed=wire.execution(executionId)!!;assertEquals("completed",completed.getString("state"));assertEquals(0,completed.getInt("exitCode"));assertTrue(wire.call("dataSaver.get").getBoolean("enabled"));assertEquals(2,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            val second=send(store,wire,text);var next=JSONObject();until("New explicit execution does not inherit the prior grant"){val rows=wire.policy();next=(0 until rows.length()).map(rows::getJSONObject).firstOrNull{it.getString("executionId")!=executionId}?:return@until false;next.optString("phase")=="waiting"&&!next.isNull("finalDigest")}
            assertEquals("accepted_not_started",wire.execution(next.getString("executionId"))!!.getString("state"))
            val control=store.readControl("policy-chat");NativeStopController.request(context,mode,run,JSONObject().put("id","policy-chat").put("actionId",id()).put("expectedControlVersion",control.getLong("version")))
            until("Explicit user stop settles the waiting SDK invocation"){!store.readControl("policy-chat").has("pendingAbort")}
            val refused=wire.envelope("dataSaver.grant",grant(next));assertFalse(refused.toString(),refused.getBoolean("ok"));assertTrue(refused.getJSONObject("error").getString("code") in setOf("EXECUTION_STOPPED","SUBMISSION_STOPPED"))
            val stopped=wire.execution(next.getString("executionId"))!!;assertTrue(stopped.optBoolean("neverStarted")&&stopped.optBoolean("scopeConfirmed"));assertEquals(3,wire.phase("ready").getJSONObject("metrics").getInt(counter))
            assertEquals("unanswered",wire.call("sendStatus",JSONObject().put("intentId",second.getString("intentId"))).getJSONObject("submission").getString("status"))
            instrumentation.sendStatus(0,Bundle().apply{putString("dataSaverExecutionEvidence",JSONObject().put("case",if(real)"real-mimo-metered-grant" else "actual-termux-metered-grant").put("network",current.getJSONObject("network")).put("waiting",waiting).put("completed",completed).put("stoppedNext",stopped).put("requestsBeforeGrant",1).put("totalRequests",3).put("globalEnabled",true).toString())})
        }catch(error:Throwable){primary=error;throw error}finally{page.close();try{wire.client.control(20,"close");wire.phase("closed")}catch(error:Throwable){if(primary!=null)primary.addSuppressed(error)else throw error}finally{wire.close()}}}
    }
}
