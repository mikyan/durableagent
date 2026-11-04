package dev.durableagent.probe

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Trusted bundled React surface. Rendering recovery never replays an action. */
class AgentActivity:Activity() {
    private var client:ApplicationClient?=null
    private var inputs:NativeInputBridge?=null
    private var execution:NativeExecutionBridge?=null
    var webView:WebView?=null
        private set
    private var destroyed=false
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);openPage()}
    private fun openPage(){
        if(destroyed)return
        client?.disconnect();inputs?.close();execution?.close();webView?.let{it.removeJavascriptInterface("DurableNative");it.destroy()}
        val view=WebView(this);webView=view
        val debug=(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)!=0
        if(debug)WebView.setWebContentsDebuggingEnabled(true)
        val mode=if(debug)intent.getStringExtra("validationMode")?:"product" else "product"
        val run=if(debug)intent.getStringExtra("validationRun") else null
        inputs=NativeInputBridge(this,NativeInputBridge.namespace(mode,run)){json->if(webView===view&&!destroyed)view.evaluateJavascript("window.__durableReceive?.(${json})",null)}
        execution=NativeExecutionBridge(this){json->if(webView===view&&!destroyed)view.evaluateJavascript("window.__durableReceive?.(${json})",null)}
        client=if(mode=="input-only")null else ApplicationClient(this,mode,run){what,json ->
            if(webView!==view||destroyed)return@ApplicationClient
            if(what==10)view.evaluateJavascript("window.__durableReceive?.(${json})",null)
            // Host loss must not replace or disable the independent native draft surface.
        }.also{it.connect()}
        view.settings.apply{javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW}
        view.webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                val uri=request.url;val path=uri.path?:""
                if(uri.scheme!="https"||uri.host!="appassets.androidplatform.net"||!path.startsWith("/assets/ui/")||path.contains(".."))return denied()
                return try {val mime=when(path.substringAfterLast('.')){"html"->"text/html";"js"->"text/javascript";"css"->"text/css";"svg"->"image/svg+xml";else->"application/octet-stream"};WebResourceResponse(mime,"utf-8",assets.open(path.removePrefix("/assets/")))}catch(_:Exception){denied()}
            }
            override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean {
                val current=webView===view
                if(current){webView=null;client?.disconnect();client=null;inputs?.close();inputs=null;execution?.close();execution=null}
                (view.parent as? android.view.ViewGroup)?.removeView(view);view.removeJavascriptInterface("DurableNative");view.destroy()
                if(current)showRecovery("界面进程已退出。重新打开即可查看会话当前状态。");return true
            }
        }
        view.addJavascriptInterface(object {
            @JavascriptInterface fun postMessage(json:String){runOnUiThread {if(webView===view&&!destroyed){
                if(json.length>650000)return@runOnUiThread
                if(view.url?.substringBefore('#')!="https://appassets.androidplatform.net/assets/ui/index.html")return@runOnUiThread
                if(execution?.accept(json)==true)return@runOnUiThread
                if(inputs?.accept(json)==true)return@runOnUiThread
                if(client!=null)client?.post(json) else try{
                    val request=JSONObject(json)
                    val response=JSONObject().put("type","response").put("protocol",1).put("connectionId",request.optString("connectionId")).put("requestId",request.optString("requestId")).put("ok",false).put("error",JSONObject().put("code","HOST_NOT_READY").put("message","Agent 尚未启动；已登记会话的草稿仍可在本机保存。"))
                    view.evaluateJavascript("window.__durableReceive?.($response)",null)
                }catch(_:Exception){/* An invalid envelope has no trusted correlation identity. */}
            }}}
            @JavascriptInterface fun writeCredential(json:String){runOnUiThread {if(webView===view&&!destroyed&&json.length<=120000&&view.url?.substringBefore('#')=="https://appassets.androidplatform.net/assets/ui/index.html")client?.writeCredential(json)}}
        },"DurableNative")
        setContentView(view);view.loadUrl("https://appassets.androidplatform.net/assets/ui/index.html")
    }
    private fun denied()=WebResourceResponse("text/plain","utf-8",403,"Forbidden",emptyMap(),ByteArrayInputStream(ByteArray(0)))
    private fun showRecovery(reason:String){
        if(destroyed)return
        client?.disconnect();client=null
        val layout=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(32,64,32,32)}
        layout.addView(TextView(this).apply{text=reason})
        layout.addView(Button(this).apply{text="重新打开";setOnClickListener{openPage()}})
        setContentView(layout)
    }
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?){if(inputs?.selected(requestCode,resultCode,data)!=true)super.onActivityResult(requestCode,resultCode,data)}
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray){if(execution?.permissionResult(requestCode,permissions,grantResults)!=true)super.onRequestPermissionsResult(requestCode,permissions,grantResults)}
    override fun onDestroy(){destroyed=true;client?.disconnect();inputs?.close();inputs=null;execution?.close();execution=null;webView?.let{it.removeJavascriptInterface("DurableNative");it.destroy()};webView=null;super.onDestroy()}
}
