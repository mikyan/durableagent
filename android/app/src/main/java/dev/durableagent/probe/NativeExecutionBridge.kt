package dev.durableagent.probe

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** Narrow actions from the bundled trusted page; independent of the Node owner and its queue. */
class NativeExecutionBridge(private val activity: Activity, private val deliver: (String) -> Unit) : AutoCloseable {
    private val access=ExecutionAccess(activity)
    private val main=Handler(Looper.getMainLooper())
    private var permissionRequest:JSONObject?=null
    private var closed=false

    fun accept(encoded:String):Boolean {
        val request=try{JSONObject(encoded)}catch(_:Exception){return false}
        val method=request.optString("method")
        if(method !in METHODS)return false
        try {
            if(request.opt("protocol")!=1 || !request.optString("connectionId").matches(Regex("[A-Za-z0-9_-]{1,128}")) || !request.optString("requestId").matches(Regex("[A-Za-z0-9_-]{1,128}")))throw ExecutionChannelException("INVALID_REQUEST")
            val payload=request.optJSONObject("payload")?:throw ExecutionChannelException("INVALID_REQUEST")
            if(method in setOf("execution.query","execution.cancel")) {
                if(payload.length()!=1 || !payload.optString("executionId").matches(Regex("[A-Za-z0-9_-]{1,128}")))throw ExecutionChannelException("INVALID_EXECUTION_ID")
            }else if(method=="execution.openDownload") {
                if(payload.length()!=1 || payload.optString("source") !in setOf("github","fdroid"))throw ExecutionChannelException("INVALID_REQUEST")
            }else if(payload.length()!=0)throw ExecutionChannelException("INVALID_REQUEST")
            when(method) {
                "execution.openDownload" -> {
                    val url=if(payload.getString("source")=="github")"https://github.com/termux/termux-app/releases" else "https://f-droid.org/packages/com.termux/"
                    try { activity.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
                    catch(_:android.content.ActivityNotFoundException){throw ExecutionChannelException("TERMUX_DOWNLOAD_UNAVAILABLE")}
                    reply(request,JSONObject().put("ok",true).put("value",JSONObject().put("opened",true)))
                }
                "execution.copySetup"-> {
                    val bytes=activity.assets.open("execution-setup.txt").use { it.readNBytes(600001) }
                    if(bytes.isEmpty() || bytes.size>600000)throw ExecutionChannelException("SETUP_ASSET_UNAVAILABLE")
                    val command=bytes.toString(Charsets.UTF_8)
                    activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("DurableAgent Termux setup",command))
                    reply(request,JSONObject().put("ok",true).put("value",JSONObject().put("copied",true)))
                }
                "execution.connect"-> {
                    try { activity.packageManager.getPackageInfo("com.termux",0) }
                    catch(_:PackageManager.NameNotFoundException){throw ExecutionChannelException("TERMUX_MISSING")}
                    if(activity.checkSelfPermission(ExecutionTermuxGateway.PERMISSION)!=PackageManager.PERMISSION_GRANTED) {
                        if(permissionRequest!=null)throw ExecutionChannelException("PERMISSION_REQUEST_PENDING")
                        permissionRequest=request
                        activity.requestPermissions(arrayOf(ExecutionTermuxGateway.PERMISSION),PERMISSION_REQUEST)
                    } else begin(request,"connect",JSONObject())
                }
                "execution.query"->begin(request,"query",payload)
                "execution.cancel"->observe(request,access.beginVerifiedCancelJson(payload.getString("executionId")))
            }
        } catch(error:ExecutionChannelException) {reply(request,failure(error.code))}
        catch(_:Exception) {reply(request,failure("EXECUTION_UI_UNAVAILABLE"))}
        return true
    }
    fun permissionResult(requestCode:Int, permissions:Array<out String>, grants:IntArray):Boolean {
        if(requestCode!=PERMISSION_REQUEST)return false
        val request=permissionRequest?:return true
        permissionRequest=null
        if(!closed) {
            if(permissions.contentEquals(arrayOf(ExecutionTermuxGateway.PERMISSION)) && grants.size==1 && grants[0]==PackageManager.PERMISSION_GRANTED)begin(request,"connect",JSONObject())
            else reply(request,failure("TERMUX_PERMISSION_REQUIRED"))
        }
        return true
    }
    private fun begin(request:JSONObject,method:String,payload:JSONObject)=observe(request,access.beginJson(method,payload.toString()))
    private fun observe(request:JSONObject,encoded:String) {
        val started=JSONObject(encoded)
        if(!started.optBoolean("ok")){reply(request,started);return}
        val id=started.getJSONObject("value").getString("operationId")
        val poll=object:Runnable {
            override fun run() {
                if(closed)return
                val response=JSONObject(access.pollJson(id))
                if(!response.optBoolean("ok")){reply(request,response);return}
                val value=response.getJSONObject("value")
                if(value.optBoolean("pending"))main.postDelayed(this,50)
                else reply(request,value.getJSONObject("result"))
            }
        }
        main.post(poll)
    }
    private fun reply(request:JSONObject,result:JSONObject) {
        if(!closed)deliver(result.put("type","response").put("protocol",1).put("connectionId",request.optString("connectionId")).put("requestId",request.optString("requestId")).toString())
    }
    private fun failure(code:String)=JSONObject().put("ok",false).put("error",JSONObject().put("code",code).put("message","执行通道操作未完成（$code）"))
    override fun close(){closed=true;permissionRequest=null;main.removeCallbacksAndMessages(null);access.close()}
    companion object {
        const val PERMISSION_REQUEST=4709
        private val METHODS=setOf("execution.connect","execution.copySetup","execution.openDownload","execution.query","execution.cancel")
    }
}
