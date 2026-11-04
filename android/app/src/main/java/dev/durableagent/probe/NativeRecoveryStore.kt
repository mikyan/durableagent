package dev.durableagent.probe

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.UserManager
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/** Native recovery metadata only. Never opens SDK SQLite or creates a model/tool task. */
class NativeRecoveryStore(context:Context,namespace:String):AutoCloseable {
    private val context=context.applicationContext
    private val directory=File(context.noBackupFilesDir,"recovery-$namespace")
    private val path=File(directory,"recovery.sqlite")
    private val established=File(directory,"established")
    private var helper:Database?=null
    private var closed=false
    init{require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}")))}
    fun wake(value:JSONObject):JSONObject {
        require(value.opt("active") is Boolean)
        val fixed=JSONObject().put("active",value.getBoolean("active"))
        if(value.has("at")){val at=value.getLong("at");require(at>=0&&value.getDouble("at")==at.toDouble());fixed.put("at",at)}
        return access{db->put(db,"wake",fixed);fixed}
    }
    fun readWake():JSONObject=access{get(it,"wake")?:JSONObject().put("active",false)}
    fun projection(value:JSONObject):Unit=access{put(it,"projection",value)}
    fun readProjection():JSONObject=access{get(it,"projection")?:JSONObject().put("conversations",org.json.JSONArray()).put("completions",org.json.JSONArray())}
    fun hostState(value:JSONObject):Unit=access{put(it,"host",value)}
    fun readHostState():JSONObject=access{get(it,"host")?:JSONObject().put("background","unknown").put("foreground",false)}
    /** Claim only an external-condition observation, never a model attempt or effect dispatch. */
    fun probe(workId:String,now:Long):JSONObject {
        identity(workId);require(now>=0)
        return access{db->transaction(db){
            val row=db.rawQuery("SELECT used,next_at FROM probes WHERE work_id=?",arrayOf(workId)).use{if(it.moveToFirst())it.getInt(0) to it.getLong(1) else 0 to 0L}
            val allowed=row.first<5&&now>=row.second
            val used=if(allowed)row.first+1 else row.first
            val at=if(allowed)now+(1000L shl(used-1)) else row.second
            if(allowed)db.execSQL("INSERT INTO probes(work_id,used,next_at) VALUES(?,?,?) ON CONFLICT(work_id) DO UPDATE SET used=excluded.used,next_at=excluded.next_at",arrayOf<Any>(workId,used,at))
            JSONObject().put("allowed",allowed).put("used",used).put("at",at).put("exhausted",used>=5)
        }}
    }
    fun pendingCompletion(identity:String,conversationId:String):JSONObject {
        identity(identity);identity(conversationId)
        return access{db->transaction(db){
            val prior=db.rawQuery("SELECT conversation_id,published FROM completions WHERE identity=?",arrayOf(identity)).use{if(it.moveToFirst())it.getString(0) to it.getInt(1) else null}
            require(prior==null||prior.first==conversationId){"Completion identity changed conversation"}
            if(prior==null)db.execSQL("INSERT INTO completions(identity,conversation_id,published) VALUES(?,?,0)",arrayOf(identity,conversationId))
            JSONObject().put("identity",identity).put("conversationId",conversationId).put("state",when(prior?.second){1->"published";2->"attempted";else->"pending"})
        }}
    }
    fun completeNotification(identity:String):Unit {identity(identity);access{db->db.execSQL("UPDATE completions SET published=1 WHERE identity=?",arrayOf(identity))}}
    /** One durable system delivery attempt. A host lost after this commit cannot repeat a dismissed alert. */
    fun claimNotification(identity:String):Boolean {identity(identity);return access{db->transaction(db){db.update("completions",android.content.ContentValues().apply{put("published",2)},"identity=? AND published=0",arrayOf(identity))==1}}}
    fun notificationFailure(reason:String):Unit=access{put(it,"notification-failure",JSONObject().put("reason",reason.take(120)))}
    fun notificationState():JSONObject=access{db->JSONObject().put("unconfirmed",db.rawQuery("SELECT COUNT(*) FROM completions WHERE published=2",null).use{it.moveToFirst();it.getLong(0)}).apply{get(db,"notification-failure")?.optString("reason")?.let{put("reason",it)}}}
    private fun identity(value:String){require(value.length in 1..256&&value.none{it.code<32})}
    private fun put(db:SQLiteDatabase,key:String,value:JSONObject){db.execSQL("INSERT INTO metadata(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",arrayOf(key,value.toString()))}
    private fun get(db:SQLiteDatabase,key:String):JSONObject?=db.rawQuery("SELECT data FROM metadata WHERE key=?",arrayOf(key)).use{if(it.moveToFirst())JSONObject(it.getString(0))else null}
    private fun <T> transaction(db:SQLiteDatabase,action:()->T):T {db.beginTransaction();try{val value=action();db.setTransactionSuccessful();return value}finally{db.endTransaction()}}
    @Synchronized private fun <T> access(action:(SQLiteDatabase)->T):T {
        check(!closed){"RECOVERY_STORAGE_CLOSED"}
        check(context.getSystemService(UserManager::class.java).isUserUnlocked){"RECOVERY_WAITING_UNLOCK"}
        val lease=StorageDomainLease.acquire(File(directory,"native-owner"))?:error("RECOVERY_STORAGE_BUSY")
        lease.use{
            check(!established.exists()||path.exists()){ "RECOVERY_STORAGE_LOST" }
            val db=(helper?:Database().also{helper=it}).writableDatabase
            if(!established.exists())FileOutputStream(established).use{it.write(byteArrayOf(1));it.fd.sync()}
            return action(db)
        }
    }
    @Synchronized override fun close(){if(!closed){closed=true;helper?.close();helper=null}}
    private inner class Database:SQLiteOpenHelper(context,path.absolutePath,null,1,DatabaseErrorHandler{throw IllegalStateException("RECOVERY_STORAGE_CORRUPT")}) {
        override fun onConfigure(db:SQLiteDatabase){db.execSQL("PRAGMA synchronous=FULL");db.rawQuery("PRAGMA busy_timeout=1000",null).use{it.moveToFirst()}}
        override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE metadata(key TEXT PRIMARY KEY,data TEXT NOT NULL)");db.execSQL("CREATE TABLE probes(work_id TEXT PRIMARY KEY,used INTEGER NOT NULL,next_at INTEGER NOT NULL)");db.execSQL("CREATE TABLE completions(identity TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,published INTEGER NOT NULL)")}
        override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int){error("RECOVERY_STORAGE_VERSION_UNSUPPORTED")}
        override fun onDowngrade(db:SQLiteDatabase,old:Int,new:Int){error("RECOVERY_STORAGE_VERSION_UNSUPPORTED")}
    }
}
