package dev.durableagent.probe

import android.app.Service
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.*
import com.caoccao.javet.enums.V8AwaitMode
import com.caoccao.javet.interop.NodeRuntime
import com.caoccao.javet.interop.V8Host
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** One native owner for the product Storage/Session; UI bindings never own its lifetime. */
class ApplicationService:Service() {
    private val thread=HandlerThread("ApplicationNodeOwner")
    private lateinit var owner:Handler
    private var node:NodeRuntime?=null
    private var lease:StorageDomainLease?=null
    private var instance=""
    private var phase="{\"phase\":\"opening\"}"
    private var closing=false
    private var closeDispatched=false
    private var credentials:NativeCredentialAccess?=null
    private var inputs:NativeInputAccess?=null
    private val busyStarted=AtomicLong(0)
    private val busyEnded=AtomicLong(0)
    private val submissionProbe=SubmissionValidationProbe()
    private val peers=mutableMapOf<String,Messenger>()
    private val pending=mutableListOf<String>()
    private data class Outgoing(val what:Int,val json:String,val eventKey:String?,val id:String=UUID.randomUUID().toString(),var index:Int=0,var timeout:Runnable?=null) {val count=(json.length+47999)/48000}
    private val outgoing=mutableMapOf<IBinder,ArrayDeque<Outgoing>>()
    private data class Incoming(val peer:Messenger,val count:Int,val text:StringBuilder=StringBuilder(),var next:Int=0,var timeout:Runnable?=null)
    private val incoming=mutableMapOf<String,Incoming>()
    private val debug get()=(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)!=0
    private val messenger=Messenger(Handler(Looper.getMainLooper()){message ->
        // Android recycles Message after this callback: capture values now.
        val what=message.what;val text=message.data.getString("json")?:"";val reply=message.replyTo
        val transfer=message.data.getString("transfer")?:"";val index=message.data.getInt("index");val count=message.data.getInt("count")
        if(debug&&what==35){
            val value=JSONObject().put("pid",Process.myPid()).put("started",busyStarted.get()).put("ended",busyEnded.get()).put("observedAt",SystemClock.elapsedRealtime())
            try{reply?.send(Message.obtain(null,35).apply{data=Bundle().apply{putString("json",value.toString())}})}catch(_:RemoteException){}
            return@Handler true
        }
        if(debug&&what==37){try{reply?.send(Message.obtain(null,37).apply{data=Bundle().apply{putString("json",submissionProbe.state().toString())}})}catch(_:RemoteException){};return@Handler true}
        if(debug&&what==38&&submissionProbe.halted()){Process.killProcess(Process.myPid());return@Handler true}
        owner.post {
            when(what){
                10->if(reply!=null)accept(text,reply)
                11->detach(text,reply)
                12->reply?.let {send(it,12,status())}
                14->reply?.let {acknowledge(it,text)}
                15->reply?.let {receiveInput(it,transfer,index,count,text)}
                20->if(debug&&text=="close"){closing=true;if(node==null){phase="{\"phase\":\"closed\"}";release()}}
                30->reply?.let {writeCredential(text,it)}
                31->if(debug)reply?.let {importValidationCredential(text,it)}
                32->if(debug)node?.getExecutor("globalThis.__appRunModelPolicy?.()")?.executeVoid()
                33->if(debug)node?.getExecutor("globalThis.__appRunInputPolicy?.()")?.executeVoid()
                36->if(debug)reply?.let {node?.getExecutor("globalThis.__appSubmissionFault?.(${JSONObject.quote(text)})")?.executeVoid();send(it,36,status())}
                41->if(debug)reply?.let {node?.getExecutor("globalThis.__appProjectWitness?.(${JSONObject.quote(text)})")?.executeVoid();send(it,41,status())}
                42->if(debug)node?.getExecutor("globalThis.__appRunProjectPolicy?.()")?.executeVoid()
                51->if(debug)reply?.let {node?.getExecutor("globalThis.__appExtensionRoute?.(${JSONObject.quote(text)})")?.executeVoid();send(it,51,status())}
                52->if(debug)node?.getExecutor("globalThis.__appRunExtensionPolicy?.()")?.executeVoid()
                40->if(debug)node?.getExecutor("globalThis.__appRunSubmissionPolicy?.()")?.executeVoid()
                34->if(debug&&node!=null){
                    val duration=(text.toLongOrNull()?:10000).coerceIn(2500,15000)
                    busyEnded.set(0);busyStarted.set(SystemClock.elapsedRealtime())
                    try{node?.getExecutor("{const until=Date.now()+$duration;while(Date.now()<until){Math.sqrt(Math.random());}}")?.executeVoid()}
                    finally{busyEnded.set(SystemClock.elapsedRealtime())}
                }
            }
        };true
    })
    override fun onCreate(){super.onCreate();thread.start();owner=Handler(thread.looper);if(debug)owner.post{ValidationCredential.prepare(this)}}
    override fun onBind(intent:Intent)=messenger.binder
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val mode=if(debug)intent?.getStringExtra("validationMode")?:"product" else "product"
        val run=if(debug)intent?.getStringExtra("validationRun") else null
        owner.post {if(node==null&&!closing)open(mode,run)}
        return START_NOT_STICKY
    }
    private fun open(mode:String,run:String?) {
        try {
            check(mode in setOf("product","fixture","hang","real","models","models-fixture","extensions-fixture","extensions-real"))
            check(mode=="product"||run?.matches(Regex("[a-zA-Z0-9-]{1,80}"))==true)
            val domain=File(filesDir,if(mode=="product")"application" else "application-validation/$run")
            lease=StorageDomainLease.acquire(domain)?:error("Application storage already owned")
            instance=UUID.randomUUID().toString();phase="{\"phase\":\"opening\"}"
            val root=RuntimeBundle.unpack(this)
            val runtime=V8Host.getNodeI18nInstance().createV8Runtime<NodeRuntime>();node=runtime
            runtime.globalObject.set("__applicationRoot",domain.absolutePath)
            if(debug&&mode!="product")runtime.createV8ValueObject().use{probe->probe.bind(submissionProbe);runtime.globalObject.set("__submissionValidation",probe)}
            credentials=NativeCredentialAccess(CredentialVault(this,if(mode=="product")"credentials-v1" else "cv-$run"))
            runtime.createV8ValueObject().use {access->access.bind(credentials!!);runtime.globalObject.set("__nativeCredentials",access)}
            inputs=NativeInputAccess(NativeInputStore(this,NativeInputBridge.namespace(mode,run)))
            runtime.createV8ValueObject().use {access->access.bind(inputs!!);runtime.globalObject.set("__nativeInputs",access)}
            if(mode=="real"||mode=="extensions-real"){
                val clear=ValidationCredential.consume(this)
                try{runtime.globalObject.set("__validationKey",String(clear,Charsets.UTF_8).trim())}finally{clear.fill(0)}
            }
            val entry=File(root,"dist/application-bridge.js").toURI().toString()
            val source="import(${JSONObject.quote(entry)}).then(m=>m.install(${JSONObject.quote(mode)})).catch(e=>{globalThis.__appFailure=String(e.message||e)})"
            runtime.getExecutor("const vm=require('node:vm');new vm.Script(${JSONObject.quote(source)},{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();").executeVoid()
            owner.post(pump)
        }catch(error:Throwable){fail(error)}
    }
    private fun accept(text:String,peer:Messenger){
        try {
            check(text.length<=650000);val request=JSONObject(text)
            val connection=request.getString("connectionId");check(connection.length in 1..128)
            if(peers[connection]?.binder!=peer.binder){
                peers[connection]=peer
                peer.binder.linkToDeath({owner.post {
                    val ids=peers.filterValues{it.binder==peer.binder}.keys.toList()
                    for(id in ids)detach(id,peer)
                }},0)
            }
            if(node==null||JSONObject(phase).optString("phase")=="failed"){
                send(peer,10,JSONObject().put("type","response").put("protocol",1).put("connectionId",connection).put("requestId",request.optString("requestId")).put("ok",false).put("error",JSONObject().put("code","HOST_NOT_READY").put("message",JSONObject(phase).optString("reason","运行宿主尚未就绪"))).toString());return
            }
            pending.add(text)
        }catch(_:Throwable){/* Invalid wire messages cannot reach the SDK. */}
    }
    private fun credentialTarget(target:String):Boolean=node?.getExecutor("globalThis.__appCredentialTarget?.(${JSONObject.quote(target)})===true")?.executeBoolean()==true
    private fun writeCredential(text:String,peer:Messenger){
        var request:JSONObject?=null
        val result=try{
            check(text.length<=120000);request=JSONObject(text)
            check(request.getInt("protocol")==1&&request.getString("connectionId").length in 1..128&&request.getString("requestId").length in 1..128)
            val allowed=setOf("protocol","connectionId","requestId","operation","target","expectedGeneration","key")
            check(request.keys().asSequence().all{it in allowed})
            val target=request.getString("target");check(credentialTarget(target))
            val generation=request.getLong("expectedGeneration");check(generation>=0)
            JSONObject(when(request.getString("operation")){"save"->credentials!!.saveJson(target,request.getString("key"),generation);"remove"->{check(!request.has("key"));credentials!!.removeJson(target,generation)};else->error("Invalid credential operation")})
        }catch(_:Exception){JSONObject().put("ok",false).put("error",JSONObject().put("code","CREDENTIAL_WRITE_REJECTED").put("message","凭据操作未完成，请刷新连接状态后重试。"))}
        // Never place the supplied request, key or platform cause in an error or generic Node queue.
        send(peer,10,result.put("type","response").put("protocol",1).put("connectionId",request?.optString("connectionId")?:"").put("requestId",request?.optString("requestId")?:"").toString())
    }
    private fun importValidationCredential(text:String,peer:Messenger){
        val result=try{
            val request=JSONObject(text);val target=request.getString("target");check(credentialTarget(target))
            val clear=ValidationCredential.consume(this)
            try{JSONObject(credentials!!.saveJson(target,String(clear,Charsets.UTF_8).trim(),request.getLong("expectedGeneration")))}finally{clear.fill(0)}
        }catch(_:Exception){JSONObject().put("ok",false).put("error",JSONObject().put("code","VALIDATION_IMPORT_FAILED").put("message","Encrypted validation import unavailable"))}
        send(peer,31,result.toString())
    }
    private val pump=object:Runnable {override fun run(){
        val runtime=node?:return
        try {
            runtime.await(V8AwaitMode.RunNoWait)
            val failure=runtime.getExecutor("globalThis.__appFailure||''").executeString()
            if(failure.isNotEmpty())error(failure)
            // The debug close can arrive after native creation but before the asynchronous
            // module import installs its close function. Retain it until that owner exists.
            if(closing&&!closeDispatched&&runtime.getExecutor("typeof globalThis.__appClose").executeString()=="function"){
                closeDispatched=true;runtime.getExecutor("globalThis.__appClose()").executeVoid()
            }
            if(runtime.getExecutor("typeof globalThis.__appRequest").executeString()=="function"){
                val requests=pending.toList();pending.clear()
                for(request in requests)runtime.getExecutor("globalThis.__appRequest(${JSONObject.quote(request)})").executeVoid()
                val events=JSONArray(runtime.getExecutor("globalThis.__takeAppEvents()").executeString())
                for(i in 0 until events.length()){val event=events.getJSONObject(i);peers[event.optString("connectionId")]?.let {send(it,10,event.toString())}}
                phase=runtime.getExecutor("globalThis.__appStatus()").executeString()
                if(runtime.getExecutor("globalThis.__appClosed===true").executeBoolean()){release();return}
            }
            owner.postDelayed(this,5)
        }catch(error:Throwable){fail(error)}
    }}
    private fun transportFailure(peer:Messenger,reason:String){outgoing.remove(peer.binder)?.forEach{it.timeout?.let(owner::removeCallbacks)};try{peer.send(Message.obtain(null,0).apply{data=Bundle().apply{putString("json",reason)}})}catch(_:RemoteException){}}
    private fun detach(connection:String,hint:Messenger?){
        val peer=peers[connection]?:hint
        if(hint!=null&&peer?.binder!=hint.binder)return
        peers.remove(connection);node?.getExecutor("globalThis.__appDisconnect?.(${JSONObject.quote(connection)})")?.executeVoid()
        if(peer!=null&&peers.values.none{it.binder==peer.binder}){
            outgoing.remove(peer.binder)?.forEach{it.timeout?.let(owner::removeCallbacks)}
            for((id,item)in incoming.filterValues{it.peer.binder==peer.binder}){incoming.remove(id);item.timeout?.let(owner::removeCallbacks)}
        }
    }
    private fun send(peer:Messenger,what:Int,json:String){
        if(json.length>8*1024*1024){transportFailure(peer,"此视图超过 16 MiB 传输上限，数据仍保留，请缩小历史范围。");return}
        val event=runCatching{JSONObject(json)}.getOrNull()
        val key=if(event?.optString("type")=="conversation")event.optString("connectionId")+"/"+event.optString("subscriptionId") else null
        val queue=outgoing.getOrPut(peer.binder){ArrayDeque()}
        // Fold queued state projections; action responses and the in-flight snapshot remain intact.
        if(key!=null){val previous=queue.drop(1).filter{it.eventKey==key};for(item in previous)queue.remove(item)}
        if(queue.sumOf{it.json.length}+json.length>16*1024*1024||queue.size>=64){transportFailure(peer,"界面读取速度不足，数据仍保留，请重新连接。");return}
        val empty=queue.isEmpty();queue.addLast(Outgoing(what,json,key));if(empty)sendFragment(peer)
    }
    private fun sendFragment(peer:Messenger){
        val item=outgoing[peer.binder]?.firstOrNull()?:return;val index=item.index
        val part=item.json.substring(index*48000,minOf((index+1)*48000,item.json.length))
        try{peer.send(Message.obtain(null,13).apply{data=Bundle().apply{putString("transfer",item.id);putInt("index",index);putInt("count",item.count);putInt("kind",item.what);putString("json",part)}})}catch(_:RemoteException){outgoing.remove(peer.binder);return}
        item.timeout=Runnable{if(outgoing[peer.binder]?.firstOrNull()===item&&item.index==index)transportFailure(peer,"界面传输确认超时，请重新连接查看已保存状态。")};owner.postDelayed(item.timeout!!,30000)
    }
    private fun acknowledge(peer:Messenger,text:String){
        val ack=runCatching{JSONObject(text)}.getOrNull()?:return;val queue=outgoing[peer.binder]?:return;val item=queue.firstOrNull()?:return
        if(ack.optString("transfer")!=item.id||ack.optInt("index",-1)!=item.index)return
        item.timeout?.let(owner::removeCallbacks);item.timeout=null
        item.index++;if(item.index==item.count)queue.removeFirst()
        if(queue.isEmpty())outgoing.remove(peer.binder) else sendFragment(peer)
    }
    private fun receiveInput(peer:Messenger,id:String,index:Int,count:Int,text:String){
        if(index==0&&id.length in 1..128&&count in 1..14&&incoming.size<8){
            val item=Incoming(peer,count);incoming[id]=item
            item.timeout=Runnable{if(incoming.remove(id)===item)transportFailure(peer,"输入传输未完成，尚未提交，请重新连接查看状态。")};owner.postDelayed(item.timeout!!,30000)
        }
        val item=incoming[id]
        if(item==null||item.peer.binder!=peer.binder||item.next!=index||item.count!=count||text.length>48000||item.text.length+text.length>650000){transportFailure(peer,"输入传输无效，尚未提交。");return}
        item.text.append(text);item.next++
        try{peer.send(Message.obtain(null,16).apply{data=Bundle().apply{putString("transfer",id);putInt("index",index)}})}catch(_:RemoteException){incoming.remove(id);item.timeout?.let(owner::removeCallbacks);return}
        if(item.next==count){incoming.remove(id);item.timeout?.let(owner::removeCallbacks);accept(item.text.toString(),peer)}
    }
    private fun status()=JSONObject(phase).put("instance",instance).put("pid",Process.myPid()).put("domainOwned",lease!=null).put("nativeOwners",V8Host.getNodeI18nInstance().v8RuntimeCount).toString()
    private fun fail(error:Throwable){phase=JSONObject().put("phase","failed").put("reason",error.message?:error.javaClass.simpleName).toString();release()}
    private fun release(){node?.close();node=null;credentials=null;inputs?.close();inputs=null;lease?.close();lease=null;closing=false;closeDispatched=false;pending.clear()}
    override fun onDestroy(){owner.post {release();thread.quitSafely()};super.onDestroy()}
}
