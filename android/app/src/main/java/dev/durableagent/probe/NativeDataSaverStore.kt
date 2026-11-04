package dev.durableagent.probe

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import android.os.UserManager
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream

/** Native policy authority; callers supply a fresh Android platform snapshot, never a UI flag. */
data class DataSaverNetwork(val identity:String?,val known:Boolean,val metered:Boolean,val blocked:Boolean=false) {
    fun json()=JSONObject().put("identity",identity?:JSONObject.NULL).put("known",known).put("metered",metered).put("blocked",blocked)
}

class NativeDataSaverStore(private val context:Context,private val namespace:String):AutoCloseable {
    private var currentNetwork:(()->DataSaverNetwork)?=null
    constructor(context:Context,namespace:String,currentNetwork:()->DataSaverNetwork):this(context,namespace){this.currentNetwork=currentNetwork}
    private var helper:PolicyDatabase?=null
    private var closed=false
    init {if(!namespace.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,199}")))fail("DATA_SAVER_INVALID","省流存储身份无效。")}
    fun query(network:DataSaverNetwork):JSONObject=transaction(network){db,network->refresh(db,network);view(db,network)}
    fun configure(enabled:Boolean,expectedVersion:Long,network:DataSaverNetwork):JSONObject=transaction(network){db,network->
        if(expectedVersion<0||row(db).getLong("version")!=expectedVersion)fail("DATA_SAVER_CONFLICT","省流设置已改变，请读取当前设置后重试。")
        db.execSQL("UPDATE policy SET enabled=?,version=version+1,period=period+1 WHERE id=1",arrayOf(if(enabled)1 else 0))
        refresh(db,network);invalidateRunning(db,network);view(db,network)
    }
    fun register(request:JSONObject,network:DataSaverNetwork):JSONObject=transaction(network){db,network->
        val id=request.getString("executionId");validateId(id)
        val digest=NativeInputStore.sha256(NativeExecutionFence.canonical(request).toByteArray(Charsets.UTF_8))
        val previous=operation(db,id)
        if(previous!=null&&previous.getString("requestDigest")!=digest)fail("DATA_SAVER_IDENTITY_CONFLICT","同一执行的固定内容已改变，不能继承省流许可。")
        if(previous==null){
            val owner=request.getJSONObject("context")
            val value=JSONObject().put("executionId",id).put("requestDigest",digest).put("productId",owner.getString("productId")).put("controlGeneration",owner.getLong("controlGeneration"))
                .put("namespace",owner.getString("namespace")).put("classification","unknown").put("summary",request.getJSONObject("command").toString().take(512)).put("grantPeriod",JSONObject.NULL).put("finalDigest",JSONObject.NULL)
            db.execSQL("INSERT INTO operations(id,data) VALUES(?,?)",arrayOf(id,value.toString()))
        }
        refresh(db,network);operationView(db,id,network)
    }
    fun decision(executionId:String,network:DataSaverNetwork):JSONObject=transaction(network){db,network->refresh(db,network);operationView(db,executionId,network)}
    fun operations(productId:String,cursor:String?,network:DataSaverNetwork):JSONObject=transaction(network){db,network->
        refresh(db,network)
        if(cursor!=null&&operation(db,cursor)?.optString("productId")!=productId)fail("DATA_SAVER_CURSOR_INVALID","省流列表位置已失效，请重新读取。")
        val result=JSONArray();var last:String?=null;var more=false
        // The immutable insertion boundary keeps a page stable when a newer operation arrives.
        // Operation IDs are opaque identities; sorting UUIDs hides the current waiting work.
        val sql=if(cursor==null)"SELECT id,data FROM operations ORDER BY rowid DESC" else "SELECT id,data FROM operations WHERE rowid<(SELECT rowid FROM operations WHERE id=?) ORDER BY rowid DESC"
        db.rawQuery(sql,if(cursor==null)null else arrayOf(cursor)).use{rows->while(rows.moveToNext()){
            if(JSONObject(rows.getString(1)).optString("productId")!=productId)continue
            if(result.length()==20){more=true;break};last=rows.getString(0);result.put(operationView(db,last!!,network))
        }}
        JSONObject().put("operations",result).put("nextCursor",if(more)last else JSONObject.NULL)
    }
    fun requireStart(executionId:String,finalDigest:String,network:DataSaverNetwork):JSONObject=decide(transaction(network){db,network->
        refresh(db,network);if(operation(db,executionId)==null)return@transaction Denied("DATA_SAVER_NOT_FOUND","固定执行不存在。")
        val current=operationView(db,executionId,network)
        if(current.optString("finalDigest")!=finalDigest||!finalDigest.matches(Regex("[a-f0-9]{64}")))return@transaction Denied("DATA_SAVER_IDENTITY_CONFLICT","最终启动内容与已准备内容不一致。")
        if(current.optBoolean("policyInterrupted"))return@transaction Denied("DATA_SAVER_INTERRUPTED","网络变化后的原执行不能自动重跑。")
        if(current.getString("phase")=="terminal")return@transaction Denied("DATA_SAVER_TERMINAL","原执行已经结束，不能再次启动。")
        if(current.getString("phase") !in setOf("allowed","granted"))return@transaction Denied("DATA_SAVER_WAIT","省流等待：尚未满足本次固定执行的网络条件。")
        current.put("dispatched",true);saveOperation(db,current);Accepted(operationView(db,executionId,network))
    })
    fun claimAffected(network:DataSaverNetwork,after:String=""):JSONObject=transaction(network){db,network->
        refresh(db,network);invalidateRunning(db,network)
        val rows=mutableListOf<JSONObject>();db.rawQuery("SELECT data FROM operations WHERE id>? ORDER BY id LIMIT 65",arrayOf(after)).use{cursor->while(cursor.moveToNext())rows.add(JSONObject(cursor.getString(0)))}
        val page=rows.take(64);val affected=JSONArray()
        for(value in page)if(value.optBoolean("policyInterrupted")&&!value.optBoolean("terminal"))affected.put(operationView(db,value.getString("executionId"),network))
        JSONObject().put("operations",affected).put("nextCursor",if(rows.size>64)page.last().getString("executionId")else JSONObject.NULL)
    }
    fun beginPolicyCancellation(executionId:String,network:DataSaverNetwork):JSONObject?=transaction(network){db,network->
        refresh(db,network);val value=operation(db,executionId)?:return@transaction null
        if(!value.optBoolean("policyInterrupted")||value.optBoolean("terminal")||value.optInt("policyCancelAttempts")>=3)return@transaction null
        value.put("policyCancelAttempts",value.optInt("policyCancelAttempts")+1).put("policyCancelAttemptAtElapsed",SystemClock.elapsedRealtime())
        saveOperation(db,value);operationView(db,executionId,network)
    }
    fun policyCancellationFailed(executionId:String,code:String,network:DataSaverNetwork):Unit=transaction(network){db,network->
        val value=operation(db,executionId)?:return@transaction
        if(!value.optBoolean("terminal")){value.put("policyCancelError",code.takeIf{it.matches(Regex("[A-Z][A-Z0-9_]{0,63}"))}?:"CANCEL_UNCONFIRMED");saveOperation(db,value)}
        refresh(db,network)
    }
    fun observe(receipt:JSONObject,network:DataSaverNetwork,verifiedLocal:Boolean?=null):JSONObject=transaction(network){db,network->
        val id=receipt.getString("executionId");val current=operation(db,id)?:fail("DATA_SAVER_NOT_FOUND","原执行的省流记录不存在。")
        val tombstone=receipt.optString("state")=="not_started"&&receipt.optString("reason")=="CANCELLED_BEFORE_ACCEPTANCE"&&receipt.optBoolean("neverStarted")&&receipt.optBoolean("scopeConfirmed")
        if(receipt.optString("namespace")!=current.getString("namespace")||!tombstone&&(receipt.optString("requestDigest")!=current.getString("requestDigest")||!current.isNull("finalDigest")&&receipt.optString("finalDigest")!=current.getString("finalDigest")))
            fail("DATA_SAVER_IDENTITY_CONFLICT","外部结果不属于这一固定执行。")
        val sequence=receipt.getLong("sequence");if(sequence<0)fail("DATA_SAVER_IDENTITY_CONFLICT","外部结果顺序无法核验。")
        if(!current.optBoolean("terminal")&&sequence>=current.optLong("sequence",-1)){
            val state=receipt.getString("state");if(state !in setOf("accepted_not_started","starting","running","stop_requested","completed","stopped","not_started","unknown"))fail("DATA_SAVER_IDENTITY_CONFLICT","外部执行状态无法核验。")
            if(verifiedLocal!=null){current.put("classification",if(verifiedLocal)"controlled-local" else "unknown").put("localCapability",if(verifiedLocal)JSONObject(receipt.getJSONObject("localCapability").toString())else JSONObject.NULL)}
            current.put("sequence",sequence).put("state",state).put("scopeConfirmed",receipt.optBoolean("scopeConfirmed")).put("terminal",state in setOf("completed","stopped","not_started")&&receipt.optBoolean("scopeConfirmed"))
            val cancelReason=receipt.optString("cancelReason");if(cancelReason in setOf("user","timeout","network_policy"))current.put("cancelReason",cancelReason)
            saveOperation(db,current)
        }
        refresh(db,network);operationView(db,id,network)
    }
    fun revalidateLocal(executionId:String,accept:(JSONObject?)->Boolean,network:DataSaverNetwork):Unit=transaction(network){db,network->
        val value=operation(db,executionId)?:fail("DATA_SAVER_NOT_FOUND","固定执行不存在。")
        if(value.optString("classification")=="controlled-local"&&!accept(value.optJSONObject("localCapability"))){value.put("classification","unknown").put("localCapability",JSONObject.NULL);saveOperation(db,value)}
        refresh(db,network);invalidateRunning(db,network)
    }
    fun prepared(executionId:String,requestDigest:String,finalDigest:String,network:DataSaverNetwork):JSONObject=transaction(network){db,network->
        val current=operation(db,executionId)?:fail("DATA_SAVER_NOT_FOUND","固定执行不存在。")
        if(current.getString("requestDigest")!=requestDigest||!finalDigest.matches(Regex("[a-f0-9]{64}"))||!current.isNull("finalDigest")&&current.getString("finalDigest")!=finalDigest)
            fail("DATA_SAVER_IDENTITY_CONFLICT","执行端的最终参数或环境摘要不一致。")
        current.put("finalDigest",finalDigest);saveOperation(db,current);refresh(db,network);operationView(db,executionId,network)
    }
    fun grant(executionId:String,requestDigest:String,period:Long,network:DataSaverNetwork):JSONObject=decide(transaction(network){db,network->
        refresh(db,network);val policy=view(db,network);val current=operation(db,executionId)?:return@transaction Denied("DATA_SAVER_NOT_FOUND","固定执行不存在。")
        if(current.getString("requestDigest")!=requestDigest)return@transaction Denied("DATA_SAVER_IDENTITY_CONFLICT","临时放行的固定内容不一致。")
        if(current.isNull("finalDigest"))return@transaction Denied("DATA_SAVER_PREPARATION_REQUIRED","请先核验执行端固定后的实际参数和环境。")
        if(current.optBoolean("policyInterrupted")||current.optBoolean("terminal")||current.optBoolean("dispatched"))return@transaction Denied("DATA_SAVER_INTERRUPTED","原执行已下发或结束，不能用新许可重跑。")
        if(period!=policy.getLong("period")||!policy.getBoolean("restricted"))return@transaction Denied("DATA_SAVER_GRANT_EXPIRED","原受限网络期间已结束，请重新核验此操作。")
        current.put("grantPeriod",period).put("grantFinalDigest",current.getString("finalDigest"));saveOperation(db,current);Accepted(operationView(db,executionId,network))
    })
    // Commit newly observed network restrictions even when the requested permission is refused.
    // Storage failures still roll back; a rejection must never revive an expired grant.
    private sealed interface Decision
    private data class Accepted(val value:JSONObject):Decision
    private data class Denied(val code:String,val message:String):Decision
    private fun decide(value:Decision):JSONObject=when(value){is Accepted->value.value;is Denied->fail(value.code,value.message)}
    private fun operation(db:SQLiteDatabase,id:String):JSONObject?=db.rawQuery("SELECT data FROM operations WHERE id=?",arrayOf(id)).use{if(it.moveToFirst())JSONObject(it.getString(0))else null}
    private fun saveOperation(db:SQLiteDatabase,value:JSONObject){db.execSQL("UPDATE operations SET data=? WHERE id=?",arrayOf(value.toString(),value.getString("executionId")))}
    private fun operationView(db:SQLiteDatabase,id:String,network:DataSaverNetwork):JSONObject{
        val value=operation(db,id)?:fail("DATA_SAVER_NOT_FOUND","固定执行不存在。")
        val policy=view(db,network);val phase=when{value.optBoolean("terminal")->"terminal";value.optBoolean("policyInterrupted")->"result-unverified";(!policy.getBoolean("restricted")||value.optString("classification")=="controlled-local")->"allowed";granted(value,policy)->"granted";else->"waiting"}
        return value.put("phase",phase).put("period",policy.getLong("period")).put("reason",policy.getString("reason"))
    }
    private fun granted(value:JSONObject,policy:JSONObject)=value.optLong("grantPeriod",-1)==policy.getLong("period")&&!value.isNull("finalDigest")&&value.optString("grantFinalDigest")==value.getString("finalDigest")
    private fun invalidateRunning(db:SQLiteDatabase,network:DataSaverNetwork){
        val policy=view(db,network);if(!policy.getBoolean("restricted"))return
        db.rawQuery("SELECT data FROM operations",null).use{cursor->while(cursor.moveToNext()){
            val value=JSONObject(cursor.getString(0))
            if(value.optBoolean("dispatched")&&!value.optBoolean("terminal")&&!value.optBoolean("policyInterrupted")&&value.optString("classification")!="controlled-local"&&!granted(value,policy)){
                value.put("policyInterrupted",true).put("interruptedAtElapsed",SystemClock.elapsedRealtime());saveOperation(db,value)
            }
        }}
    }
    private fun refresh(db:SQLiteDatabase,network:DataSaverNetwork){
        val signature=network.json().toString()
        if(row(db).getString("network")!=signature){db.execSQL("UPDATE policy SET network=?,period=period+1 WHERE id=1",arrayOf(signature));invalidateRunning(db,network)}
    }
    private fun row(db:SQLiteDatabase)=db.rawQuery("SELECT enabled,version,period,network FROM policy WHERE id=1",null).use{cursor->
        if(!cursor.moveToFirst())fail("DATA_SAVER_STORAGE_LOST","省流策略记录缺失，保留现有数据并停止下发。")
        JSONObject().put("enabled",cursor.getInt(0)==1).put("version",cursor.getLong(1)).put("period",cursor.getLong(2)).put("network",cursor.getString(3))
    }
    private fun view(db:SQLiteDatabase,network:DataSaverNetwork):JSONObject{
        val row=row(db);val enabled=row.getBoolean("enabled")
        val reason=when{!enabled->"disabled";!network.known->"network-unknown";network.blocked->"network-blocked";network.metered->"metered";else->"unrestricted"}
        return row.put("network",network.json()).put("restricted",reason !in setOf("disabled","unrestricted")).put("reason",reason)
    }
    private fun <T> transaction(supplied:DataSaverNetwork,action:(SQLiteDatabase,DataSaverNetwork)->T):T=synchronized(this){
        if(closed)fail("DATA_SAVER_CLOSED","省流存储已关闭。")
        if(context.isDeviceProtectedStorage||!context.getSystemService(UserManager::class.java).isUserUnlocked)fail("DATA_SAVER_WAITING_UNLOCK","省流策略等待设备首次解锁。")
        val directory=File(File(context.noBackupFilesDir,namespace),"data-saver")
        val deadline=SystemClock.elapsedRealtime()+1000;var lease=StorageDomainLease.acquire(directory)
        while(lease==null&&SystemClock.elapsedRealtime()<deadline){Thread.sleep(10);lease=StorageDomainLease.acquire(directory)}
        if(lease==null)fail("DATA_SAVER_BUSY","省流策略正在提交，请稍后核验。")
        lease.use{
            try{
                // Independent initialization fact survives loss of the policy directory itself.
                val marker=File(directory.parentFile,"data-saver-initialized");val path=File(directory,"policy.sqlite")
                if(marker.exists()&&!path.exists())fail("DATA_SAVER_STORAGE_LOST","省流策略存储缺失，不能默认关闭保护。")
                val db=(helper?:PolicyDatabase(context,path.absolutePath).also{helper=it}).writableDatabase
                if(!marker.exists()){FileOutputStream(marker).use{it.write("1\n".toByteArray());it.fd.sync()};syncDirectory(directory);syncDirectory(directory.parentFile!!);syncDirectory(context.noBackupFilesDir)}
                db.beginTransactionNonExclusive()
                try{val network=currentNetwork?.invoke()?:supplied;val value=action(db,network);db.setTransactionSuccessful();value}finally{db.endTransaction()}
            }catch(error:NativeInputException){throw error}
            catch(_:Exception){fail("DATA_SAVER_STORAGE_FAILED","省流策略无法核验，保留记录且不下发受控操作。")}
        }
    }
    override fun close()=synchronized(this){helper?.close();helper=null;closed=true}
    private class PolicyDatabase(context:Context,path:String):SQLiteOpenHelper(context,path,null,1,
        DatabaseErrorHandler{throw NativeInputException("DATA_SAVER_STORAGE_CORRUPT","省流存储损坏，已保留，不能默认放行。")} ){
        init{setWriteAheadLoggingEnabled(true)}
        override fun onConfigure(db:SQLiteDatabase){db.execPerConnectionSQL("PRAGMA synchronous=FULL",null)}
        override fun onCreate(db:SQLiteDatabase){
            db.execSQL("CREATE TABLE policy(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL,period INTEGER NOT NULL,network TEXT NOT NULL)")
            db.execSQL("INSERT INTO policy VALUES(1,0,0,0,'')")
            db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,data TEXT NOT NULL)")
        }
        override fun onOpen(db:SQLiteDatabase){for((name,expected) in listOf("journal_mode" to "wal","synchronous" to "2")){
            val actual=db.rawQuery("PRAGMA $name",null).use{it.moveToFirst();it.getString(0)}
            if(actual!=expected)throw NativeInputException("DATA_SAVER_STORAGE_POLICY","省流耐久参数未满足。")
        }}
        override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){throw NativeInputException("DATA_SAVER_INCOMPATIBLE","省流策略版本不兼容，保留原记录。")}
        override fun onDowngrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int)=onUpgrade(db,oldVersion,newVersion)
    }
    companion object {
        private fun fail(code:String,message:String):Nothing=throw NativeInputException(code,message)
        private fun validateId(id:String){if(!id.matches(Regex("[A-Za-z0-9_-]{1,128}")))fail("DATA_SAVER_INVALID","执行身份无效。")}
        private fun syncDirectory(directory:File){val fd=Os.open(directory.absolutePath,OsConstants.O_RDONLY,0);try{Os.fsync(fd)}finally{Os.close(fd)}}
    }
}
