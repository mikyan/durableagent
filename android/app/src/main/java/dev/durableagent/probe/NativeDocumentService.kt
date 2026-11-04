package dev.durableagent.probe

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Bounded native I/O; tokens correlate requests, while Store owns durable receipts.
 * Control workers never invoke a Provider. These workers confer no workspace ownership.
 */
class NativeDocumentService(context:Context,namespace:String,inputNamespace:String):AutoCloseable {
    private val store=NativeDocumentStore(context,namespace,inputNamespace)
    private data class Request(val control:Boolean,var result:JSONObject?=null,var completedAt:Long=0)
    private val requests=mutableMapOf<String,Request>()
    private val ordinary=pool(2,8,"OriginalDocumentIO")
    private val control=pool(2,8,"OriginalDocumentControl")
    private var closed=false
    fun beginJson(method:String,payloadJson:String):String=envelope{
        if(method !in METHODS)fail("DOCUMENT_UNKNOWN_ACTION","未登记的原文件操作。")
        if(payloadJson.toByteArray(Charsets.UTF_8).size>60000)fail("DOCUMENT_FRAME_LIMIT","原文件请求过大。")
        val payload=JSONObject(payloadJson);val token=UUID.randomUUID().toString();val isControl=method in setOf("query","cancel")
        synchronized(requests){
            expire();if(closed)fail("DOCUMENT_CHANNEL_CLOSED","原文件通道已关闭，请重新连接。")
            if(requests.values.count{it.control==isControl}>=if(isControl)12 else 24)fail("DOCUMENT_CHANNEL_BUSY","原文件请求较多，请稍后核验。")
            requests[token]=Request(isControl)
        }
        try{(if(isControl)control else ordinary).execute{
            val result=JSONObject(envelope{perform(method,payload)})
            synchronized(requests){requests[token]?.let{it.result=result;it.completedAt=SystemClock.elapsedRealtime()}}
        }}catch(_:RejectedExecutionException){synchronized(requests){requests.remove(token)};fail("DOCUMENT_CHANNEL_BUSY","原文件请求较多，请稍后核验。")}
        JSONObject().put("operationId",token)
    }
    fun pollJson(token:String):String=envelope{
        synchronized(requests){
            expire();val request=requests[token]?:fail("DOCUMENT_REQUEST_LOST","原文件请求关联已失效，请用原操作身份查询；不会重新写入。")
            if(request.result==null)JSONObject().put("pending",true)
            else JSONObject().put("pending",false).put("result",request.result).also{requests.remove(token)}
        }
    }
    private fun perform(method:String,payload:JSONObject):JSONObject=when(method){
        "list"->store.list(if(payload.has("cursor"))text(payload,"cursor")else null)
        "describe"->store.describe(text(payload,"resourceId"))
        "open"->store.open(text(payload,"resourceId"))
        "read"->store.readReader(text(payload,"readerId"),integer(payload,"offset"),integer(payload,"maxBytes").also{if(it !in 1..32768)fail("DOCUMENT_INVALID","原文件读取范围无效。")}.toInt())
        "closeRead"->store.closeRead(text(payload,"readerId"))
        "prepare"->store.prepare(payload)
        "stage"->store.stage(payload)
        "start"->store.start(payload)
        "query"->store.query(text(payload,"operationId"))
        "verify"->store.verify(text(payload,"operationId"))
        "cancel"->store.cancel(payload)
        else->fail("DOCUMENT_UNKNOWN_ACTION","未登记的原文件操作。")
    }
    private fun text(value:JSONObject,key:String)=(value.opt(key) as? String)?:fail("DOCUMENT_INVALID","原文件请求格式无效。")
    private fun integer(value:JSONObject,key:String):Long {val n=value.opt(key);if(n !is Number||n.toDouble()!=n.toLong().toDouble()||n.toLong() !in 0..NativeDocumentStore.MAX_CONTENT)fail("DOCUMENT_INVALID","原文件请求范围无效。");return n.toLong()}
    private fun expire(){val limit=SystemClock.elapsedRealtime()-60000;requests.entries.removeAll{it.value.result!=null&&it.value.completedAt<limit}}
    private fun envelope(action:()->JSONObject):String=try{
        val result=JSONObject().put("ok",true).put("value",action()).toString()
        if(result.toByteArray(Charsets.UTF_8).size>66000)fail("DOCUMENT_FRAME_LIMIT","原文件响应过大，请分段查询。")
        result
    }catch(error:NativeDocumentException){failed(error.code,error.message?:"原文件请求尚未确认。")}
    catch(error:NativeInputException){failed(error.code,error.message?:"原件操作的控制状态尚未确认。")}
    catch(_:org.json.JSONException){failed("DOCUMENT_INVALID","原文件请求格式无效。")}
    catch(_:Exception){failed("DOCUMENT_UNCONFIRMED","原文件请求结果尚未确认；请核验原操作，不会自动重写。")}
    private fun failed(code:String,message:String)=JSONObject().put("ok",false).put("error",JSONObject().put("code",code).put("message",message)).toString()
    override fun close(){
        synchronized(requests){if(closed)return;closed=true;requests.clear()}
        ordinary.shutdownNow();control.shutdownNow()
        // Interruption is not Provider cancellation. A surviving worker can still commit its
        // actual result; process death instead leaves durable unknown-effect recovery.
        Thread({try{ordinary.awaitTermination(Long.MAX_VALUE,TimeUnit.NANOSECONDS);control.awaitTermination(Long.MAX_VALUE,TimeUnit.NANOSECONDS)}finally{store.close()}},"OriginalDocumentClose").apply{isDaemon=true;start()}
    }
    companion object {
        private val METHODS=setOf("list","describe","open","read","closeRead","prepare","stage","start","query","cancel","verify")
        private fun fail(code:String,message:String):Nothing=throw NativeDocumentException(code,message)
        private fun pool(threads:Int,capacity:Int,name:String)=ThreadPoolExecutor(threads,threads,0,TimeUnit.MILLISECONDS,ArrayBlockingQueue(capacity),{task->Thread(task,name).apply{isDaemon=true}},ThreadPoolExecutor.AbortPolicy())
    }
}
