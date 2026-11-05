package dev.durableagent.probe

import android.content.Context
import org.json.JSONObject
import java.io.File

/** One immutable Provider observation. Its cached result is not a fresh observation. */
class NativeProviderPolicy @JvmOverloads constructor(context:Context,private val namespace:String,source:(()->DataSaverNetwork)?=null,private val beforeResultCommit:(()->Unit)?=null):AutoCloseable {
    private val context=context.applicationContext
    private val platform=if(source==null)AndroidDataSaverNetwork(this.context)else null
    private val current=source?:{platform!!.current()}
    private val store=NativeDataSaverStore(this.context,namespace,current)
    fun prepare(id:String,descriptor:JSONObject):JSONObject=store.registerProvider(id,descriptor,current())
    private fun directory(id:String)=File(File(File(context.noBackupFilesDir,namespace),"provider-observations"),NativeInputStore.sha256(id.toByteArray(Charsets.UTF_8)))
    fun status(id:String):JSONObject{
        val record=store.providerRecord(id,current())
        if(record.optBoolean("dispatched")&&!record.optBoolean("terminal"))StorageDomainLease.acquire(directory(id))?.use{
            // No observer owns the scope. Report uncertainty without reissuing Provider I/O.
            store.failProvider(id,current())
        }
        return store.decision(id,current())
    }
    /** Only a matching original-file ledger receipt may repair a lost policy ACK. */
    fun reconcileWrite(id:String,receipt:JSONObject):JSONObject{
        val record=store.providerRecord(id,current());val descriptor=record.getJSONObject("providerRequest");val owner=descriptor.optJSONObject("owner")
        if(descriptor.optString("kind")!="write"||receipt.optString("operationId")!=id||receipt.optString("requestDigest")!=descriptor.optString("documentRequestDigest")||receipt.optString("uri")!=descriptor.optString("uri")||listOf("expectedDigest","contentDigest","byteLength").any{receipt.opt(it)!=descriptor.opt(it)}||owner==null||listOf("productId","controlGeneration","sdkConversationId").any{receipt.opt(it)!=owner.opt(it)})throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","原件回执不属于本次固定操作。")
        if(record.optBoolean("dispatched")&&receipt.optBoolean("scopeConfirmed")&&receipt.optString("state") in setOf("completed","stopped","not_started"))store.completeProvider(id,receipt,current())
        return status(id)
    }
    private fun control(record:JSONObject){
        val owner=record.getJSONObject("providerRequest").optJSONObject("owner")?:return
        val value=NativeInputStore(context,namespace).withLeaseWait(1000).use{it.readControl(owner.getString("productId"))}
        if(value.has("pendingAbort")||value.getLong("generation")!=owner.getLong("controlGeneration")||value.getLong("stoppedThrough")>=owner.getLong("controlGeneration"))throw NativeInputException("EXECUTION_STOPPED","此原文件观察的控制代次已停止。")
    }
    fun grant(id:String,digest:String,period:Long):JSONObject{control(store.providerRecord(id,current()));return store.grant(id,digest,period,current())}
    fun result(id:String):JSONObject{val record=store.providerRecord(id,current());control(record);return record.optJSONObject("providerResult")?.let{JSONObject(it.toString())}?:throw NativeInputException("DATA_SAVER_RESULT_UNVERIFIED","原文件观察尚无完整固定结果。")}
    fun execute(id:String,action:(JSONObject)->JSONObject):JSONObject{
        var record=store.providerRecord(id,current());control(record)
        record.optJSONObject("providerResult")?.let{return JSONObject(it.toString())}
        val lease=StorageDomainLease.acquire(directory(id))?:throw NativeInputException("DATA_SAVER_OPERATION_BUSY","同一次原文件观察尚在进行，请查询原身份。")
        lease.use{
            record=store.providerRecord(id,current());control(record)
            record.optJSONObject("providerResult")?.let{return JSONObject(it.toString())}
            if(record.optBoolean("dispatched")){store.failProvider(id,current());throw NativeInputException("DATA_SAVER_RESULT_UNVERIFIED","先前原文件观察结果未确认，未重新访问提供者。")}
            store.requireStart(id,record.getString("finalDigest"),current())
            try{
                val previous=active.get();active.set(this to record)
                val result=try{action(JSONObject(record.getJSONObject("providerRequest").toString()))}finally{active.set(previous)}
                control(record);val after=store.decision(id,current())
                if(after.optBoolean("policyInterrupted"))throw NativeInputException("DATA_SAVER_INTERRUPTED","网络变化后的原文件观察尚待核验。")
                if(record.getJSONObject("providerRequest").getString("kind")=="write"&&result.opt("scopeConfirmed")!=true){store.failProvider(id,current());return result}
                beforeResultCommit?.invoke()
                return store.completeProvider(id,result,current())
            }catch(error:Throwable){try{store.failProvider(id,current())}catch(failure:Exception){error.addSuppressed(failure)};throw error}
        }
    }
    private fun checkIo(record:JSONObject,uri:String){
        if(record.getJSONObject("providerRequest").getString("uri")!=uri)throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","原文件访问超出本次固定观察范围。")
        control(record);val status=store.decision(record.getString("executionId"),current())
        if(status.optBoolean("policyInterrupted")||status.getString("phase")=="result-unverified")throw NativeInputException("DATA_SAVER_INTERRUPTED","网络变化后未继续访问原文件提供者。")
    }
    companion object {
        private val active=ThreadLocal<Pair<NativeProviderPolicy,JSONObject>?>()
        fun beforeActiveIo(){active.get()?.let{it.first.checkIo(it.second,it.second.getJSONObject("providerRequest").getString("uri"))}}
        fun beforeIo(context:Context,namespace:String,uri:String,source:(()->DataSaverNetwork)?=null){
            val held=active.get()
            if(held!=null){if(held.first.namespace!=namespace)throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","原文件控制域不一致。");held.first.checkIo(held.second,uri);return}
            NativeProviderPolicy(context,namespace,source).use{policy->if(policy.store.query(policy.current()).getBoolean("restricted"))throw NativeInputException("DATA_SAVER_WAIT","省流等待：请为这一次原文件观察核验网络或临时放行。")}
        }
    }
    override fun close(){platform?.close();store.close()}
}
