package dev.durableagent.probe

import android.content.Context
import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject

/** Fixed-core Javet capability only. Never install in the WebView bridge. */
class NativeDataSaverAccess private constructor(private val context:Context,private val namespace:String,source:(()->DataSaverNetwork)?):AutoCloseable {
    constructor(context:Context,namespace:String):this(context,namespace,null)
    constructor(context:Context,namespace:String,source:()->DataSaverNetwork,validation:Boolean):this(context,namespace,source){check(validation)}
    private val network=if(source==null)AndroidDataSaverNetwork(context)else null
    private val current=source?:{network!!.current()}
    private val store=NativeDataSaverStore(context,namespace,current)
    @V8Function fun requestJson(method:String,payloadJson:String):String=try {
        val value=JSONObject(payloadJson)
        val result=when(method){
            "get"->store.query(current())
            "configure"->{
                val enabled=value.opt("enabled");val version=value.opt("expectedVersion")
                if(enabled !is Boolean||version !is Number||version.toLong()<0||version.toDouble()!=version.toLong().toDouble())throw NativeInputException("DATA_SAVER_INVALID","省流设置请求无效。")
                store.configure(enabled,version.toLong(),current())
            }
            "register"->store.register(value,current())
            "prepared"->store.prepared(value.getString("executionId"),value.getString("requestDigest"),value.getString("finalDigest"),current())
            "decision"->controlProjection(store.decision(value.getString("executionId"),current()))
            "operations"->{
                val result=store.operations(value.getString("productId"),value.optString("cursor").takeIf{it.isNotEmpty()},current())
                val control=NativeInputStore(context,namespace).withLeaseWait(1000).use{it.readControl(value.getString("productId"))}
                val rows=result.getJSONArray("operations")
                for(index in 0 until rows.length())controlProjection(rows.getJSONObject(index),control)
                result
            }
            "grant"->{
                val id=value.getString("executionId")
                NativeInputStore(context,namespace).withLeaseWait(1000).use{it.requireEffect(id)}
                val original=store.decision(id,current())
                if(original.optString("finalDigest")!=value.getString("finalDigest"))throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","许可的最终执行内容不一致。")
                store.grant(id,value.getString("requestDigest"),value.getLong("period"),current())
            }
            else->throw NativeInputException("DATA_SAVER_UNAVAILABLE","省流执行核验尚未就绪。")
        }
        JSONObject().put("ok",true).put("value",result).toString()
    }catch(error:NativeInputException){JSONObject().put("ok",false).put("error",JSONObject().put("code",error.code).put("message",error.message)).toString()}
    catch(_:Exception){JSONObject().put("ok",false).put("error",JSONObject().put("code","DATA_SAVER_UNAVAILABLE").put("message","省流事实无法核验，受控操作暂不开始。")).toString()}
    fun remember(request:JSONObject)=store.register(request,current())
    private fun controlProjection(value:JSONObject,known:JSONObject?=null):JSONObject {
        // This is a current read projection, not a terminal proof or a new policy cancellation.
        // A confirmed original outcome remains visible after a later user stop.
        if(value.optBoolean("terminal"))return value
        val control=known?:NativeInputStore(context,namespace).withLeaseWait(1000).use{it.readControl(value.getString("productId"))}
        if(value.getLong("controlGeneration")<=control.getLong("stoppedThrough"))value.put("phase","result-unverified").put("reason","user-stopped")
        return value
    }
    fun observe(receipt:JSONObject):JSONObject {
        val id=receipt.getString("executionId")
        if(receipt.has("context"))store.prepared(id,receipt.getString("requestDigest"),receipt.getString("finalDigest"),current())
        return store.observe(receipt,current())
    }
    fun requireStart(executionId:String,finalDigest:String):JSONObject {
        NativeInputStore(context,namespace).withLeaseWait(1000).use{it.requireEffect(executionId)}
        return store.requireStart(executionId,finalDigest,current())
    }
    override fun close(){network?.close();store.close()}
}
