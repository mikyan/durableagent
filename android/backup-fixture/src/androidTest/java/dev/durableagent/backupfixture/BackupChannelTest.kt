package dev.durableagent.backupfixture

import android.content.Context
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Seeds only the separate fixture UID. Never sees production app files or credentials. */
@RunWith(AndroidJUnit4::class)
class BackupChannelTest {
    private val instrument=InstrumentationRegistry.getInstrumentation()
    private val context=instrument.targetContext
    private val backupRun=InstrumentationRegistry.getArguments().getString("backupRun")?.also{require(it.matches(Regex("[a-zA-Z0-9-]{1,80}")))}
    private val marker="T16-SYNTHETIC-ONLY-${context.packageName}"+(backupRun?.let{"--$it"}?:"")
    private fun locations():Map<String,File> {
        val device=context.createDeviceProtectedStorageContext()
        return linkedMapOf("root" to File(context.dataDir,"t16-root-marker"),"file" to File(context.filesDir,"application/t16-marker"),"database" to context.getDatabasePath("t16-marker.sqlite"),"external" to File(context.getExternalFilesDir(null),"t16-marker"),"device_root" to File(device.dataDir,"t16-root-marker"),"device_file" to File(device.filesDir,"t16-marker"),"device_database" to device.getDatabasePath("t16-marker.sqlite"),"no_backup" to File(context.noBackupFilesDir,"input-v1/t16-input-intent-control-marker"),"credential" to File(context.noBackupFilesDir,"credentials-v1/t16-synthetic-ciphertext-marker"))
    }
    @Test fun seedSyntheticDomains() {
        check(context.packageName.startsWith("dev.durableagent.backupfixture."))
        for((domain,file) in locations()){file.parentFile!!.mkdirs();java.io.FileOutputStream(file).use{it.write("$marker:$domain".toByteArray());it.fd.sync()}}
        assertTrue(context.getSharedPreferences("t16-marker",Context.MODE_PRIVATE).edit().putString("marker",marker).commit())
        assertTrue(context.createDeviceProtectedStorageContext().getSharedPreferences("t16-marker",Context.MODE_PRIVATE).edit().putString("marker",marker).commit())
        report("seeded")
    }
    @Test fun observeAfterChannel() { report("observed") }
    @Test fun assertExcludedAfterRestore() {
        assertTrue(context.packageName.endsWith(".rules"));for((domain,file) in locations())assertFalse("Unexpected restored $domain",file.exists())
        assertNull(context.getSharedPreferences("t16-marker",Context.MODE_PRIVATE).getString("marker",null));assertNull(context.createDeviceProtectedStorageContext().getSharedPreferences("t16-marker",Context.MODE_PRIVATE).getString("marker",null));report("exclusions-verified")
    }
    @Test fun assertPositiveControlRestored() {
        assertTrue(context.packageName.endsWith(".control"))
        for(domain in listOf("root","file","database"))assertEquals("$marker:$domain",locations().getValue(domain).readText())
        assertEquals(marker,context.getSharedPreferences("t16-marker",Context.MODE_PRIVATE).getString("marker",null))
        // no_backup remains excluded even in the permissive control; a restore is not full cloning.
        assertFalse(locations().getValue("no_backup").exists());assertFalse(locations().getValue("credential").exists());report("positive-control-restored")
    }
    private fun report(stage:String) {
        val result=JSONObject().put("stage",stage).put("package",context.packageName).put("build",android.os.Build.FINGERPRINT).put("backupRun",backupRun?:"legacy-no-nonce")
        val present=JSONObject();for((domain,file) in locations())present.put(domain,file.exists())
        val matches=JSONObject();for((domain,file) in locations())matches.put(domain,file.isFile&&file.readText()=="$marker:$domain")
        present.put("sharedpref",context.getSharedPreferences("t16-marker",Context.MODE_PRIVATE).contains("marker"));present.put("device_sharedpref",context.createDeviceProtectedStorageContext().getSharedPreferences("t16-marker",Context.MODE_PRIVATE).contains("marker"))
        matches.put("sharedpref",context.getSharedPreferences("t16-marker",Context.MODE_PRIVATE).getString("marker",null)==marker);matches.put("device_sharedpref",context.createDeviceProtectedStorageContext().getSharedPreferences("t16-marker",Context.MODE_PRIVATE).getString("marker",null)==marker)
        result.put("present",present).put("matchesCurrentRun",matches);instrument.sendStatus(0,Bundle().apply{putString("backupEvidence",result.toString())})
    }
}
