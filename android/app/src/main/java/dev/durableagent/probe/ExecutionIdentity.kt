package dev.durableagent.probe

import android.content.Context
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.math.BigInteger
import java.io.File
import java.io.RandomAccessFile
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.util.Date
import javax.net.ssl.X509KeyManager
import javax.security.auth.x500.X500Principal

/** Only public certificates leave this boundary. AndroidKeyStore retains the signing key. */
class ExecutionIdentity(private val context:Context,namespace:String,private val allowCreate:Boolean=true) {
    private val alias="durableagent.execution.v1.$namespace"
    private val lockFile=File(context.noBackupFilesDir,"execution-identity-$namespace.lock")
    init {require(namespace.matches(Regex("[a-zA-Z0-9-]{1,80}")))}
    private fun entry():KeyStore.PrivateKeyEntry=synchronized(lock) {
        if(!context.getSystemService(UserManager::class.java).isUserUnlocked)throw ExecutionChannelException("FIRST_UNLOCK_REQUIRED")
        if(context.isDeviceProtectedStorage)throw ExecutionChannelException("CE_STORAGE_REQUIRED")
        RandomAccessFile(lockFile,"rw").use {file->file.channel.lock().use {
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        if(!store.containsAlias(alias)) {
            if(!allowCreate)throw ExecutionChannelException("CLIENT_IDENTITY_UNAVAILABLE")
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    // Conscrypt signs an already-digested TLS transcript with NONEwithECDSA.
                    .setDigests(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256)
                    .setCertificateSubject(X500Principal("CN=DurableAgent execution client"))
                    .setCertificateSerialNumber(BigInteger.ONE)
                    .setCertificateNotBefore(Date(0))
                    .setCertificateNotAfter(Date(4102444800000L))
                    .setUserAuthenticationRequired(false).build())
            }.generateKeyPair()
        }
        val value=store.getEntry(alias,null) as? KeyStore.PrivateKeyEntry?:throw ExecutionChannelException("CLIENT_IDENTITY_UNAVAILABLE")
        if(value.privateKey.encoded!=null)throw ExecutionChannelException("CLIENT_IDENTITY_EXPORTABLE")
        value
        }}
    }
    fun certificatePem():String="-----BEGIN CERTIFICATE-----\n"+Base64.encodeToString(entry().certificate.encoded,Base64.NO_WRAP).chunked(64).joinToString("\n")+"\n-----END CERTIFICATE-----\n"
    fun certificateSha256():String=sha256(entry().certificate.encoded)
    internal fun keyManager():X509KeyManager {
        val value=entry()
        return object:X509KeyManager {
            override fun getClientAliases(keyType:String?,issuers:Array<out Principal>?):Array<String>?=if(keyType=="EC")arrayOf(alias)else null
            override fun chooseClientAlias(keyType:Array<out String>?,issuers:Array<out Principal>?,socket:Socket?):String?=if(keyType?.contains("EC")==true)alias else null
            override fun getServerAliases(keyType:String?,issuers:Array<out Principal>?):Array<String>?=null
            override fun chooseServerAlias(keyType:String?,issuers:Array<out Principal>?,socket:Socket?):String?=null
            override fun getCertificateChain(requested:String?):Array<X509Certificate>?=if(requested==alias)value.certificateChain.map {it as X509Certificate}.toTypedArray()else null
            override fun getPrivateKey(requested:String?):PrivateKey?=if(requested==alias)value.privateKey else null
        }
    }
    companion object {
        private val lock=Any()
        fun sha256(bytes:ByteArray):String=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
    }
}
