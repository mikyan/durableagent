package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.os.*
import com.caoccao.javet.enums.V8AwaitMode
import com.caoccao.javet.interop.NodeRuntime
import com.caoccao.javet.interop.V8Host
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipInputStream

/** Candidate-validation host. All JNI calls belong to this one thread. */
class RuntimeService : Service() {
    private val thread=HandlerThread("PiNodeOwner")
    private lateinit var owner:Handler
    private var runtime:NodeRuntime?=null
    private var instance=""
    private var startedAt=0L
    private var stopping=false
    private var restart:String?=null
    @Volatile private var state="{\"status\":\"new\"}"
    private val messenger=Messenger(Handler(Looper.getMainLooper()) { message ->
        if(message.what==1) {
            val action=message.data.getString("command")?:""
            if(action.startsWith("start") && JSONObject(state).optString("status") in setOf("failed","closed","new")) {
                state=JSONObject().put("status","starting").toString()
            }
            owner.post { command(action) }
        }
        if(message.what==2) message.replyTo?.send(Message.obtain(null,2).apply { data=Bundle().apply {putString("state",state)} })
        true
    })
    override fun onCreate() { super.onCreate();thread.start();owner=Handler(thread.looper);owner.post {try {ValidationCredential.prepare(this)}catch(error:Throwable){fail("validation-key",error)}} }
    override fun onBind(intent:Intent)=messenger.binder
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int)=START_NOT_STICKY
    private fun command(command:String) {
        try {
            if(command.startsWith("start") && stopping) {restart=command;return}
            if(command in setOf("start","start-tool","start-invalid","start-hang","start-real") && runtime==null) { open(command.removePrefix("start-"));return }
            if(command=="fault") {runtime?.getExecutor("throw new Error('Injected validation runtime fault')")?.executeVoid();return}
            if(command !in setOf("start","send","send-long","stop","close"))return
            if(command=="close") {
                stopping=true
                if(runtime?.getExecutor("typeof globalThis.__command")?.executeString() != "function") {
                    finishClose(JSONObject(state).put("status","closed"));return
                }
            }
            runtime?.getExecutor("globalThis.__command?.(${JSONObject.quote(command)})")?.executeVoid()
        } catch(error:Throwable) { fail("command",error) }
    }
    private fun open(mode:String) {
        instance=UUID.randomUUID().toString()
        startedAt=SystemClock.elapsedRealtime()
        state=JSONObject().put("status","loading").put("instance",instance).toString()
        try {
            val root=unpack()
            val node=V8Host.getNodeI18nInstance().createV8Runtime<NodeRuntime>()
            runtime=node
            if(mode=="real") {
                val clear=ValidationCredential.consume(this)
                try {node.globalObject.set("__validationKey",String(clear,Charsets.UTF_8).trim())}finally {clear.fill(0)}
            }
            val entry=File(root,"dist/bridge.js").toURI().toString()
            val source="import(${JSONObject.quote(entry)}).then(m=>m.install(${JSONObject.quote(mode)})).catch(e=>{globalThis.__snapshot=JSON.stringify({status:'failed',phase:'loader',error:String(e.stack||e)})})"
            node.getExecutor("globalThis.__snapshot='{}'; const vm=require('node:vm'); new vm.Script(${JSONObject.quote(source)}, {importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();").executeVoid()
            owner.post(pump)
        } catch(error:Throwable) { fail("native-or-loader",error) }
    }
    private val pump=object:Runnable {
        override fun run() {
            val node=runtime?:return
            try {
                node.await(V8AwaitMode.RunNoWait)
                val next=JSONObject(node.getExecutor("globalThis.__snapshot || '{}'").executeString())
                if(next.has("status")) {
                    next.put("instance",instance).put("pid",Process.myPid()).put("elapsedMs",SystemClock.elapsedRealtime()-startedAt).put("nativeOwners",V8Host.getNodeI18nInstance().v8RuntimeCount)
                    if(next.optString("status")=="closed") {finishClose(next);return}
                    if(next.optString("status")=="failed") {finishClose(next);return}
                    state=next.toString()
                }
                owner.postDelayed(this,5)
            } catch(error:Throwable) {fail("runtime",error)}
        }
    }
    private fun finishClose(next:JSONObject) {
        val start=SystemClock.elapsedRealtime()
        runtime?.close();runtime=null;stopping=false
        next.put("nativeCloseMs",SystemClock.elapsedRealtime()-start).put("nativeOwners",V8Host.getNodeI18nInstance().v8RuntimeCount)
        state=next.toString()
        restart?.let {restart=null;command(it)}
    }
    private fun fail(phase:String,error:Throwable) {
        val failure=JSONObject().put("status","failed").put("phase",phase).put("error",error.stackTraceToString()).put("instance",instance)
        try {finishClose(failure)}catch(closeError:Throwable) {state=failure.put("closeError",closeError.toString()).toString()}
        android.util.Log.e("RuntimeProbe",state)
    }
    private fun unpack():File {
        val digest=assets.open("runtime.zip").use { input ->
            val sha=MessageDigest.getInstance("SHA-256");val bytes=ByteArray(65536)
            while(true) {val n=input.read(bytes);if(n<0)break;sha.update(bytes,0,n)}
            sha.digest().joinToString(""){"%02x".format(it)}
        }
        val root=File(filesDir,"probe-bundles/$digest")
        if(File(root,".complete").exists())return root
        root.mkdirs()
        ZipInputStream(assets.open("runtime.zip")).use { zip ->
            while(true) {
                val entry=zip.nextEntry?:break
                val file=File(root,entry.name)
                check(file.canonicalPath.startsWith(root.canonicalPath+File.separator)) {"Invalid bundled path"}
                if(entry.isDirectory)file.mkdirs() else {file.parentFile!!.mkdirs();file.outputStream().use {zip.copyTo(it)}}
            }
        }
        File(root,".complete").writeText(digest)
        return root
    }
    override fun onDestroy() { owner.post {try {runtime?.close()} finally {runtime=null;thread.quitSafely()}};super.onDestroy() }
}
