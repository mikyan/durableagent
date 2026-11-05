package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.os.*
import com.caoccao.javet.enums.V8AwaitMode
import com.caoccao.javet.interop.NodeRuntime
import com.caoccao.javet.interop.V8Host
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Temporary debug-only observation: same :agent process, separate Node owner; never receives arbitrary code. */
class ExecutionChannelProbeService : Service() {
    private val thread = HandlerThread("ExecutionChannelProbe")
    private lateinit var owner: Handler
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { message ->
        val reply = message.replyTo
        val operation = message.data.getString("operation") ?: ""
        if (reply != null && operation in setOf("ping", "file", "command")) owner.post {
            val result = try { observe(operation) } catch (error: Throwable) {
                JSONObject().put("ok", false).put("stage", "probe-host").put("exception", error.javaClass.simpleName)
            }
            result.put("operation", operation).put("pid", Process.myPid()).put("process", android.app.Application.getProcessName())
                .put("sameApplicationServiceProcess", true).put("separateNodeOwner", true)
            try { reply.send(Message.obtain(null, 1).apply { data = Bundle().apply { putString("json", result.toString()) } }) }
            catch (_: RemoteException) { }
        }
        true
    })
    override fun onCreate() { super.onCreate(); thread.start(); owner = Handler(thread.looper) }
    override fun onBind(intent: Intent): IBinder = messenger.binder
    override fun onDestroy() { thread.quitSafely(); super.onDestroy() }

    private fun observe(operation: String): JSONObject {
        val run = UUID.randomUUID().toString()
        val namespace = "execution-probe-$run"
        val workspace = "/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace"
        val pairing = ExecutionPairingStore(this).use { it.read() } ?: return JSONObject().put("ok", false).put("stage", "pairing").put("code", "PAIRING_MISSING")
        val request = JSONObject().put("executionId", "diagnostic-$run")
            .put("context", JSONObject().put("productId", "diagnostic").put("sdkConversationId", 101).put("controlGeneration", 1)
                .put("namespace", "termux:${pairing.executorId}").put("taskId", 201).put("callId", "diagnostic")
                .put("bindingId", "diagnostic-binding").put("locationVersion", 1))
            .put("command", JSONObject().put("kind", "shell").put("script", "builtin pwd -P"))
            .put("cwd", workspace).put("env", JSONObject()).put("inheritEnv", false).put("timeoutMs", 1000)
        if (operation == "command") NativeInputStore(this, namespace).use { inputs ->
            inputs.rememberConversation(JSONObject().put("id", "diagnostic").put("title", "Read-only execution diagnostic")
                .put("model", JSONObject().put("provider", "fixture").put("modelId", "test").put("name", "Diagnostic")), null)
        }
        val root = RuntimeBundle.unpack(this)
        ExecutionAccess(this, namespace).use { access ->
            V8Host.getNodeI18nInstance().createV8Runtime<NodeRuntime>().use { runtime ->
                runtime.createV8ValueObject().use { bound -> bound.bind(access); runtime.globalObject.set("__diagnosticNative", bound) }
                val module = JSONObject.quote(File(root, "dist/execution-channel.js").toURI().toString())
                val source = """
                    globalThis.__diagnosticTrace=[];globalThis.__diagnosticStage='import';
                    (async()=>{
                      const {NativeExecutionChannel}=await import($module);
                      const native=globalThis.__diagnosticNative, trace=globalThis.__diagnosticTrace;
                      const summarize=(boundary,raw)=>{const value=JSON.parse(raw);if(boundary!=='poll'||value.ok===false||value.value?.pending===false)trace.push({boundary,ok:value.ok,code:value.error?.code,pending:value.value?.pending,resultOk:value.value?.result?.ok,resultCode:value.value?.result?.error?.code});return raw;};
                      const channel=new NativeExecutionChannel({
                        beginJson:(method,payload)=>summarize('begin:'+method,native.beginJson(method,payload)),
                        pollJson:id=>summarize('poll',native.pollJson(id)),
                        rememberIntentJson:payload=>summarize('rememberIntent',native.rememberIntentJson(payload))
                      });
                      const step=async(name,action)=>{globalThis.__diagnosticStage=name;const started=performance.now();try{const result=await action();trace.push({stage:name,ok:true,elapsedMs:Math.round(performance.now()-started)});return result;}catch(error){trace.push({stage:name,ok:false,name:error.name,code:error.code,elapsedMs:Math.round(performance.now()-started)});throw error;}};
                      const ping=await step('ping',()=>channel.request('ping',{}));
                      if(ping.protocol!==1||ping.namespace!=='termux:'+ping.executorId)throw Object.assign(Error('Identity shape'),{code:'DIAGNOSTIC_IDENTITY'});
                      const operation=${JSONObject.quote(operation)}, request=$request;
                      if(operation==='file'){
                        const result=await step('file.stat',()=>channel.request('file.stat',{path:${JSONObject.quote(workspace)}}));
                        if(result.ok!==true)throw Object.assign(Error('File response'),{code:result.error?.code??'DIAGNOSTIC_FILE_RESULT'});
                      }
                      if(operation==='command'){
                        await step('rememberIntent',()=>channel.rememberIntent(request));
                        const prepared=await step('prepare',()=>channel.request('prepare',request));
                        let receipt=await step('start',()=>channel.request('start',{executionId:request.executionId,finalDigest:prepared.finalDigest}));
                        const deadline=performance.now()+5000;
                        while(!['completed','stopped','not_started','unknown'].includes(receipt.state)&&performance.now()<deadline){await new Promise(resolve=>setTimeout(resolve,20));receipt=await step('query',()=>channel.request('query',{executionId:request.executionId}));}
                        if(receipt.state!=='completed'||receipt.exitCode!==0)throw Object.assign(Error('Command not completed'),{code:'DIAGNOSTIC_COMMAND_'+String(receipt.state).toUpperCase()});
                      }
                      globalThis.__diagnosticResult=JSON.stringify({ok:true,stage:globalThis.__diagnosticStage,trace});
                    })().catch(error=>{globalThis.__diagnosticResult=JSON.stringify({ok:false,stage:globalThis.__diagnosticStage,name:error.name,code:error.code,trace:globalThis.__diagnosticTrace});});
                """.trimIndent()
                runtime.getExecutor("const vm=require('node:vm');new vm.Script(${JSONObject.quote(source)},{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();").executeVoid()
                val deadline = SystemClock.elapsedRealtime() + 12000
                while (runtime.getExecutor("typeof globalThis.__diagnosticResult").executeString() != "string") {
                    runtime.await(V8AwaitMode.RunNoWait)
                    if (SystemClock.elapsedRealtime() >= deadline) {
                        val partial = JSONObject(runtime.getExecutor("JSON.stringify({ok:false,stage:globalThis.__diagnosticStage,code:'DIAGNOSTIC_WAIT_EXPIRED',trace:globalThis.__diagnosticTrace})").executeString())
                        access.close()
                        repeat(5) { runtime.await(V8AwaitMode.RunNoWait); Thread.sleep(20) }
                        return partial
                    }
                    Thread.sleep(5)
                }
                return JSONObject(runtime.getExecutor("globalThis.__diagnosticResult").executeString())
            }
        }
    }
}
