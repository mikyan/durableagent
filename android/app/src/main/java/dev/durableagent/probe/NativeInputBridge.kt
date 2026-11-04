package dev.durableagent.probe

import android.app.Activity
import android.content.Intent
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicInteger

/** Same public envelope, independently routed before any Node/Binder owner queue. */
class NativeInputBridge(private val activity:Activity,namespace:String,private val mode:String="product",private val run:String?=null,private val deliver:(String)->Unit):AutoCloseable {
    private val store=NativeInputStore(activity,namespace)
    private val access=NativeInputAccess(store)
    private val writes=Executors.newSingleThreadExecutor()
    private val sources=Executors.newFixedThreadPool(2)
    private val active=AtomicInteger(0)
    @Volatile private var closed=false
    private var selection:JSONObject?=null
    private var notificationProduct:String?=null
    private var capture:android.net.Uri?=null
    fun accept(encoded:String):Boolean {
        val request=try{JSONObject(encoded)}catch(_:Exception){return false}
        val method=request.optString("method")
        if(!method.startsWith("input."))return false
        if(request.optInt("protocol")!=1){reply(request,error("PROTOCOL_MISMATCH","界面与原生输入版本不兼容。"));return true}
        if(method=="input.capabilities"){reply(request,result{JSONObject().put("camera",Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(activity.packageManager)!=null)});return true}
        if(method=="input.stopNotification"){
            execute(request,false,action={result{store.readControl(request.getJSONObject("payload").getString("id"))}},done={encoded->
                val result=JSONObject(encoded);if(!result.optBoolean("ok")){reply(request,encoded);return@execute}
                val control=result.getJSONObject("value");notificationProduct=control.getString("id")
                NativeStopController.publish(activity.applicationContext,mode,run,control)
                val enabled=activity.getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled()
                if(!enabled){if(activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),NOTIFICATIONS)
                    else activity.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,activity.packageName))}
                reply(request,JSONObject().put("ok",true).put("value",JSONObject().put("enabled",enabled).put("requested",!enabled)).toString())
            });return true
        }
        if(method=="input.select"){
            if(selection!=null){reply(request,error("INPUT_PICKER_OPEN","附件选择器已打开，请完成或取消当前选择。"));return true}
            val kind=request.optJSONObject("payload")?.optString("kind")
            if(kind!="image"&&kind!="file"&&kind!="camera"){reply(request,error("INVALID_ARGUMENT","请选择图片或 UTF-8 文本文件。"));return true}
            selection=request
            execute(request,false,action={
                result{val payload=request.getJSONObject("payload");store.selectionReceipt(payload.getString("id"),revision(payload),payload.getString("operationId"),nativeKind(kind))?:JSONObject.NULL}
            },done={encoded->
                if(selection===request){
                    val value=JSONObject(encoded)
                    if(!value.optBoolean("ok")||!value.isNull("value")){selection=null;reply(request,encoded)}else if(kind=="camera")openCamera(request)else openPicker(request,kind)
                }
            })
            return true
        }
        execute(request,method in setOf("input.read","input.prepare","input.freeze"),action={
            val payload=request.optJSONObject("payload")?:JSONObject()
            if(method=="input.stop")result{NativeStopController.request(activity.applicationContext,mode,run,payload)}
            else access.requestJson(method,payload.toString()).also{encoded->
                if(method=="input.readControl"){val response=JSONObject(encoded);if(response.optBoolean("ok"))NativeStopController.publish(activity.applicationContext,mode,run,response.getJSONObject("value"))}
            }
        })
        return true
    }
    fun selected(requestCode:Int,resultCode:Int,data:Intent?):Boolean {
        if(requestCode!=PICK_DOCUMENT&&requestCode!=PICK_CAMERA)return false
        val request=selection?:return true;selection=null
        val captured=if(requestCode==PICK_CAMERA)capture.also{capture=null}else null
        val uri=captured?:data?.data
        if(resultCode!=Activity.RESULT_OK||uri==null){captured?.let{CameraCaptureProvider.discard(activity,it)};reply(request,error("INPUT_PICKER_CANCELLED","已取消附件选择，原草稿保持不变。"));return true}
        val flags=if(captured!=null)Intent.FLAG_GRANT_READ_URI_PERMISSION else data?.flags?:0
        captured?.let{activity.revokeUriPermission(it,Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)}
        execute(request,false,action={
            val payload=request.getJSONObject("payload")
            result{
                val admission=store.admitSource(payload.getString("id"),revision(payload),payload.getString("operationId"),uri,flags,nativeKind(payload.getString("kind")))
                val receipt=admission.receipt
                continueSource(admission)
                receipt // Already committed; a saturated source pool cannot delay this acknowledgement.
            }
        })
        return true
    }
    private fun continueSource(admission:NativeInputStore.SourceAdmission){
        if(!admission.needsContinuation||closed){admission.close();return}
        active.incrementAndGet()
        try{sources.execute{
            try{admission.use{it.continueSource()}}catch(_:Exception){/* Durable state/lease recovery is observed by input.inspect. */}
            finally{finished()}
        }}catch(_:RejectedExecutionException){admission.close();finished()}
    }
    private fun openCamera(request:JSONObject){
        try{
            val uri=CameraCaptureProvider.create(activity);capture=uri
            activity.startActivityForResult(Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply{
                putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri)
                clipData=android.content.ClipData.newRawUri("Camera capture",uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            },PICK_CAMERA)
        }catch(_:Exception){capture?.let{CameraCaptureProvider.discard(activity,it)};capture=null;selection=null;reply(request,error("INPUT_PICKER_UNAVAILABLE","无法打开系统相机，草稿已保留。"))}
    }
    private fun openPicker(request:JSONObject,kind:String){
        try{activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{
            addCategory(Intent.CATEGORY_OPENABLE);type=if(kind=="image")"image/*" else "text/*"
            putExtra(Intent.EXTRA_MIME_TYPES,if(kind=="image")arrayOf("image/png","image/jpeg")else arrayOf("text/plain","text/markdown"))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        },PICK_DOCUMENT)}catch(_:Exception){selection=null;reply(request,error("INPUT_PICKER_UNAVAILABLE","无法打开系统文件选择器，草稿已保留。"))}
    }
    private fun nativeKind(kind:String)=if(kind=="file")"text" else "image"
    private fun revision(payload:JSONObject):Long {val value=payload.opt("expectedRevision");if(value !is Number||value.toDouble()!=value.toLong().toDouble()||value.toLong()<0)throw NativeInputException("INPUT_INVALID","草稿版本必须是有效整数。");return value.toLong()}
    private fun execute(request:JSONObject,io:Boolean,action:()->String,done:(String)->Unit={reply(request,it)}){
        if(closed)return
        active.incrementAndGet()
        try{(if(io)sources else writes).execute{
            try{val value=try{action()}catch(_:Exception){error("INPUT_STORAGE_UNAVAILABLE","原生输入暂不可用，尚未确认保存，请保留当前编辑。")};activity.runOnUiThread{if(!closed)done(value)}}
            finally{finished()}
        }}catch(_:RejectedExecutionException){finished()}
    }
    private fun finished(){if(active.decrementAndGet()==0&&closed)store.close()}
    private fun result(action:()->Any):String=try{JSONObject().put("ok",true).put("value",action()).toString()}catch(failure:NativeInputException){error(failure.code,failure.message?:"原生输入不可用。")}
    private fun error(code:String,message:String)=JSONObject().put("ok",false).put("error",JSONObject().put("code",code).put("message",message)).toString()
    private fun reply(request:JSONObject,result:String){
        val value=JSONObject(result).put("type","response").put("protocol",1).put("connectionId",request.optString("connectionId")).put("requestId",request.optString("requestId"))
        deliver(value.toString())
    }
    override fun close(){closed=true;selection=null;writes.shutdown();sources.shutdown();if(active.get()==0)store.close()}
    fun notificationPermissionResult(requestCode:Int):Boolean{
        if(requestCode!=NOTIFICATIONS)return false;val id=notificationProduct?:return true
        if(!closed)try{writes.execute{runCatching{NativeStopController.publish(activity.applicationContext,mode,run,store.readControl(id))}}}catch(_:RejectedExecutionException){}
        return true
    }
    companion object {const val PICK_CAMERA=4615;const val PICK_DOCUMENT=4606;const val NOTIFICATIONS=4611
        fun namespace(mode:String,run:String?):String {
            if(mode=="product")return "input-v1"
            require(run?.matches(Regex("[a-zA-Z0-9-]{1,80}"))==true)
            return "input-$run"
        }
    }
}
