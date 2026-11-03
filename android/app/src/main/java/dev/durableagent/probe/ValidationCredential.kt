package dev.durableagent.probe

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import javax.crypto.Cipher

/** Test-only encrypted provision. Product credential management belongs to T05. */
object ValidationCredential {
    private const val ALIAS="durableagent-mimo-validation"
    fun prepare(context:Context) {
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        if(!store.containsAlias(ALIAS)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA1)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).build())
            }.generateKeyPair()
        }
        File(context.noBackupFilesDir,"mimo-validation-public.der").writeBytes(store.getCertificate(ALIAS).publicKey.encoded)
    }
    fun consume(context:Context):ByteArray {
        val capsule=File(context.noBackupFilesDir,"mimo-validation-key.rsa")
        val ciphertext=capsule.readBytes()
        require(ciphertext.size==256){"Invalid encrypted validation capsule"}
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        val cipher=Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding")
        cipher.init(Cipher.DECRYPT_MODE,store.getKey(ALIAS,null) as PrivateKey)
        val clear=cipher.doFinal(ciphertext)
        if(!capsule.delete()){clear.fill(0);error("Cannot consume encrypted validation capsule")}
        return clear
    }
}
