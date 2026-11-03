package dev.durableagent.probe

import android.app.Activity
import android.os.Bundle
import android.webkit.*

class ProbeActivity:Activity() {
    private lateinit var client:RuntimeClient
    private lateinit var view:WebView
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        client=RuntimeClient(this);client.connectAsync()
        view=WebView(this)
        view.settings.javaScriptEnabled=true
        view.settings.allowFileAccess=false
        view.settings.allowContentAccess=false
        view.webViewClient=object:WebViewClient() {
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
        }
        view.addJavascriptInterface(object {
            @JavascriptInterface fun action(action:String) {if(action in setOf("start","send","stop","close"))runOnUiThread {runCatching {client.command(action)}}}
            @JavascriptInterface fun snapshot():String {runOnUiThread {client.poll()};return client.cachedState()}
        },"Probe")
        setContentView(view)
        view.loadDataWithBaseURL("https://probe.invalid/",assets.open("probe.html").bufferedReader().use{it.readText()},"text/html","utf-8",null)
    }
    override fun onDestroy() {view.removeJavascriptInterface("Probe");view.destroy();client.disconnect();super.onDestroy()}
}
