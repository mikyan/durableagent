package dev.durableagent.probe

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Test-only read transactions. No Harness, transport, credential table or recovery mutation. */
internal object RecoveryFailureObservation {
    private val labels=setOf("status","phase","kind","reason","code","replay","state","name","toolName")
    private fun shape(value:Any?,key:String=""):Any = when(value){
        null,JSONObject.NULL->JSONObject.NULL
        is Boolean,is Number->value
        is String->if(key in labels&&value.matches(Regex("[A-Za-z0-9._:-]{0,100}")))value else JSONObject().put("stringLength",value.length)
        is JSONObject->JSONObject().also{result->value.keys().forEach{field->result.put(field,shape(value.get(field),field))}}
        is JSONArray->JSONArray().also{result->for(i in 0 until value.length())result.put(shape(value.get(i),key))}
        else->value.javaClass.simpleName
    }
    private fun read(path:File,action:(SQLiteDatabase)->JSONObject):JSONObject {
        if(!path.isFile)return JSONObject().put("present",false)
        var stage="open-readonly"
        return try{SQLiteDatabase.openDatabase(path.absolutePath,null,SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use{db->
            stage="configure-busy-timeout";db.rawQuery("PRAGMA busy_timeout=100",null).use{it.moveToFirst()}
            stage="begin-read-transaction";db.execSQL("BEGIN")
            stage="read-snapshot"
            try{action(db).put("readOnly",true)}finally{try{db.execSQL("ROLLBACK")}catch(error:Exception){stage="rollback";throw error}}
        }}catch(error:Exception){
            val reason=when{error.message?.contains("query or rawQuery")==true->"ROW_RETURNING_STATEMENT";error.message?.contains("locked",ignoreCase=true)==true->"SQLITE_LOCKED";else->"READ_FAILED"}
            JSONObject().put("readFailure",error.javaClass.simpleName).put("readStage",stage).put("readCode",reason)
        }
    }
    /** Bounded diagnostic projection of the immutable request, not an SDK reimplementation. */
    fun fixedRequest(context:Context,mode:String,run:String,product:String,sdkId:Long,executionId:String,intentKey:String,expectedDigest:String,expectedCommand:String):JSONObject {
        val sdk=File(context.filesDir,if(mode=="product")"application/application.sqlite" else "application-validation/$run/application.sqlite")
        return read(sdk){db->
            val document=db.rawQuery("SELECT id FROM documents WHERE kind=? AND key_value=? AND scope_kind='session' AND owner_id=0 AND family=1 AND retired_at IS NULL",arrayOf(JSONObject.quote("app.managed-execution-intent"),JSONObject.quote(intentKey))).use{rows->check(rows.moveToFirst());val id=rows.getLong(0);check(!rows.moveToNext());id}
            var request:JSONObject?=null;var baseSeq=0L;var latestSeq=0L
            db.rawQuery("SELECT seq,version,content FROM document_revisions WHERE document_id=? AND kind='base' ORDER BY seq DESC LIMIT 1",arrayOf(document.toString())).use{rows->check(rows.moveToFirst());check(rows.getInt(1)==1);baseSeq=rows.getLong(0);latestSeq=baseSeq;request=JSONObject(rows.getString(2)).optJSONObject("request")}
            db.rawQuery("SELECT seq,kind,version,content FROM document_revisions WHERE document_id=? AND seq>? ORDER BY seq",arrayOf(document.toString(),baseSeq.toString())).use{rows->while(rows.moveToNext()){
                check(rows.getString(1)=="delta"&&rows.getInt(2)==1);val changes=JSONArray(rows.getString(3))
                for(i in 0 until changes.length()){
                    val op=changes.getJSONArray(i);val kind=op.getString(0)
                    if(kind=="r"){check(op.length()==2);request=op.getJSONObject(1).optJSONObject("request");continue}
                    check(kind in setOf("s","d","a","t","p","m"));val path=op.getJSONArray(1);check(path.length()>0)
                    if(path.getString(0)=="request"){
                        // The product saves the full immutable request. Never guess
                        // through a future partial rewrite or deletion of that request.
                        check(kind=="s"&&path.length()==1&&op.length()==3);request=op.optJSONObject(2)
                    }
                };latestSeq=rows.getLong(0)
            }}
            val fixed=checkNotNull(request);val owner=fixed.getJSONObject("context")
            check(fixed.getString("executionId")==executionId&&owner.getString("productId")==product&&owner.getLong("sdkConversationId")==sdkId)
            val digest=NativeInputStore.sha256(NativeExecutionFence.canonical(fixed).toByteArray(Charsets.UTF_8));check(digest==expectedDigest)
            val command=fixed.getJSONObject("command");check(command.getString("kind")=="shell"&&command.getString("script")==expectedCommand)
            JSONObject().put("verified",true).put("executionId",executionId).put("requestDigest",digest).put("timeoutMs",fixed.get("timeoutMs"))
                .put("documentId",document).put("baseSeq",baseSeq).put("latestSeq",latestSeq).put("commandMatches",true)
        }
    }
    fun capture(context:Context,mode:String,run:String,product:String,sdkId:Long,executionId:String,intentKey:String):JSONObject {
        val namespace=NativeInputBridge.namespace(mode,run)
        val sdk=File(context.filesDir,if(mode=="product")"application/application.sqlite" else "application-validation/$run/application.sqlite")
        return JSONObject().put("product",product).put("executionId",executionId).put("sdkId",sdkId)
            .put("sdk",read(sdk){db->
                val tasks=JSONArray();db.rawQuery("SELECT record FROM tasks WHERE conversation_id=? ORDER BY id",arrayOf(sdkId.toString())).use{rows->while(rows.moveToNext()){
                    val record=JSONObject(rows.getString(0));tasks.put(JSONObject().put("id",record.getLong("id")).put("kind",record.getString("kind")).put("abortRequested",record.optBoolean("abortRequested")).put("state",shape(record.getJSONObject("state"))).put("startedAt",record.opt("startedAt")?:JSONObject.NULL).put("endedAt",record.opt("endedAt")?:JSONObject.NULL))
                }}
                val revisions=JSONArray();db.rawQuery("SELECT r.seq,r.kind,r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind=? AND d.key_value=? ORDER BY r.seq",arrayOf(JSONObject.quote("app.managed-execution-intent"),JSONObject.quote(intentKey))).use{rows->while(rows.moveToNext()){
                    val content=rows.getString(2);val value=if(content.trimStart().startsWith("["))JSONArray(content)else JSONObject(content)
                    revisions.put(JSONObject().put("seq",rows.getLong(0)).put("kind",rows.getString(1)).put("shape",shape(value)))
                }}
                JSONObject().put("tasks",tasks).put("executionRevisions",revisions)
            })
            .put("recovery",read(File(context.noBackupFilesDir,"recovery-$namespace/recovery.sqlite")){db->
                val values=JSONObject();db.rawQuery("SELECT key,data FROM metadata WHERE key IN ('wake','host','projection')",null).use{rows->while(rows.moveToNext()){
                    val key=rows.getString(0);val value=JSONObject(rows.getString(1));if(key=="projection"){
                        val conversations=JSONArray();val completions=JSONArray();for(field in listOf("conversations","completions")){val rows=value.optJSONArray(field)?:JSONArray();for(i in 0 until rows.length()){val row=rows.getJSONObject(i);if(row.optString(if(field=="conversations")"id" else "conversationId")==product)(if(field=="conversations")conversations else completions).put(row)}}
                        values.put(key,JSONObject().put("conversations",conversations).put("completions",completions))
                    }else values.put(key,value)
                }}
                val probes=JSONArray();db.rawQuery("SELECT used,next_at FROM probes WHERE work_id=?",arrayOf(executionId)).use{rows->while(rows.moveToNext())probes.put(JSONObject().put("used",rows.getInt(0)).put("nextAt",rows.getLong(1)))};values.put("probes",probes)
            })
            .put("policy",read(File(context.noBackupFilesDir,"$namespace/data-saver/policy.sqlite")){db->
                val result=JSONObject();db.rawQuery("SELECT enabled,version,period FROM policy WHERE id=1",null).use{rows->if(rows.moveToFirst())result.put("enabled",rows.getInt(0)).put("version",rows.getLong(1)).put("period",rows.getLong(2))}
                db.rawQuery("SELECT data FROM operations WHERE id=?",arrayOf(executionId)).use{rows->if(rows.moveToFirst()){
                    val value=JSONObject(rows.getString(0));for(field in listOf("state","sequence","scopeConfirmed","terminal","dispatched","policyInterrupted","interruptedAtElapsed","policyCancelAttempts","policyCancelError","cancelReason"))if(value.has(field))result.put(field,value.get(field))
                }};result
            })
    }
}
