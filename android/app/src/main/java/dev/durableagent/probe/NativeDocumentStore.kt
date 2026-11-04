package dev.durableagent.probe

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.UserManager
import android.provider.DocumentsContract
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

class NativeDocumentException(val code:String,message:String):RuntimeException(message,null,false,false)

/** Original document capabilities, separate from immutable attachment representations. */
class NativeDocumentStore(context:Context,private val namespace:String="document-v1"):AutoCloseable {
    private val context=context.applicationContext
    private val resolver=this.context.contentResolver
    private var helper:DocumentDatabase?=null
    private var closed=false
    init { require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}"))) }
    fun select(uri:Uri,resultFlags:Int):JSONObject {
        if(uri.scheme!="content"||!DocumentsContract.isDocumentUri(context,uri))fail("DOCUMENT_INVALID","请选择系统文档提供者中的原文件。")
        requireGrant(uri,READ)
        val flags=resultFlags and (READ or WRITE)
        if(flags and READ==0)fail("DOCUMENT_PERMISSION_REQUIRED","系统尚未授予此原文件的读取权限。")
        if(resultFlags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION!=0){
            try{resolver.takePersistableUriPermission(uri,flags)}
            catch(_:SecurityException){/* Current grant may still be usable; persisted flags below tell the truth. */}
        }
        val id=NativeInputStore.sha256(uri.toString().toByteArray(Charsets.UTF_8))
        val record=current(JSONObject().put("protocol",1).put("resourceId",id).put("namespace","saf:$id").put("source","saf").put("original",true).put("uri",uri.toString()))
        if(record.optString("availability")!="available")fail(record.optString("reasonCode","DOCUMENT_UNAVAILABLE"),record.optString("reason","原文件暂不可用。"))
        locked {db->db.beginTransaction();try{
            db.execSQL("INSERT INTO resources(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",arrayOf(id,record.toString()))
            db.setTransactionSuccessful()
        }finally{db.endTransaction()}}
        return record
    }
    fun list():JSONObject {
        val records=locked{db->db.rawQuery("SELECT record FROM resources ORDER BY id",null).use{cursor->buildList{while(cursor.moveToNext())add(JSONObject(cursor.getString(0)))}}}
        return JSONObject().put("resources",JSONArray(records.map(::current)))
    }
    fun describe(resourceId:String):JSONObject = current(resource(resourceId))
    fun read(resourceId:String,offset:Long,maxBytes:Int):JSONObject {
        if(offset !in 0..MAX_CONTENT||maxBytes !in 1..32768)fail("DOCUMENT_INVALID","原文件读取范围无效。")
        val record=resource(resourceId);val uri=Uri.parse(record.getString("uri"));requireGrant(uri,READ)
        return originalIo {
            val descriptor=resolver.openFileDescriptor(uri,"r")?:fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")
            ParcelFileDescriptor.AutoCloseInputStream(descriptor).use{input->
                input.channel.position(offset)
                val bytes=ByteArray(maxBytes);var count=0
                while(count<bytes.size){val read=input.read(bytes,count,bytes.size-count);if(read<0)break;count+=read}
                JSONObject().put("resourceId",resourceId).put("offset",offset).put("base64",Base64.encodeToString(bytes.copyOf(count),Base64.NO_WRAP))
                    .put("bytesRead",count).put("eof",count<maxBytes||input.read()<0).put("original",true)
            }
        }
    }
    private fun resource(id:String):JSONObject {
        if(!id.matches(Regex("[a-f0-9]{64}")))fail("DOCUMENT_INVALID","原文件标识无效。")
        return locked{db->db.rawQuery("SELECT record FROM resources WHERE id=?",arrayOf(id)).use{if(!it.moveToFirst())fail("DOCUMENT_NOT_FOUND","未登记此原文件。");JSONObject(it.getString(0))}}
    }
    private fun current(record:JSONObject):JSONObject {
        val value=JSONObject(record.toString());val uri=Uri.parse(value.getString("uri"))
        val persisted=resolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        val readable=granted(uri,READ);val writable=granted(uri,WRITE)
        value.put("grant",JSONObject().put("read",readable).put("write",writable).put("persistedRead",persisted?.isReadPermission==true).put("persistedWrite",persisted?.isWritePermission==true))
        try{
            if(!readable)fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")
            originalIo{
                resolver.query(uri,arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED),null,null,null)?.use{cursor->
                    if(!cursor.moveToFirst())fail("DOCUMENT_NOT_FOUND","原文件已移动、删除或无法定位。")
                    fun text(column:String,fallback:String):String {val index=cursor.getColumnIndex(column);return if(index>=0&&!cursor.isNull(index))cursor.getString(index).take(300)else fallback}
                    fun number(column:String):Long? {val index=cursor.getColumnIndex(column);return if(index>=0&&!cursor.isNull(index))cursor.getLong(index)else null}
                    value.put("displayName",text(DocumentsContract.Document.COLUMN_DISPLAY_NAME,"原文件")).put("mimeType",text(DocumentsContract.Document.COLUMN_MIME_TYPE,"application/octet-stream"))
                    value.put("providerFlags",number(DocumentsContract.Document.COLUMN_FLAGS)?:0)
                    number(DocumentsContract.Document.COLUMN_SIZE)?.let{value.put("byteLength",it)}
                    number(DocumentsContract.Document.COLUMN_LAST_MODIFIED)?.let{value.put("lastModified",it)}
                }?:fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")
            }
            value.put("provider",uri.authority).put("availability","available")
            value.remove("reasonCode");value.remove("reason")
        }catch(error:NativeDocumentException){value.put("availability",when(error.code){"DOCUMENT_PERMISSION_REQUIRED"->"permission_required";"DOCUMENT_NOT_FOUND"->"not_found";else->"unavailable"}).put("reasonCode",error.code).put("reason",error.message)}
        return value
    }
    private fun granted(uri:Uri,flag:Int)=context.checkUriPermission(uri,Process.myPid(),Process.myUid(),flag)==PackageManager.PERMISSION_GRANTED
    private fun requireGrant(uri:Uri,flag:Int){if(!granted(uri,flag))fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")}
    private fun <T> originalIo(action:()->T):T=try{action()}
        catch(error:NativeDocumentException){throw error}
        catch(_:SecurityException){fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")}
        catch(_:FileNotFoundException){fail("DOCUMENT_NOT_FOUND","原文件已移动、删除或无法定位。")}
        catch(_:IOException){fail("DOCUMENT_UNAVAILABLE","原文件存储暂不可用，未使用缓存冒充原件。")}
        catch(_:RuntimeException){fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")}
    private fun <T> locked(action:(SQLiteDatabase)->T):T=synchronized(monitor){
        if(closed)fail("DOCUMENT_STORE_CLOSED","原文件记录已关闭，请重新连接。")
        if(!context.getSystemService(UserManager::class.java).isUserUnlocked)fail("DOCUMENT_WAITING_UNLOCK","请在开机后先解锁设备。")
        val directory=File(context.noBackupFilesDir,namespace)
        val lease=StorageDomainLease.acquire(directory)?:fail("DOCUMENT_STORAGE_BUSY","原文件记录正在提交，请稍后重试。")
        try{lease.use{val database=helper?:DocumentDatabase(context,File(directory,"documents.sqlite").absolutePath).also{helper=it};action(database.writableDatabase)}}
        catch(error:NativeDocumentException){throw error}
        catch(_:SQLiteException){fail("DOCUMENT_STORAGE_FAILED","原文件记录无法保存或读取，原记录已保留。")}
    }
    override fun close()=synchronized(monitor){closed=true;helper?.close();helper=null}
    private class DocumentDatabase(context:Context,path:String):SQLiteOpenHelper(context,path,null,1,DatabaseErrorHandler{throw NativeDocumentException("DOCUMENT_STORAGE_CORRUPT","原文件记录损坏，已保留原库。")}){
        init{setWriteAheadLoggingEnabled(true)}
        override fun onConfigure(db:SQLiteDatabase){db.execSQL("PRAGMA synchronous=FULL")}
        override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE resources(id TEXT PRIMARY KEY,record TEXT NOT NULL)")}
        override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){fail("DOCUMENT_STORAGE_INCOMPATIBLE","原文件记录版本不兼容，已保留原库。")}
        override fun onDowngrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){fail("DOCUMENT_STORAGE_INCOMPATIBLE","原文件记录来自更新版本，已保留原库。")}
    }
    companion object {
        private val monitor=Any()
        private const val READ=Intent.FLAG_GRANT_READ_URI_PERMISSION
        private const val WRITE=Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        const val MAX_CONTENT=64L*1024*1024
        private fun fail(code:String,message:String):Nothing=throw NativeDocumentException(code,message)
    }
}
