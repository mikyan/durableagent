package dev.durableagent.probe

import android.app.Activity
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
    var webView:WebView?=null
        private set
    private var destroyed=false
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);openPage()}
    private fun openPage(){
        if(destroyed)return
        client?.disconnect();webView?.let{it.removeJavascriptInterface("DurableNative");it.destroy()}
        val view=WebView(this);webView=view
        val debug=(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)!=0
        if(debug)WebView.setWebContentsDebuggingEnabled(true)
        client=ApplicationClient(this,if(debug)intent.getStringExtra("validationMode")?:"product" else "product",if(debug)intent.getStringExtra("validationRun") else null){what,json ->
            if(webView!==view||destroyed)return@ApplicationClient
            if(what==10)view.evaluateJavascript("window.__durableReceive?.(${json})",null)
            else if(what==0)showRecovery(json)
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
                if(current){webView=null;client?.disconnect();client=null}
                (view.parent as? android.view.ViewGroup)?.removeView(view);view.removeJavascriptInterface("DurableNative");view.destroy()
                if(current)showRecovery("界面进程已退出。重新打开即可查看会话当前状态。");return true
            }
        }
        view.addJavascriptInterface(object {
            @JavascriptInterface fun postMessage(json:String){runOnUiThread {if(webView===view&&!destroyed){if(json.length>650000)showRecovery("输入超过传输上限，尚未提交。") else client?.post(json)}}}
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
    override fun onDestroy(){destroyed=true;client?.disconnect();webView?.let{it.removeJavascriptInterface("DurableNative");it.destroy()};webView=null;super.onDestroy()}
}
