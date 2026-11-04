package dev.durableagent.probe

import android.content.Context
import android.os.SystemClock
import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Trusted native host boundary. Never bind this object to WebView. Network waits never occupy Node. */
class ExecutionAccess(context: Context) : AutoCloseable {
    private val context = context.applicationContext
    private data class Operation(val control: Boolean, var result: JSONObject? = null, var completedAt: Long = 0)
    private val operations = mutableMapOf<String, Operation>()
    private val ordinary = pool(2,8,"ExecutionRequest")
    // Reserved capacity and a separate socket ensure output waits cannot occupy cancellation's worker.
    private val control = pool(1,4,"ExecutionControl")
    private var closed = false

    @V8Function fun beginJson(method: String, payloadJson: String): String = begin(method,payloadJson,false)
    /** Narrow native UI operation, intentionally absent from the Javet/WebView annotation surface. */
    fun beginVerifiedCancelJson(executionId: String): String {
        if(!executionId.matches(Regex("[A-Za-z0-9_-]{1,128}")))return failed("INVALID_EXECUTION_ID")
        return begin("cancel",JSONObject().put("executionId",executionId).put("reason","user").toString(),true)
    }
    private fun begin(method: String, payloadJson: String, verifyReceipt: Boolean): String = envelope {
        if (method !in METHODS) throw ExecutionChannelException("INVALID_METHOD")
        if (payloadJson.toByteArray(Charsets.UTF_8).size > 60000) throw ExecutionChannelException("FRAME_LIMIT")
        val payload = JSONObject(payloadJson)
        val id = UUID.randomUUID().toString()
        val isControl = method == "cancel"
        synchronized(operations) {
            expire()
            if (closed) throw ExecutionChannelException("CHANNEL_CLOSED")
            if (operations.values.count { it.control == isControl } >= if (isControl) 8 else 24) throw ExecutionChannelException("CHANNEL_BUSY")
            operations[id] = Operation(isControl)
        }
        try {
            (if (isControl) control else ordinary).execute {
                val response = JSONObject(envelope {
                    if (method == "connect") {
                        val peer = ExecutionTermuxGateway(context).connect()
                        JSONObject().put("protocol",1).put("executorId",peer.executorId).put("ledgerEpoch",peer.ledgerEpoch)
                    } else {
                        val identity = ExecutionIdentity(context,"production-v1",allowCreate=false)
                        val peer = ExecutionPairingStore(context).use { it.requireClient(identity.certificateSha256()) }
                        val client=ExecutionTlsClient(identity,peer)
                        if(verifyReceipt) {
                            verifiedCancel(client,peer,payload)
                        } else client.request(method,payload)
                    }
                })
                synchronized(operations) { operations[id]?.let { it.result=response; it.completedAt=SystemClock.elapsedRealtime() } }
            }
        } catch (_: RejectedExecutionException) {
            synchronized(operations) { operations.remove(id) }
            throw ExecutionChannelException("CHANNEL_BUSY")
        }
        JSONObject().put("operationId",id)
    }

    private fun verifiedCancel(client:ExecutionTlsClient,peer:ExecutionPairing,payload:JSONObject):JSONObject {
        val id=payload.getString("executionId")
        val namespace="termux:"+peer.executorId
        fun identity(value:JSONObject):Boolean=value.opt("protocol")==1 && value.optString("executionId")==id &&
            value.optString("namespace")==namespace && value.optString("executorId")==peer.executorId && value.optString("ledgerEpoch")==peer.ledgerEpoch
        fun bound(value:JSONObject):Boolean=value.optString("finalDigest").matches(Regex("[a-f0-9]{64}")) &&
            value.optString("requestDigest").matches(Regex("[a-f0-9]{64}")) && value.optJSONObject("context")?.optString("namespace")==namespace
        fun tombstone(value:JSONObject):Boolean=value.optString("state")=="not_started" && value.optString("reason")=="CANCELLED_BEFORE_ACCEPTANCE" &&
            value.opt("neverStarted")==true && value.opt("scopeConfirmed")==true && !value.has("context") && !value.has("finalDigest") && !value.has("requestDigest")
        val before=client.request("query",JSONObject().put("executionId",id))
        val missing=before.optString("state")=="unknown" && before.optString("reason")=="NO_RECEIPT" &&
            !before.has("context") && !before.has("finalDigest") && !before.has("requestDigest")
        val cancelledBeforeAcceptance=tombstone(before)
        if(!identity(before) || !(missing||cancelledBeforeAcceptance||bound(before)))throw ExecutionChannelException("EXECUTION_RECEIPT_REQUIRED")
        // An authenticated missing receipt permits writing a cancellation tombstone.
        // It does not itself prove that no in-flight prepare can subsequently arrive.
        val result=client.request("cancel",payload)
        if(!identity(result))throw ExecutionChannelException("EXECUTION_CANCEL_UNCONFIRMED")
        if(result.optString("state")=="not_started"&&(result.opt("neverStarted")!=true||result.opt("scopeConfirmed")!=true) ||
            result.optString("state")=="stopped"&&result.opt("scopeConfirmed")!=true)throw ExecutionChannelException("EXECUTION_CANCEL_UNCONFIRMED")
        if(cancelledBeforeAcceptance) {
            if(!tombstone(result))throw ExecutionChannelException("EXECUTION_CANCEL_UNCONFIRMED")
        } else if(missing) {
            // A racing prepare/start may have won before cancel. Keep its genuine
            // bound receipt; only the executor can confirm the not-started case.
            if(!tombstone(result)&&!bound(result))throw ExecutionChannelException("EXECUTION_CANCEL_UNCONFIRMED")
        } else {
            if(!bound(result) || result.optString("finalDigest")!=before.optString("finalDigest") ||
                result.optString("requestDigest")!=before.optString("requestDigest") || result.getJSONObject("context").toString()!=before.getJSONObject("context").toString() ||
                before.optString("state")=="unknown"&&result.optString("state")!="unknown")throw ExecutionChannelException("EXECUTION_CANCEL_UNCONFIRMED")
        }
        return result
    }

    @V8Function fun pollJson(operationId: String): String = envelope {
        synchronized(operations) {
            expire()
            val operation = operations[operationId] ?: throw ExecutionChannelException("OPERATION_UNKNOWN")
            val result = operation.result
            if (result == null) JSONObject().put("pending",true)
            else { operations.remove(operationId); JSONObject().put("pending",false).put("result",result) }
        }
    }

    private fun expire() {
        val threshold=SystemClock.elapsedRealtime()-60000
        operations.entries.removeAll { it.value.result!=null && it.value.completedAt<threshold }
    }
    private fun envelope(action: () -> JSONObject): String = try { JSONObject().put("ok",true).put("value",action()).toString() }
    catch (error: ExecutionChannelException) { failed(error.code) }
    catch (_: org.json.JSONException) { failed("INVALID_REQUEST") }
    catch (_: Exception) { failed("OPERATION_FAILED_UNKNOWN") }
    private fun failed(code: String) = JSONObject().put("ok",false).put("error",JSONObject().put("code",code).put("message","执行通道未完成请求（$code）")).toString()
    override fun close() {
        synchronized(operations) { closed=true; operations.clear() }
        ordinary.shutdownNow(); control.shutdownNow()
        // Abandoning a socket or worker does not acknowledge remote cancellation or stopped effects.
    }
    companion object {
        private val METHODS=setOf("connect","ping","prepare","start","query","list","readOutput","readRawOutput","cancel","inspectWorkspace") + EXECUTION_FILE_METHODS
        private fun pool(threads: Int, capacity: Int, name: String) = ThreadPoolExecutor(threads,threads,0,TimeUnit.MILLISECONDS,ArrayBlockingQueue(capacity),{ task -> Thread(task,name).apply { isDaemon=true } },ThreadPoolExecutor.AbortPolicy())
    }
}
