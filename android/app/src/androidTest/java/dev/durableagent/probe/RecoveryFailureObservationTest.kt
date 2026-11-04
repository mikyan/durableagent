package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class RecoveryFailureObservationTest {
    @Test fun fixedRequestObservationVerifiesReceiptBeforeReportingTimeoutWithoutExposingContent(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext;val run=UUID.randomUUID().toString()
        val directory=File(context.filesDir,"application-validation/$run");check(!directory.exists());check(directory.mkdirs())
        val sdk=File(directory,"application.sqlite");val key="117:isolated-call:1";val command="private-command-should-not-appear"
        val request=JSONObject().put("executionId","isolated-execution").put("context",JSONObject().put("productId","isolated-product").put("sdkConversationId",102))
            .put("command",JSONObject().put("kind","shell").put("script",command)).put("timeoutMs",30000).put("env",JSONObject().put("PRIVATE","private-env-should-not-appear"))
        val digest=NativeInputStore.sha256(NativeExecutionFence.canonical(request).toByteArray(Charsets.UTF_8))
        fun observe(expectedDigest:String=digest,execution:String="isolated-execution",expectedCommand:String=command):JSONObject {
            val before=sdk.readBytes()
            val result=RecoveryFailureObservation.fixedRequest(context,"recovery-fixture",run,"isolated-product",102,execution,key,expectedDigest,expectedCommand)
            assertArrayEquals(before,sdk.readBytes());assertFalse(result.toString().contains("private-command"));assertFalse(result.toString().contains("private-env"));return result
        }
        try{
            SQLiteDatabase.openOrCreateDatabase(sdk,null).use{db->
                db.execSQL("CREATE TABLE documents(id INTEGER,kind TEXT,key_value TEXT,scope_kind TEXT,owner_id INTEGER,family INTEGER,retired_at INTEGER)")
                db.execSQL("CREATE TABLE document_revisions(document_id INTEGER,seq INTEGER,kind TEXT,version INTEGER,content TEXT)")
                db.execSQL("INSERT INTO documents VALUES(1,?,?,'session',0,1,NULL)",arrayOf(JSONObject.quote("app.managed-execution-intent"),JSONObject.quote(key)))
                db.execSQL("INSERT INTO document_revisions VALUES(1,100,'base',1,'{\"request\":null,\"cursor\":0}')")
                db.execSQL("INSERT INTO document_revisions VALUES(1,101,'delta',1,?)",arrayOf(JSONArray().put(JSONArray().put("s").put(JSONArray().put("request")).put(request)).toString()))
                db.execSQL("INSERT INTO document_revisions VALUES(1,102,'delta',1,'[[\"s\",[\"cursor\"],1],[\"s\",[\"receipt\"],{\"state\":\"running\"}]]')")
            }
            val projected=observe();assertTrue(projected.toString(),projected.optBoolean("readOnly")&&projected.optBoolean("verified"));assertEquals(30000,projected.getInt("timeoutMs"));assertEquals(102L,projected.getLong("latestSeq"));assertEquals(digest,projected.getString("requestDigest"))
            for(result in listOf(observe(expectedDigest="wrong-digest"),observe(execution="other-execution"),observe(expectedCommand="another-command"))){assertFalse(result.optBoolean("verified"));assertTrue(result.has("readFailure"))}
            SQLiteDatabase.openDatabase(sdk.path,null,SQLiteDatabase.OPEN_READWRITE).use{db->db.execSQL("INSERT INTO document_revisions VALUES(1,103,'delta',1,'[[\"s\",[\"request\",\"timeoutMs\"],60000]]')")}
            assertTrue("Never report a stale base through an unsupported request rewrite",observe().has("readFailure"))
            SQLiteDatabase.openDatabase(sdk.path,null,SQLiteDatabase.OPEN_READWRITE).use{db->db.execSQL("INSERT INTO document_revisions VALUES(1,104,'base',1,?)",arrayOf(JSONObject().put("request",request).toString()))}
            val checkpoint=observe();assertTrue(checkpoint.getBoolean("verified"));assertEquals(104L,checkpoint.getLong("baseSeq"))
            SQLiteDatabase.openDatabase(sdk.path,null,SQLiteDatabase.OPEN_READWRITE).use{db->db.execSQL("INSERT INTO document_revisions VALUES(1,105,'delta',1,?)",arrayOf(JSONArray().put(JSONArray().put("r").put(JSONObject().put("request",request))).toString()))}
            assertEquals(105L,observe().getLong("latestSeq"))
        }finally{
            check(directory.canonicalPath.startsWith(context.filesDir.canonicalPath+"/application-validation/"));directory.deleteRecursively()
        }
    }
    @Test fun readonlyDiagnosticObservesThreeRealAndroidDatabasesWithoutChangingThem(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val mode="recovery-fixture";val run=UUID.randomUUID().toString();val namespace=NativeInputBridge.namespace(mode,run)
        val sdkRoot=File(context.filesDir,"application-validation/$run");val recoveryRoot=File(context.noBackupFilesDir,"recovery-$namespace");val policyRoot=File(context.noBackupFilesDir,namespace)
        val sdk=File(sdkRoot,"application.sqlite");val recovery=File(recoveryRoot,"recovery.sqlite");val policy=File(policyRoot,"data-saver/policy.sqlite")
        val product="isolated-observation";val execution="isolated-execution";val key="117:synthetic-call:1"
        fun create(path:File,write:(SQLiteDatabase)->Unit){check(!path.exists());check(path.parentFile!!.mkdirs());SQLiteDatabase.openOrCreateDatabase(path,null).use(write)}
        try{
            create(sdk){db->
                db.execSQL("CREATE TABLE tasks(id INTEGER,conversation_id INTEGER,record TEXT)")
                db.execSQL("CREATE TABLE documents(id INTEGER,kind TEXT,key_value TEXT)")
                db.execSQL("CREATE TABLE document_revisions(document_id INTEGER,seq INTEGER,kind TEXT,content TEXT)")
                db.execSQL("INSERT INTO tasks VALUES(117,102,?)",arrayOf(JSONObject().put("id",117).put("kind","pi.tool").put("abortRequested",false).put("state",JSONObject().put("status","running").put("checkpoint",JSONObject().put("phase","execute").put("arguments",JSONObject().put("command","private-command-should-not-appear")))).toString()))
                db.execSQL("INSERT INTO documents VALUES(1,?,?)",arrayOf(JSONObject.quote("app.managed-execution-intent"),JSONObject.quote(key)))
                db.execSQL("INSERT INTO document_revisions VALUES(1,105,'base',?)",arrayOf(JSONObject().put("cursor",1).put("receipt",JSONObject().put("state","running").put("sequence",4).put("outputCursor",1)).toString()))
            }
            create(recovery){db->
                db.execSQL("CREATE TABLE metadata(key TEXT,data TEXT)");db.execSQL("CREATE TABLE probes(work_id TEXT,used INTEGER,next_at INTEGER)")
                db.execSQL("INSERT INTO metadata VALUES('wake','{\"active\":true}')")
                db.execSQL("INSERT INTO metadata VALUES('projection',?)",arrayOf("{\"conversations\":[{\"id\":\"$product\",\"phase\":\"running\"},{\"id\":\"unrelated-private-product\",\"phase\":\"done\"}],\"completions\":[]}"))
                db.execSQL("INSERT INTO probes VALUES(?,2,12345)",arrayOf(execution))
            }
            create(policy){db->
                db.execSQL("CREATE TABLE policy(id INTEGER,enabled INTEGER,version INTEGER,period INTEGER)");db.execSQL("INSERT INTO policy VALUES(1,0,0,15)")
                db.execSQL("CREATE TABLE operations(id TEXT,data TEXT)");db.execSQL("INSERT INTO operations VALUES(?,?)",arrayOf(execution,"{\"state\":\"running\",\"sequence\":4,\"dispatched\":true,\"summary\":\"private-command-should-not-appear\"}"))
            }
            val paths=listOf(sdk,recovery,policy);val before=paths.map{it.readBytes()}
            val observed=RecoveryFailureObservation.capture(context,mode,run,product,102,execution,key)
            for(field in listOf("sdk","recovery","policy"))assertTrue(observed.toString(),observed.getJSONObject(field).optBoolean("readOnly"))
            assertEquals("execute",observed.getJSONObject("sdk").getJSONArray("tasks").getJSONObject(0).getJSONObject("state").getJSONObject("checkpoint").getString("phase"))
            assertEquals(1,observed.getJSONObject("sdk").getJSONArray("executionRevisions").getJSONObject(0).getJSONObject("shape").getInt("cursor"))
            assertEquals(1,observed.getJSONObject("recovery").getJSONObject("projection").getJSONArray("conversations").length())
            assertEquals(2,observed.getJSONObject("recovery").getJSONArray("probes").getJSONObject(0).getInt("used"))
            assertTrue(observed.getJSONObject("policy").getBoolean("dispatched"));assertFalse(observed.toString().contains("private-command"));assertFalse(observed.toString().contains("unrelated-private-product"))
            paths.forEachIndexed{index,path->assertArrayEquals("Read-only observation changed $index",before[index],path.readBytes())}
        }finally{
            // All three directories are constructed here from this test's fresh UUID.
            for(directory in listOf(sdkRoot,recoveryRoot,policyRoot)){check(directory.canonicalPath.startsWith(context.dataDir.canonicalPath+"/"));directory.deleteRecursively()}
        }
    }
}
