package dev.durableagent.probe

import android.content.Context
import com.caoccao.javet.annotations.V8Function

/** Trusted host adapter. Never bind this original-write capability to WebView. */
class NativeDocumentAccess(context:Context,namespace:String,inputNamespace:String):AutoCloseable {
    private val service=NativeDocumentService(context,namespace,inputNamespace)
    @V8Function fun beginJson(method:String,payloadJson:String):String = service.beginJson(method,payloadJson)
    @V8Function fun pollJson(operationId:String):String = service.pollJson(operationId)
    override fun close()=service.close()
}
