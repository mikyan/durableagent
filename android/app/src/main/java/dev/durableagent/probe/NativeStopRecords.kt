package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject

/** Fixed-core effect ownership shares the native control transaction, never SDK scheduling tables. */
internal object NativeStopRecords {
    fun createSchema(db:SQLiteDatabase,recovered:Boolean=true){db.execSQL("CREATE TABLE native_effects(operation_id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES conversations(id),generation INTEGER NOT NULL,data TEXT NOT NULL)");db.execSQL("CREATE TABLE native_effect_catalogue(singleton INTEGER PRIMARY KEY CHECK(singleton=1),recovered INTEGER NOT NULL CHECK(recovered IN(0,1)))");db.execSQL("INSERT INTO native_effect_catalogue(singleton,recovered) VALUES(1,?)",arrayOf(if(recovered)1 else 0))}
    fun recovery(db:SQLiteDatabase,complete:Boolean){db.execSQL("UPDATE native_effect_catalogue SET recovered=? WHERE singleton=1",arrayOf(if(complete)1 else 0))}
    private fun fail(code:String,message:String):Nothing=throw NativeInputException(code,message)
    private fun id(value:JSONObject,key:String):String=(value.opt(key) as? String)?.takeIf{it.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,199}"))}?:fail("INPUT_INVALID","受管操作身份无效。")
    private fun number(value:JSONObject,key:String):Long {val n=value.opt(key);if(n !is Number||n.toDouble()!=n.toLong().toDouble()||n.toLong() !in 1..9_007_199_254_740_991L)fail("INPUT_INVALID","受管操作控制代次无效。");return n.toLong()}
    private fun normalize(value:JSONObject):JSONObject {
        val kind=value.optString("kind");val source=value.optString("source")
        if(kind !in setOf("command","file")||source !in setOf("termux","saf"))fail("INPUT_INVALID","未登记的受管操作类型。")
        val digest=value.optString("requestDigest");if(!digest.matches(Regex("[a-f0-9]{64}")))fail("INPUT_INVALID","受管操作摘要无效。")
        return JSONObject().put("operationId",id(value,"operationId")).put("productId",id(value,"productId"))
            .put("kind",kind).put("source",source).put("namespace",id(value,"namespace"))
            .put("controlGeneration",number(value,"controlGeneration")).put("sdkConversationId",number(value,"sdkConversationId")).put("requestDigest",digest)
    }
    private fun permit(db:SQLiteDatabase,row:JSONObject){val control=NativeSubmissionRecords.control(db,row.getString("productId"));val generation=row.getLong("controlGeneration")
        if(control.has("pendingAbort")||control.getLong("generation")!=generation||control.getLong("stoppedThrough")>=generation)fail("EXECUTION_STOPPED","原控制代次已停止，未启动新的受管操作。")}
    fun register(db:SQLiteDatabase,value:JSONObject,historical:Boolean=false):JSONObject {
        val fixed=normalize(value);val operationId=fixed.getString("operationId");val old=readOrNull(db,operationId)
        if(old!=null&&normalize(old).toString()!=fixed.toString())fail("EXECUTION_IDENTITY_CONFLICT","受管操作身份已绑定不同内容或控制范围。")
        if(historical)NativeSubmissionRecords.control(db,fixed.getString("productId")) else permit(db,fixed)
        if(old!=null)return old
        val count=db.rawQuery("SELECT COUNT(*) FROM native_effects",null).use{it.moveToFirst();it.getInt(0)}
        if(count>=4096)fail("EXECUTION_CAPACITY","受管操作目录已达保留上限，未启动新操作。")
        val row=JSONObject(fixed.toString()).put("state","registered").put("scopeConfirmed",false).put("sequence",-1)
        db.execSQL("INSERT INTO native_effects(operation_id,product_id,generation,data) VALUES(?,?,?,?)",arrayOf(operationId,fixed.getString("productId"),fixed.getLong("controlGeneration"),row.toString()))
        return row
    }
    private fun readOrNull(db:SQLiteDatabase,id:String):JSONObject?=db.rawQuery("SELECT data FROM native_effects WHERE operation_id=?",arrayOf(id)).use{if(it.moveToFirst())JSONObject(it.getString(0))else null}
    fun require(db:SQLiteDatabase,id:String):JSONObject {val row=readOrNull(db,id)?:fail("EXECUTION_UNREGISTERED","尚无耐久受管操作登记，未派发。");permit(db,row);return row}
    fun evidence(db:SQLiteDatabase,id:String,value:JSONObject):JSONObject {
        val row=readOrNull(db,id)?:fail("EXECUTION_UNREGISTERED","无法将执行证据关联到原操作。")
        if(value.optString("operationId")!=id||value.optString("requestDigest")!=row.getString("requestDigest")||value.optString("namespace")!=row.getString("namespace"))fail("EXECUTION_IDENTITY_CONFLICT","执行证据不属于原操作或固定请求。")
        val state=value.optString("state");if(state !in setOf("registered","accepted_not_started","starting","running","stop_requested","completed","stopped","not_started","unknown"))fail("INPUT_INVALID","执行证据状态无效。")
        val confirmed=value.optBoolean("scopeConfirmed",false);val sequence=value.optLong("sequence",-1)
        if(sequence<row.optLong("sequence",-1)||terminal(row)&&!terminal(value))return row
        row.put("state",state).put("scopeConfirmed",confirmed).put("sequence",sequence)
        // Only bounded categories and actual terminal facts; no command text, output or credentials.
        if(value.has("reason")){val reason=value.optString("reason");if(reason.matches(Regex("[A-Z][A-Z0-9_]{0,79}")))row.put("reason",reason)}
        db.execSQL("UPDATE native_effects SET data=? WHERE operation_id=?",arrayOf(row.toString(),id));return row
    }
    private fun terminal(row:JSONObject)=row.optString("state") in setOf("completed","stopped","not_started")&&row.optBoolean("scopeConfirmed",false)
    fun stopped(db:SQLiteDatabase,after:String?=null):JSONArray {
        val result=JSONArray();db.rawQuery("SELECT data FROM native_effects WHERE operation_id>? ORDER BY operation_id",arrayOf(after?:"")).use{rows->while(rows.moveToNext()){
            val row=JSONObject(rows.getString(0));if(terminal(row))continue
            if(row.getLong("controlGeneration")<=NativeSubmissionRecords.control(db,row.getString("productId")).getLong("stoppedThrough")){result.put(row);if(result.length()==64)break}
        }};return result
    }
    fun status(db:SQLiteDatabase,id:String):JSONObject {
        val control=NativeSubmissionRecords.control(db,id);var pending=0;var unknown=0
        db.rawQuery("SELECT data FROM native_effects WHERE product_id=? AND generation<=?",arrayOf(id,control.getLong("stoppedThrough").toString())).use{rows->while(rows.moveToNext()){val row=JSONObject(rows.getString(0));if(!terminal(row)){pending++;if(row.optString("state")=="unknown")unknown++}}}
        val requested=control.getLong("stoppedThrough")>0
        val recovered=db.rawQuery("SELECT recovered FROM native_effect_catalogue WHERE singleton=1",null).use{it.moveToFirst()&&it.getInt(0)==1}
        return JSONObject().put("control",control).put("externalPending",pending).put("externalUnknown",unknown)
            .put("catalogueReady",recovered).put("phase",if(!requested)"not-requested" else if(control.has("pendingAbort"))"waiting" else if(pending>0||!recovered)"external-unconfirmed" else "stopped")
    }
}
