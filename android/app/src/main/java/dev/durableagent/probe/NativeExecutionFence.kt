package dev.durableagent.probe

import org.json.JSONArray
import org.json.JSONObject

/** Last native command boundary. A stopped registration can be queried/cancelled, never dispatched. */
class NativeExecutionFence(private val store:NativeInputStore) {
    fun remember(payload:JSONObject)=store.adoptEffect(metadata(payload.getString("executionId"),payload.getJSONObject("context"),NativeInputStore.sha256(canonical(payload).toByteArray(Charsets.UTF_8))))
    fun before(method:String,payload:JSONObject){
        if(method=="prepare"){
            val owner=payload.getJSONObject("context")
            store.registerEffect(metadata(payload.getString("executionId"),owner,NativeInputStore.sha256(canonical(payload).toByteArray(Charsets.UTF_8))))
        } else if(method=="start")store.requireEffect(payload.getString("executionId"))
    }
    fun observe(method:String,payload:JSONObject,result:JSONObject){
        if(method !in setOf("prepare","start","query","cancel"))return
        val owner=result.optJSONObject("context")?:return // A no-receipt tombstone is handled only by the verified cancellation worker.
        val operationId=result.optString("executionId");if(operationId!=payload.optString("executionId"))throw NativeInputException("EXECUTION_IDENTITY_CONFLICT","执行响应身份无法核验。")
        val digest=result.optString("requestDigest")
        val record=store.adoptEffect(metadata(operationId,owner,digest))
        if(result.optString("namespace")!=record.getString("namespace"))throw NativeInputException("EXECUTION_IDENTITY_CONFLICT","执行命名空间已改变。")
        store.recordEffectEvidence(operationId,JSONObject().put("operationId",operationId).put("namespace",record.getString("namespace")).put("requestDigest",digest)
            .put("state",result.getString("state")).put("scopeConfirmed",result.optBoolean("scopeConfirmed")).put("sequence",result.optLong("sequence",-1)))
    }
    private fun metadata(id:String,owner:JSONObject,digest:String)=JSONObject().put("operationId",id).put("kind","command").put("source","termux")
        .put("productId",owner.getString("productId")).put("controlGeneration",owner.getLong("controlGeneration"))
        .put("sdkConversationId",owner.getLong("sdkConversationId")).put("namespace",owner.getString("namespace")).put("requestDigest",digest)
    companion object {
        /** JSON.stringify over recursively sorted plain JSON, shared with the fixed SDK request digest. */
        internal fun canonical(value:Any?):String=when(value){
            null,JSONObject.NULL->"null"
            is JSONObject->value.keys().asSequence().toList().sorted().joinToString(",","{","}"){quote(it)+":"+canonical(value.get(it))}
            is JSONArray->(0 until value.length()).joinToString(",","[","]"){canonical(value.get(it))}
            is String->quote(value)
            is Boolean->value.toString()
            is Number->if(value.toDouble()==value.toLong().toDouble())value.toLong().toString() else value.toString()
            else->throw NativeInputException("INPUT_INVALID","执行请求必须是可核验的 JSON。")
        }
        private fun quote(value:String):String=buildString{append('"');value.forEachIndexed{index,c->when(c){
            '"'->append("\\\"");'\\'->append("\\\\");'\b'->append("\\b");'\u000C'->append("\\f");'\n'->append("\\n");'\r'->append("\\r");'\t'->append("\\t")
            else->if(c<' '||Character.isHighSurrogate(c)&&(index+1==value.length||!Character.isLowSurrogate(value[index+1]))||Character.isLowSurrogate(c)&&(index==0||!Character.isHighSurrogate(value[index-1])))append("\\u"+c.code.toString(16).padStart(4,'0'))else append(c)
        }};append('"')}
    }
}
