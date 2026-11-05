package dev.durableagent.probe

import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/** Safe diagnostic code; platform/TLS messages are not reflected into UI or command output. */
open class ExecutionChannelException(val code:String):RuntimeException("执行通道未完成请求（$code）",null,false,false)
/** Native-only proof: transport failed before any operation-frame write was attempted. */
internal class ExecutionNotDispatchedException(code:String):ExecutionChannelException(code)
data class ExecutionPairing(val port:Int,val serverSpkiSha256:String,val executorId:String,val ledgerEpoch:String) {
    init {require(port in 1024..65535);require(serverSpkiSha256.matches(Regex("[a-f0-9]{64}")));require(executorId.length in 1..128&&ledgerEpoch.length in 1..128)}
}

/** One bounded authenticated session per request; no automatic command mutation retry. */
class ExecutionTlsClient(private val identity:ExecutionIdentity,private val pairing:ExecutionPairing,private val diagnostic:((String)->Unit)?=null) {
    fun request(method:String,payload:JSONObject):JSONObject=request(method,payload,10000)
    fun request(method:String,payload:JSONObject,timeoutMs:Long,pendingWake:((()->Boolean)->AutoCloseable)?=null,beforeDispatch:()->Unit={}):JSONObject {
        require(timeoutMs in 1..10000)
        val requestDeadline=android.os.SystemClock.elapsedRealtime()+timeoutMs
        if(!method.matches(Regex("[a-zA-Z][a-zA-Z0-9.]{0,63}")))throw ExecutionChannelException("INVALID_METHOD")
        val trust=object:X509TrustManager {
            override fun getAcceptedIssuers()=emptyArray<X509Certificate>()
            override fun checkClientTrusted(chain:Array<out X509Certificate>?,authType:String?) {throw CertificateException("Client trust is not supported")}
            override fun checkServerTrusted(chain:Array<out X509Certificate>?,authType:String?) {
                val cert=chain?.firstOrNull()?:throw CertificateException("Missing server certificate")
                if(ExecutionIdentity.sha256(cert.publicKey.encoded)!=pairing.serverSpkiSha256)throw CertificateException("Server identity differs")
                cert.checkValidity()
                if(cert.issuerX500Principal!=cert.subjectX500Principal)throw CertificateException("Expected pinned self-signed certificate")
                cert.verify(cert.publicKey)
            }
        }
        val tls=SSLContext.getInstance("TLS").apply {init(arrayOf(identity.keyManager()),arrayOf(trust),null)}
        val socket=tls.socketFactory.createSocket() as SSLSocket
        val available=requestDeadline-android.os.SystemClock.elapsedRealtime()
        if(available<=0){runCatching{socket.close()};throw ExecutionChannelException("CONNECTION_UNCONFIRMED")}
        val deadline=deadlines.schedule({runCatching{socket.close()}},available,TimeUnit.MILLISECONDS)
        var stage="connect"
        var authenticating=true
        var operationWriteAttempted=false
        var pending:AutoCloseable?=null
        try {
            socket.use {
                it.enabledProtocols=it.supportedProtocols.filter {protocol->protocol=="TLSv1.3"||protocol=="TLSv1.2"}.toTypedArray()
                it.soTimeout=minOf(5000L,available).toInt();it.tcpNoDelay=true
                it.connect(InetSocketAddress(InetAddress.getByAddress(byteArrayOf(127,0,0,1)),pairing.port),minOf(3000L,available).toInt())
                stage="tlsHandshake"
                it.startHandshake()
                stage="helloFrame"
                val input=DataInputStream(it.inputStream);val output=DataOutputStream(it.outputStream)
                val challenge=UUID.randomUUID().toString()
                val hello=exchange(input,output,"hello",JSONObject().put("clientNonce",challenge),null)
                if(hello.opt("protocol")!=1||hello.optString("clientNonce")!=challenge||hello.optString("executorId")!=pairing.executorId||hello.optString("ledgerEpoch")!=pairing.ledgerEpoch)throw ExecutionChannelException("INSTANCE_MISMATCH")
                val session=JSONObject()
                for(key in listOf("executorId","ledgerEpoch","processEpoch","connectionNonce")) {
                    val value=hello.optString(key)
                    if(value.length !in 1..128)throw ExecutionChannelException("INVALID_HANDSHAKE")
                    session.put(key,value)
                }
                return exchange(input,output,method,payload,session){
                    // This callback is outside the transport classification. A
                    // stop/policy rejection must never become permission to retry.
                    authenticating=false;stage="beforeDispatch";beforeDispatch()
                    operationWriteAttempted=true;stage="operationFrame"
                    pending=pendingWake?.invoke{!socket.isClosed&&android.os.SystemClock.elapsedRealtime()<requestDeadline}
                }
            }
        }catch(error:ExecutionChannelException){throw error}
        catch(error:Exception){
            if(!authenticating&&!operationWriteAttempted)throw error
            // Fixture-only opt-in: exception classes and fixed reason vocabulary, never raw messages.
            diagnostic?.invoke(JSONObject().put("stage",stage).put("classes",generateSequence(error as Throwable?){it.cause}.take(5).map {it.javaClass.simpleName}.joinToString(","))
                .put("reasons",listOf("CERTIFICATE_VERIFY_FAILED","UNKNOWN_CA","BAD_CERTIFICATE","NO_SHARED_CIPHER","CERTIFICATE_REQUIRED","CONNECTION_REFUSED","SOCKET_CLOSED","INVALID_KEY","UNSUPPORTED_CERTIFICATE").filter {reason->generateSequence(error as Throwable?){it.cause}.take(5).any {it.message.orEmpty().uppercase().replace(' ','_').contains(reason)}}.joinToString(","))
                .put("tlsReasonTokens",generateSequence(error as Throwable?){it.cause}.take(5).filter {it is javax.net.ssl.SSLException}.flatMap {Regex("(?<=OPENSSL_internal:)[A-Z0-9_]{1,100}").findAll(it.message.orEmpty()).map {match->match.value}}.distinct().joinToString(",")).toString())
            val code=if(stage=="connect"&&error is java.net.ConnectException)"CONNECTION_ABSENT" else "CONNECTION_UNCONFIRMED"
            // Deliberately exclude SSL/auth refusals, malformed protocol data,
            // remote errors and arbitrary callback exceptions. Only these local
            // I/O failures prove that no operation-frame write was attempted.
            if(authenticating&&!operationWriteAttempted&&(error is java.net.SocketException||error is java.net.SocketTimeoutException||error is java.io.EOFException))
                throw ExecutionNotDispatchedException(code)
            throw ExecutionChannelException(code)
        }
        finally {runCatching{pending?.close()};deadline.cancel(false);runCatching{socket.close()}}
    }
    private fun exchange(input:DataInputStream,output:DataOutputStream,method:String,payload:JSONObject,session:JSONObject?,beforeWrite:()->Unit={}):JSONObject {
        val id=UUID.randomUUID().toString()
        val request=JSONObject().put("protocol",1).put("requestId",id).put("method",method).put("payload",payload)
        if(session!=null)request.put("session",session)
        val bytes=request.toString().toByteArray(Charsets.UTF_8)
        if(bytes.size !in 1..MAX_FRAME)throw ExecutionChannelException("FRAME_LIMIT")
        beforeWrite() // Mark before even the length prefix: a partial write is already uncertain.
        output.writeInt(bytes.size);output.write(bytes);output.flush()
        val length=input.readInt()
        if(length !in 1..MAX_FRAME)throw ExecutionChannelException("FRAME_LIMIT")
        val responseBytes=ByteArray(length);input.readFully(responseBytes)
        val decoded=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(responseBytes)).toString()
        val response=JSONObject(decoded)
        if(response.opt("protocol")!=1||response.optString("requestId")!=id)throw ExecutionChannelException("PROTOCOL_MISMATCH")
        if(session!=null) {
            val received=response.optJSONObject("session")?:throw ExecutionChannelException("SESSION_MISMATCH")
            if(received.length()!=session.length()||session.keys().asSequence().any {received.optString(it)!=session.getString(it)})throw ExecutionChannelException("SESSION_MISMATCH")
        }
        if(!response.has("ok")||response.get("ok") !is Boolean)throw ExecutionChannelException("INVALID_RESPONSE")
        if(!response.getBoolean("ok")) {
            val code=response.optJSONObject("error")?.optString("code")
            throw ExecutionChannelException(if(code!=null&&code.matches(Regex("[A-Z][A-Z0-9_]{0,63}")))code else "REMOTE_ERROR")
        }
        return response.optJSONObject("value")?:throw ExecutionChannelException("INVALID_RESPONSE")
    }
    companion object {
        const val MAX_FRAME=65536
        private val deadlines=Executors.newSingleThreadScheduledExecutor {task->Thread(task,"ExecutionDeadline").apply {isDaemon=true}}
    }
}
