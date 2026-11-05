package dev.durableagent.probe

import android.os.Bundle
import android.os.SystemClock
import android.os.UserManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.caoccao.javet.enums.V8AwaitMode
import com.caoccao.javet.interop.NodeRuntime
import com.caoccao.javet.interop.V8Host
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Does not bind/start any owner or resolve a credential. Never opens a validation namespace. */
@RunWith(AndroidJUnit4::class)
class RecoveryProductPreflightTest {
    @Test(timeout=30000) fun inspectProductDefaultConnectionsAndActiveWorkWithoutOpeningHarness(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        check(context.getSystemService(UserManager::class.java).isUserUnlocked){"Wait for real first unlock"}
        val domain=File(context.filesDir,"application");val database=File(domain,"application.sqlite")
        if(!database.isFile){instrumentation.sendStatus(0,Bundle().apply{putString("productRecoveryPreflight",JSONObject().put("databaseExists",false).put("ownerNotOpened",true).put("credentialsNotResolved",true).toString())});return}
        val lease=StorageDomainLease.acquire(domain)?:error("Product owner is active; no preflight performed")
        lease.use{
            val root=RuntimeBundle.unpack(context)
            V8Host.getNodeI18nInstance().createV8Runtime<NodeRuntime>().use{runtime->
                val module=JSONObject.quote(File(root,"validation/recovery-product-preflight.mjs").toURI().toString())
                val source="import($module).then(m=>m.inspectProductRecovery(${JSONObject.quote(database.absolutePath)})).then(r=>globalThis.__productPreflight=JSON.stringify(r)).catch(e=>globalThis.__productFailure=String(e.message));"
                runtime.getExecutor("const vm=require('node:vm');new vm.Script(${JSONObject.quote(source)},{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInThisContext();").executeVoid()
                val deadline=SystemClock.elapsedRealtime()+20000
                while(runtime.getExecutor("typeof globalThis.__productPreflight").executeString()!="string"){runtime.await(V8AwaitMode.RunNoWait);val error=runtime.getExecutor("globalThis.__productFailure||''").executeString();check(error.isEmpty()){error};check(SystemClock.elapsedRealtime()<deadline){"Read-only product preflight timed out"};Thread.sleep(10)}
                val result=JSONObject(runtime.getExecutor("globalThis.__productPreflight").executeString()).put("databaseExists",true).put("credentialsNotResolved",true)
                val connections=result.getJSONArray("connections");val vault=CredentialVault(context)
                for(index in 0 until connections.length()){val connection=connections.getJSONObject(index);connection.put("credential",vault.metadata(connection.getString("id")).toJson())}
                instrumentation.sendStatus(0,Bundle().apply{putString("productRecoveryPreflight",result.toString())})
            }
        }
    }
}
