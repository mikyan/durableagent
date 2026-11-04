package dev.durableagent.probe

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

class NativeDocumentException(val code:String,message:String):RuntimeException(message,null,false,false)

/** Original document capabilities, separate from immutable attachment representations. */
class NativeDocumentStore(context:Context,private val namespace:String="document-v1"):AutoCloseable {
    init { require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}"))) }
    fun select(uri:Uri,resultFlags:Int):JSONObject =
        throw NativeDocumentException("DOCUMENT_UNAVAILABLE","原文件能力尚不可用。")
    fun list():JSONObject = JSONObject().put("resources",JSONArray())
    fun describe(resourceId:String):JSONObject =
        throw NativeDocumentException("DOCUMENT_NOT_FOUND","未登记此原文件。")
    fun read(resourceId:String,offset:Long,maxBytes:Int):JSONObject =
        throw NativeDocumentException("DOCUMENT_UNAVAILABLE","原文件读取尚不可用。")
    override fun close() {}
}
