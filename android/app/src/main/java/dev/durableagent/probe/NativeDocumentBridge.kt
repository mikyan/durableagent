package dev.durableagent.probe

import android.app.Activity
import android.content.Intent
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Picker and observations only. The page cannot dispatch original file mutations. */
class NativeDocumentBridge(private val activity:Activity,namespace:String,inputNamespace:String="input-v1",private val deliver:(String)->Unit):AutoCloseable {
    private val store=NativeDocumentStore(activity,namespace,inputNamespace)
    private val worker=pool(2,8,"DocumentObservation")
    private val control=pool(1,8,"DocumentReceipt")
    private var selection:JSONObject?=null
    @Volatile private var closed=false
    fun accept(encoded:String):Boolean {
        val request=try{JSONObject(encoded)}catch(_:Exception){return false}
        val method=request.optString("method")
        if(method !in setOf("document.select","document.list","document.describe","document.query","document.verify","document.resumeObservation","document.resumeVerification"))return false
        if(encoded.toByteArray(Charsets.UTF_8).size>60000||request.optString("connectionId").length !in 1..128||request.optString("requestId").length !in 1..128){reply(request,failure("DOCUMENT_INVALID","原文件请求格式无效。"));return true}
        if(request.optInt("protocol")!=1){reply(request,failure("PROTOCOL_MISMATCH","界面与原文件能力版本不兼容。"));return true}
        if(method=="document.select"){
            if(selection!=null){reply(request,failure("DOCUMENT_PICKER_OPEN","请先完成当前原文件选择。"));return true}
            selection=request
            try{activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{
                addCategory(Intent.CATEGORY_OPENABLE);type="*/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            },PICK_DOCUMENT)}catch(_:Exception){selection=null;reply(request,failure("DOCUMENT_PICKER_UNAVAILABLE","无法打开系统文件选择器。"))}
        }else execute(request){
            val payload=request.optJSONObject("payload")?:JSONObject()
            when(method){
                "document.list"->store.list(if(payload.has("cursor"))payload.getString("cursor")else null)
                "document.query"->store.query(payload.getString("operationId"))
                "document.verify"->store.verify(payload.getString("operationId"))
                "document.resumeVerification"->store.resumeVerification(payload.getString("operationId"),payload.getString("observationId"),payload.getString("requestDigest"),payload.getLong("period"))
                "document.resumeObservation"->store.resumeObservation(payload.getString("resourceId"),payload.getString("operationId"),payload.getString("requestDigest"),payload.getLong("period"))
                else->store.describe(payload.getString("resourceId"))
            }
        }
        return true
    }
    fun selected(requestCode:Int,resultCode:Int,data:Intent?):Boolean {
        if(requestCode!=PICK_DOCUMENT)return false
        val request=selection?:return true;selection=null
        val uri=data?.data
        if(resultCode!=Activity.RESULT_OK||uri==null){reply(request,failure("DOCUMENT_PICKER_CANCELLED","已取消原文件选择。"));return true}
        execute(request){store.select(uri,data.flags)}
        return true
    }
    private fun execute(request:JSONObject,action:()->JSONObject){
        if(closed)return
        try{(if(request.optString("method")=="document.query")control else worker).execute{
            val response=try{JSONObject().put("ok",true).put("value",action())}
                catch(error:NativeDocumentException){failure(error.code,error.message?:"原文件暂不可用。")}
                catch(error:NativeInputException){failure(error.code,error.message?:"原件控制状态尚未确认。")}
                catch(_:Exception){failure("DOCUMENT_UNAVAILABLE","原文件暂不可用，请核验系统授权和存储状态。")}
            activity.runOnUiThread{reply(request,response)}
        }}catch(_:RejectedExecutionException){reply(request,failure("DOCUMENT_CHANNEL_BUSY","原文件请求较多，请稍后核验。"))}
    }
    private fun failure(code:String,message:String)=JSONObject().put("ok",false).put("error",JSONObject().put("code",code).put("message",message))
    private fun reply(request:JSONObject,response:JSONObject){
        if(!closed)deliver(response.put("type","response").put("protocol",1).put("connectionId",request.optString("connectionId")).put("requestId",request.optString("requestId")).toString())
    }
    override fun close(){closed=true;selection=null;worker.shutdownNow();control.shutdownNow();Thread({try{worker.awaitTermination(Long.MAX_VALUE,TimeUnit.NANOSECONDS);control.awaitTermination(Long.MAX_VALUE,TimeUnit.NANOSECONDS)}finally{store.close()}},"DocumentObservationClose").apply{isDaemon=true;start()}}
    companion object {
        private fun pool(threads:Int,capacity:Int,name:String)=ThreadPoolExecutor(threads,threads,0,TimeUnit.MILLISECONDS,ArrayBlockingQueue(capacity),{task->Thread(task,name).apply{isDaemon=true}},ThreadPoolExecutor.AbortPolicy())
        const val PICK_DOCUMENT=4810
        fun namespace(mode:String,run:String?):String {
            if(mode=="product")return "document-v1"
            require(run?.matches(Regex("[a-zA-Z0-9-]{1,80}"))==true)
            return "document-$run"
        }
    }
}
