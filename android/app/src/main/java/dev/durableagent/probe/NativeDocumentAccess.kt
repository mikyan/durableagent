package dev.durableagent.probe

import android.content.Context
import com.caoccao.javet.annotations.V8Function

/** Trusted host adapter. Never bind this original-write capability to WebView. */
class NativeDocumentAccess(context:Context,namespace:String,inputNamespace:String):AutoCloseable {
    @V8Function fun beginJson(method:String,payloadJson:String):String = "{\"ok\":false,\"error\":{\"code\":\"DOCUMENT_CHANNEL_UNAVAILABLE\",\"message\":\"原文件通道尚不可用。\"}}"
    @V8Function fun pollJson(operationId:String):String = "{\"ok\":false,\"error\":{\"code\":\"DOCUMENT_REQUEST_LOST\",\"message\":\"原文件请求已失效。\"}}"
    override fun close(){}
}
