package dev.durableagent.probe

import android.database.sqlite.SQLiteDatabase
import android.system.Os
import android.system.OsConstants
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Called only under the input metadata OS lease. Holds and quarantine share that authority. */
internal object NativeContentRetention {
    fun createSchema(db:SQLiteDatabase) {
        db.execSQL("CREATE TABLE content_holds(owner_id TEXT NOT NULL,object_id TEXT NOT NULL,fingerprint TEXT NOT NULL,input_token TEXT,PRIMARY KEY(owner_id,object_id))")
        db.execSQL("CREATE INDEX content_holds_token ON content_holds(input_token)")
        db.execSQL("CREATE TABLE frozen_holds(owner_id TEXT PRIMARY KEY,input_token TEXT NOT NULL REFERENCES frozen(token),digest TEXT NOT NULL)")
        db.execSQL("CREATE TABLE content_quarantine(object_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL)")
    }
    private fun file(directory:File,id:String):File {
        if(!id.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}")))throw NativeInputException("INPUT_INVALID","内容身份无效。")
        return File(File(directory,"objects"),id)
    }
    private fun fingerprint(file:File)=NativeInputStore.sha256(file.readBytes())
    private fun retry():Nothing=throw NativeInputException("INPUT_CONTENT_RETRY","内容已隔离或版本已改变；请重新准备，不得发布未取得持有的引用。")
    fun heldToken(db:SQLiteDatabase,token:String)=db.rawQuery("SELECT 1 FROM frozen_holds WHERE input_token=? UNION SELECT 1 FROM content_holds WHERE input_token=? LIMIT 1",arrayOf(token,token)).use{it.moveToFirst()}
    fun retainToken(db:SQLiteDatabase,owner:String,token:String,digest:String) {
        val previous=db.rawQuery("SELECT input_token,digest FROM frozen_holds WHERE owner_id=?",arrayOf(owner)).use{if(it.moveToFirst())Pair(it.getString(0),it.getString(1))else null}
        if(previous!=null&&previous!=Pair(token,digest))throw NativeInputException("INPUT_HOLD_CONFLICT","同一持有身份不能改用不同的固定输入。")
        db.execSQL("INSERT OR IGNORE INTO frozen_holds(owner_id,input_token,digest) VALUES(?,?,?)",arrayOf(owner,token,digest))
    }
    fun protected(db:SQLiteDatabase):MutableSet<String> {
        val result=mutableSetOf<String>()
        db.rawQuery("SELECT object_id FROM frozen_objects UNION SELECT object_id FROM content_holds",null).use{while(it.moveToNext())result.add(it.getString(0))}
        db.rawQuery("SELECT selection_ids FROM drafts",null).use{drafts->while(drafts.moveToNext()){
            val ids=JSONArray(drafts.getString(0));for(index in 0 until ids.length())db.rawQuery("SELECT object_id FROM selections WHERE id=?",arrayOf(ids.getString(index))).use{if(it.moveToFirst()&&!it.isNull(0))result.add(it.getString(0))}
        }}
        return result
    }
    fun retain(db:SQLiteDatabase,directory:File,owner:String,id:String,expected:String,token:String?=null) {
        if(owner.isBlank()||owner.length>200||!expected.matches(Regex("[a-f0-9]{64}")))throw NativeInputException("INPUT_INVALID","持有身份或内容摘要无效。")
        if(db.rawQuery("SELECT 1 FROM content_quarantine WHERE object_id=?",arrayOf(id)).use{it.moveToFirst()})retry()
        val objectFile=file(directory,id);if(!objectFile.isFile||fingerprint(objectFile)!=expected)retry()
        val previous=db.rawQuery("SELECT fingerprint,input_token FROM content_holds WHERE owner_id=? AND object_id=?",arrayOf(owner,id)).use{if(it.moveToFirst())Pair(it.getString(0),if(it.isNull(1))null else it.getString(1))else null}
        if(previous!=null&&(previous.first!=expected||previous.second!=token))throw NativeInputException("INPUT_HOLD_CONFLICT","同一持有身份不能改用不同的内容版本。")
        db.execSQL("INSERT OR IGNORE INTO content_holds(owner_id,object_id,fingerprint,input_token) VALUES(?,?,?,?)",arrayOf(owner,id,expected,token))
    }
    fun read(db:SQLiteDatabase,directory:File,owner:String,id:String):ByteArray {
        val expected=db.rawQuery("SELECT fingerprint FROM content_holds WHERE owner_id=? AND object_id=?",arrayOf(owner,id)).use{if(it.moveToFirst())it.getString(0)else null}?:throw NativeInputException("INPUT_NOT_FOUND","此所有者未持有该内容。")
        val bytes=file(directory,id).readBytes();if(NativeInputStore.sha256(bytes)!=expected)throw NativeInputException("INPUT_CONTENT_CORRUPT","所持有的内容校验失败，已保留原材料。")
        return bytes
    }
    fun scan(db:SQLiteDatabase,directory:File):JSONObject {
        val held=protected(db);val candidates=JSONArray()
        for(item in File(directory,"objects").listFiles()?:emptyArray())if(item.isFile&&item.name !in held){
            val quarantined=db.rawQuery("SELECT fingerprint FROM content_quarantine WHERE object_id=?",arrayOf(item.name)).use{if(it.moveToFirst())it.getString(0)else null}
            candidates.put(JSONObject().put("objectId",item.name).put("fingerprint",quarantined?:fingerprint(item)))
        }
        // A prior process may have deleted bytes before deleting its quarantine row.
        db.rawQuery("SELECT object_id,fingerprint FROM content_quarantine",null).use{while(it.moveToNext())if(!file(directory,it.getString(0)).exists())candidates.put(JSONObject().put("objectId",it.getString(0)).put("fingerprint",it.getString(1)))}
        return JSONObject().put("candidates",candidates).put("protected",held.size)
    }
    /** Quarantine is a committed fact before unlink. Process death never makes a missing file acquirable. */
    fun reclaim(db:SQLiteDatabase,directory:File,candidate:JSONObject,boundary:(String)->Unit):JSONObject {
        val id=candidate.getString("objectId");val expected=candidate.getString("fingerprint");val objectFile=file(directory,id)
        fun result(state:String)=JSONObject().put("objectId",id).put("state",state)
        if(id in protected(db))return result("held")
        val quarantine=db.rawQuery("SELECT fingerprint FROM content_quarantine WHERE object_id=?",arrayOf(id)).use{if(it.moveToFirst())it.getString(0)else null}
        if(quarantine!=null&&quarantine!=expected||objectFile.exists()&&fingerprint(objectFile)!=expected)return result("changed")
        if(quarantine==null&&!objectFile.exists())return result("absent")
        transaction(db){db.execSQL("INSERT OR IGNORE INTO content_quarantine(object_id,fingerprint) VALUES(?,?)",arrayOf(id,expected))}
        boundary("retention.quarantined")
        if(id in protected(db))return result("held")
        if(objectFile.exists()&&!objectFile.delete())throw NativeInputException("INPUT_STORAGE_FAILED","无法回收已隔离的无引用内容，请检查可用空间；必要材料仍保留。")
        syncDirectory(objectFile.parentFile!!)
        boundary("retention.unlinked")
        transaction(db){db.execSQL("DELETE FROM objects WHERE id=?",arrayOf(id));db.execSQL("DELETE FROM content_quarantine WHERE object_id=?",arrayOf(id))}
        return result("reclaimed")
    }
    private fun <T> transaction(db:SQLiteDatabase,run:()->T):T {db.beginTransaction();try{return run().also{db.setTransactionSuccessful()}}finally{db.endTransaction()}}
    private fun syncDirectory(directory:File){val fd=Os.open(directory.absolutePath,OsConstants.O_RDONLY,0);try{Os.fsync(fd)}finally{Os.close(fd)}}
}
