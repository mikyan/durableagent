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
import android.os.SystemClock
import android.os.UserManager
import android.provider.DocumentsContract
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID

class NativeDocumentException(val code:String,message:String):RuntimeException(message,null,false,false)

/** Original document capabilities, separate from immutable attachment representations. */
class NativeDocumentStore @JvmOverloads constructor(context:Context,private val namespace:String="document-v1",private val inputNamespace:String="input-v1",private val networkSource:(()->DataSaverNetwork)?=null,private val beforePolicyResultCommit:(()->Unit)?=null):AutoCloseable {
    private val context=context.applicationContext
    private val resolver=this.context.contentResolver
    private var helper:DocumentDatabase?=null
    @Volatile private var closed=false
    private data class Reader(val resourceId:String,val uri:Uri,val input:ParcelFileDescriptor.AutoCloseInputStream,val digest:String,val length:Long)
    private val readers=mutableMapOf<String,Reader>()
    init { require(namespace.matches(Regex("[a-zA-Z0-9._-]{1,100}"))) }
    fun select(uri:Uri,resultFlags:Int):JSONObject {
        if(uri.scheme!="content"||uri.toString().length>4096||!DocumentsContract.isDocumentUri(context,uri))fail("DOCUMENT_INVALID","请选择具有受支持位置长度的系统文档原文件。")
        requireGrant(uri,READ)
        val flags=resultFlags and (READ or WRITE)
        if(flags and READ==0)fail("DOCUMENT_PERMISSION_REQUIRED","系统尚未授予此原文件的读取权限。")
        if(resultFlags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION!=0){
            try{resolver.takePersistableUriPermission(uri,flags)}
            catch(_:SecurityException){/* Current grant may still be usable; persisted flags below tell the truth. */}
        }
        val id=NativeInputStore.sha256(uri.toString().toByteArray(Charsets.UTF_8))
        val record=JSONObject().put("protocol",1).put("resourceId",id).put("namespace","saf:$id").put("source","saf").put("original",true).put("uri",uri.toString()).put("displayName","原文件").put("mimeType","application/octet-stream").put("providerFlags",0).put("networkAccess","unknown").put("availability","unavailable").put("freshness","not-observed").put("reason","尚未访问原件提供者。")
        locked {db->db.beginTransaction();try{
            db.execSQL("INSERT INTO resources(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",arrayOf(id,record.toString()))
            db.setTransactionSuccessful()
        }finally{db.endTransaction()}}
        return observeMetadata(id,UUID.randomUUID().toString())
    }
    @JvmOverloads fun list(cursor:String?=null):JSONObject {
        if(cursor!=null&&!cursor.matches(Regex("[a-f0-9]{64}")))fail("DOCUMENT_INVALID","原文件列表游标无效。")
        val records=locked{db->db.rawQuery("SELECT record FROM resources WHERE id>? ORDER BY id LIMIT 21",arrayOf(cursor?:"")).use{rows->buildList{while(rows.moveToNext())add(JSONObject(rows.getString(0)))}}}
        val values=JSONArray();var bytes=0;var count=0;var last:String?=null
        for(record in records){
            if(count==20)break
            val value=cached(record);val length=value.toString().toByteArray(Charsets.UTF_8).size
            if(bytes+length>60000){if(count==0)fail("DOCUMENT_FRAME_LIMIT","此原文件记录过大，无法放入列表响应。");break}
            values.put(value);bytes+=length;count++;last=value.getString("resourceId")
        }
        return JSONObject().put("resources",values).put("nextCursor",if(count<records.size)last else JSONObject.NULL)
    }
    fun cachedResource(resourceId:String):JSONObject=cached(resource(resourceId))
    private fun cached(record:JSONObject):JSONObject{
        val result=grants(JSONObject(record.toString())).put("freshness","cached")
        record.optJSONObject("observation")?.let{observation->NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->result.put("observation",policy.status(observation.getString("executionId")))}}
        return result
    }
    private fun grants(record:JSONObject):JSONObject{
        val uri=Uri.parse(record.getString("uri"));val persisted=resolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        return record.put("grant",JSONObject().put("read",granted(uri,READ)).put("write",granted(uri,WRITE)).put("persistedRead",persisted?.isReadPermission==true).put("persistedWrite",persisted?.isWritePermission==true))
    }
    private fun saveResource(record:JSONObject){locked{db->db.execSQL("UPDATE resources SET record=? WHERE id=?",arrayOf(record.toString(),record.getString("resourceId")))}}
    private fun metadataDescriptor(record:JSONObject)=JSONObject().put("kind","metadata").put("documentNamespace",namespace).put("uri",record.getString("uri"))
    private fun observeMetadata(resourceId:String,id:String):JSONObject{
        val original=resource(resourceId)
        return NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            val decision=policy.prepare(id,metadataDescriptor(original))
            val pending=grants(JSONObject(original.toString())).put("observation",decision)
            saveResource(pending)
            try{
                val result=policy.execute(id){current(original).put("observedAt",System.currentTimeMillis()).put("freshness","observed")}
                result.put("observation",policy.status(id));saveResource(result);result
            }catch(error:NativeInputException){
                if(error.code !in setOf("DATA_SAVER_WAIT","DATA_SAVER_INTERRUPTED","DATA_SAVER_RESULT_UNVERIFIED","DATA_SAVER_OPERATION_BUSY"))throw error
                pending.put("observation",policy.status(id)).put("reason",error.message).put("reasonCode",error.code)
                if(!pending.has("observedAt"))pending.put("freshness","not-observed")else pending.put("freshness","cached")
                saveResource(pending);pending
            }
        }
    }
    private fun snapshotFile(id:String):File=File(File(File(context.noBackupFilesDir,namespace),"observations"),NativeInputStore.sha256(id.toByteArray(Charsets.UTF_8))+".bin")
    fun observeRead(request:JSONObject):JSONObject{
        val id=operationId(request);val resourceId=digest(request,"resourceId");val owner=request.getJSONObject("owner");identifier(owner,"productId");integer(owner,"controlGeneration",1,9_007_199_254_740_991L);integer(owner,"sdkConversationId",1,9_007_199_254_740_991L)
        val original=resource(resourceId);val descriptor=JSONObject().put("kind","read").put("documentNamespace",namespace).put("uri",original.getString("uri")).put("owner",JSONObject(owner.toString()))
        return NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            policy.prepare(id,descriptor)
            try{
                val result=policy.execute(id){
                    val metadata=current(original).put("freshness","observed").put("observedAt",System.currentTimeMillis())
                    val opened=open(resourceId);val readerId=opened.getString("readerId");var closedReader=false
                    try{
                        val length=opened.getLong("byteLength");if(length>16L*1024*1024)fail("DOCUMENT_BUDGET_EXCEEDED","此固定观察超过 16 MiB，未声称读取完整原件。")
                        val target=snapshotFile(id);check(target.parentFile!!.mkdirs()||target.parentFile!!.isDirectory);val temporary=File(target.parentFile,target.name+".pending")
                        java.io.FileOutputStream(temporary).use{output->var offset=0L;while(offset<length){val page=readReader(readerId,offset,32768);val bytes=Base64.decode(page.getString("base64"),Base64.DEFAULT);if(bytes.isEmpty())fail("DOCUMENT_READ_UNSTABLE","原件在固定观察期间变短。");output.write(bytes);offset+=bytes.size};output.fd.sync()}
                        val verified=closeRead(readerId);closedReader=true
                        if(!verified.getBoolean("unchanged")||temporary.length()!=length||hashFile(temporary)!=opened.getString("contentDigest"))fail("DOCUMENT_READ_UNSTABLE","原件在固定观察期间变化，未使用部分内容。")
                        android.system.Os.rename(temporary.absolutePath,target.absolutePath)
                        for(directory in listOf(target.parentFile!!,target.parentFile!!.parentFile!!)){val fd=android.system.Os.open(directory.absolutePath,android.system.OsConstants.O_RDONLY,0);try{android.system.Os.fsync(fd)}finally{android.system.Os.close(fd)}}
                        JSONObject().put("snapshotId",id).put("resource",metadata).put("contentDigest",opened.getString("contentDigest")).put("byteLength",length).put("observedAt",metadata.getLong("observedAt"))
                    }finally{if(!closedReader)runCatching{closeRead(readerId)}}
                }
                val file=snapshotFile(id);if(!file.isFile||file.length()!=result.getLong("byteLength")||hashFile(file)!=result.getString("contentDigest"))throw NativeInputException("DATA_SAVER_RESULT_UNVERIFIED","固定原件观察内容无法核验，未重新访问提供者。")
                JSONObject().put("observation",policy.status(id)).put("snapshot",result)
            }catch(error:NativeInputException){
                if(error.code !in setOf("DATA_SAVER_WAIT","DATA_SAVER_OPERATION_BUSY","DATA_SAVER_RESULT_UNVERIFIED","DATA_SAVER_INTERRUPTED"))throw error
                JSONObject().put("observation",policy.status(id))
            }
        }
    }
    fun readSnapshot(request:JSONObject):JSONObject{
        val id=operationId(request);val offset=integer(request,"offset",0,16L*1024*1024);val max=integer(request,"maxBytes",1,32768).toInt()
        val result=NativeProviderPolicy(context,inputNamespace,networkSource).use{it.result(id)}
        requireGrant(Uri.parse(result.getJSONObject("resource").getString("uri")),READ)
        val file=snapshotFile(id);val length=result.getLong("byteLength");if(!file.isFile||file.length()!=length||offset>length)throw NativeInputException("DATA_SAVER_RESULT_UNVERIFIED","固定原件观察内容无法核验，未重新访问提供者。")
        val bytes=ByteArray(minOf(max.toLong(),length-offset).toInt());RandomAccessFile(file,"r").use{it.seek(offset);it.readFully(bytes)}
        return JSONObject().put("offset",offset).put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("bytesRead",bytes.size).put("eof",offset+bytes.size==length)
    }
    fun resumeObservation(resourceId:String,operationId:String,digest:String,period:Long):JSONObject{
        NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            val decision=policy.prepare(operationId,metadataDescriptor(resource(resourceId)))
            if(decision.getString("requestDigest")!=digest)throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","此许可不属于同一次原文件观察。")
            if(!decision.optBoolean("terminal"))policy.grant(operationId,digest,period)
        }
        return observeMetadata(resourceId,operationId)
    }
    fun describe(resourceId:String):JSONObject=observeMetadata(resourceId,UUID.randomUUID().toString())
    private fun verificationDescriptor(fixed:JSONObject)=JSONObject().put("kind","verify").put("documentNamespace",namespace).put("uri",fixed.getString("uri"))
        .put("originalOperationId",fixed.getString("operationId")).put("documentRequestDigest",fixed.getString("requestDigest"))
    fun resumeVerification(operationId:String,observationId:String,digest:String,period:Long):JSONObject {
        NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            val prepared=policy.prepare(observationId,verificationDescriptor(query(operationId)))
            if(prepared.getString("requestDigest")!=digest)throw NativeInputException("DATA_SAVER_IDENTITY_CONFLICT","此许可不属于同一次原件核验。")
            if(!prepared.optBoolean("terminal"))policy.grant(observationId,digest,period)
        }
        return verifyObservation(operationId,observationId)
    }
    fun verify(operationId:String):JSONObject=verifyObservation(operationId,UUID.randomUUID().toString())
    private fun verifyObservation(operationId:String,observationId:String):JSONObject {
        val fixed=query(operationId)
        val observation=NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            policy.prepare(observationId,verificationDescriptor(fixed))
            try{policy.execute(observationId){
                val result=try{
                    val opened=open(fixed.getString("resourceId"));val closed=closeRead(opened.getString("readerId"))
                    if(!closed.getBoolean("unchanged"))JSONObject().put("status","changed_during_read").put("reasonCode","DOCUMENT_READ_UNSTABLE")
                    else JSONObject().put("status","read").put("currentDigest",closed.getString("currentDigest")).put("byteLength",closed.getLong("byteLength"))
                        .put("matchesExpected",closed.getString("currentDigest")==fixed.getString("expectedDigest"))
                        .put("matchesContent",closed.getString("currentDigest")==fixed.getString("contentDigest"))
                }catch(error:NativeDocumentException){JSONObject().put("status","unavailable").put("reasonCode",error.code)}
                result.put("observedAt",System.currentTimeMillis())
            }.put("observation",policy.status(observationId))}
            catch(error:NativeInputException){
                if(error.code !in setOf("DATA_SAVER_WAIT","DATA_SAVER_INTERRUPTED","DATA_SAVER_OPERATION_BUSY","DATA_SAVER_RESULT_UNVERIFIED"))throw error
                JSONObject().put("status",if(error.code=="DATA_SAVER_WAIT")"waiting" else "result-unverified").put("reasonCode",error.code).put("observation",policy.status(observationId))
            }
        }
        // A fixed read observation never changes the original write's scope evidence.
        return query(operationId).put("verification",observation)
    }
    fun cancel(request:JSONObject):JSONObject {
        val id=operationId(request);val requested=digest(request,"requestDigest")
        return locked{db->
            val row=operation(db,id);if(row.getString("requestDigest")!=requested)conflict()
            when(row.getString("state")){
                "accepted_not_started"->transition(db,row,"not_started",true,"DOCUMENT_CANCELLED_BEFORE_START")
                "running"->transition(db,row,"stop_requested",false,"DOCUMENT_CANCEL_UNCONFIRMED")
                else->row
            }
        }
    }
    fun prepare(request:JSONObject):JSONObject {
        val plan=plan(request);val operationId=plan.getString("operationId")
        val digest=NativeInputStore.sha256(plan.toString().toByteArray(Charsets.UTF_8))
        val existing=locked{db->operationOrNull(db,operationId)}
        if(existing!=null){if(existing.getString("requestDigest")!=digest)conflict();return existing}
        val original=cachedResource(plan.getString("resourceId"))
        return locked{db->
            operationOrNull(db,operationId)?.let{if(it.getString("requestDigest")!=digest)conflict();return@locked it}
            val row=JSONObject(plan.toString()).put("protocol",1).put("requestDigest",digest).put("namespace",original.getString("namespace"))
                .put("kind","file").put("source","saf").put("original",true).put("uri",original.getString("uri")).put("displayName",original.getString("displayName"))
                .put("nativeControlNamespace",inputNamespace)
                .put("state","accepted_not_started").put("scopeConfirmed",false).put("sequence",0).put("stagedOffset",0).put("sealed",plan.getLong("byteLength")==0L)
                .put("diff",unavailableDiff("not_completed"))
            // Native stop indexing precedes an acknowledged document plan. A crash between
            // the two stores leaves an indexed unknown intent, never executable missing bytes.
            NativeInputStore(context,inputNamespace).use{inputs->
                var existed=false
                try{inputs.requireEffect(operationId);existed=true}
                catch(error:NativeInputException){if(error.code=="EXECUTION_STOPPED")existed=true else if(error.code!="EXECUTION_UNREGISTERED")throw error}
                try{inputs.registerEffect(effect(row))}
                catch(error:NativeInputException){if(error.code!="EXECUTION_STOPPED")throw error;inputs.adoptEffect(effect(row));row.put("state","not_started").put("scopeConfirmed",true).put("reason","EXECUTION_STOPPED")}
                // A surviving native effect with a missing original receipt may reflect partial
                // recovery. Reconstruct identity for observation, never infer dispatch eligibility.
                if(existed)row.put("state","unknown").put("scopeConfirmed",false).put("reason","DOCUMENT_PLAN_RECOVERY_UNKNOWN")
            }
            saveOperation(db,row);publish(row);row
        }
    }
    fun stage(request:JSONObject):JSONObject {
        val id=operationId(request);val offset=integer(request,"offset",0,MAX_CONTENT)
        val encoded=request.opt("base64") as? String?:fail("DOCUMENT_INVALID","原文件分块格式无效。")
        if(encoded.length>43692)fail("DOCUMENT_FRAME_LIMIT","原文件分块超过 32 KiB。")
        val bytes=try{Base64.decode(encoded,Base64.DEFAULT)}catch(_:IllegalArgumentException){fail("DOCUMENT_INVALID","原文件分块格式无效。")}
        if(bytes.size>32768||Base64.encodeToString(bytes,Base64.NO_WRAP)!=encoded)fail("DOCUMENT_INVALID","原文件分块格式无效。")
        return locked{db->
            val row=operation(db,id);if(row.getString("state")!="accepted_not_started")fail("DOCUMENT_NOT_STAGING","此原文件操作已离开准备阶段。")
            val next=row.getLong("stagedOffset");val total=row.getLong("byteLength")
            if(offset>next||offset+bytes.size>total||bytes.isEmpty()&&total!=0L)fail("DOCUMENT_INVALID","原文件分块范围不连续。")
            RandomAccessFile(stageFile(id),"rw").use{file->
                if(offset<next){
                    if(offset+bytes.size>next)conflict()
                    val previous=ByteArray(bytes.size);file.seek(offset);file.readFully(previous);if(!previous.contentEquals(bytes))conflict()
                }else if(!row.getBoolean("sealed")){
                    file.setLength(next);file.seek(next);file.write(bytes);file.fd.sync()
                    val advanced=next+bytes.size
                    if(advanced==total&&hashFile(stageFile(id))!=row.getString("contentDigest"))fail("DOCUMENT_CONTENT_CONFLICT","暂存内容摘要不符，未改动原文件。")
                    row.put("stagedOffset",advanced).put("sealed",advanced==total).put("sequence",row.getLong("sequence")+1);saveOperation(db,row)
                }
            }
            JSONObject().put("operationId",id).put("nextOffset",row.getLong("stagedOffset")).put("sealed",row.getBoolean("sealed"))
        }
    }
    /** Trusted core already owns the shared environment writer claim. This is no second queue. */
    private fun writeDescriptor(row:JSONObject)=JSONObject().put("kind","write").put("documentNamespace",namespace).put("uri",row.getString("uri"))
        .put("documentRequestDigest",row.getString("requestDigest")).put("expectedDigest",row.getString("expectedDigest")).put("contentDigest",row.getString("contentDigest")).put("byteLength",row.getLong("byteLength"))
        .put("owner",JSONObject().put("productId",row.getString("productId")).put("controlGeneration",row.getLong("controlGeneration")).put("sdkConversationId",row.getLong("sdkConversationId")))
    fun writePolicy(request:JSONObject):JSONObject{
        val row=query(operationId(request));if(row.getString("requestDigest")!=digest(request,"requestDigest")||controlNamespace(row)!=inputNamespace)conflict()
        return NativeProviderPolicy(context,inputNamespace,networkSource).use{policy->
            val id=row.getString("operationId");policy.prepare(id,writeDescriptor(row))
            policy.reconcileWrite(id,row).put("documentRequestDigest",row.getString("requestDigest"))
        }
    }
    fun start(request:JSONObject):JSONObject{
        val row=query(operationId(request));if(row.getString("requestDigest")!=digest(request,"requestDigest")||controlNamespace(row)!=inputNamespace)conflict()
        if(row.getString("state")!="accepted_not_started")return row
        return NativeProviderPolicy(context,inputNamespace,networkSource,beforePolicyResultCommit).use{policy->policy.prepare(row.getString("operationId"),writeDescriptor(row));policy.execute(row.getString("operationId")){startOriginal(request)}}
    }
    private fun startOriginal(request:JSONObject):JSONObject {
        val id=operationId(request);val requested=digest(request,"requestDigest")
        var ownership:StorageDomainLease?=null
        val first=locked{db->
            val row=operation(db,id);if(row.getString("requestDigest")!=requested)conflict()
            if(row.getString("nativeControlNamespace")!=inputNamespace)conflict()
            if(row.getString("state")!="accepted_not_started")return@locked row
            ownership=StorageDomainLease.acquire(operationDirectory(id))
            if(ownership==null)return@locked row
            if(!row.getBoolean("sealed")){ownership?.close();ownership=null;fail("DOCUMENT_NOT_SEALED","原文件内容尚未完整暂存，未开始写入。")}
            row
        }
        val lease=ownership?:return first
        var began=false
        try{return lease.use{
            val file=stageFile(id)
            if(first.getLong("byteLength")==0L&&!file.exists())RandomAccessFile(file,"rw").use{it.fd.sync()}
            if(file.length()!=first.getLong("byteLength")||hashFile(file)!=first.getString("contentDigest"))fail("DOCUMENT_CONTENT_CONFLICT","暂存内容无法核验，未改动原文件。")
            // Read-only preflight rejects a stale expected digest before opening for write.
            val before=open(first.getString("resourceId"))
            val verified=closeRead(before.getString("readerId"))
            if(before.getString("contentDigest")!=first.getString("expectedDigest")||!verified.getBoolean("unchanged"))fail("DOCUMENT_PRECONDITION_CONFLICT","原文件已变化，未覆盖新内容。")
            val capability=current(resource(first.getString("resourceId")))
            if(!capability.getJSONObject("grant").getBoolean("write"))fail("DOCUMENT_PERMISSION_REQUIRED","原文件写入授权已撤销或尚未取得。")
            if(capability.getLong("providerFlags") and DocumentsContract.Document.FLAG_SUPPORTS_WRITE.toLong()==0L)fail("DOCUMENT_UNSUPPORTED","此提供者未声明支持原件写入。")
            val running=locked{db->
                val row=operation(db,id);if(row.getString("state")!="accepted_not_started")return@locked row
                NativeInputStore(context,inputNamespace).use{it.requireEffect(id)}
                transition(db,row,"running",false,null)
            }
            if(running.getString("state")!="running")return@use running
            // Last native generation check immediately precedes the original Provider call.
            NativeInputStore(context,inputNamespace).use{it.requireEffect(id)}
            began=true
            val uri=Uri.parse(first.getString("uri"));var oldBytes:ByteArray?=null
            originalIo(uri){
                val descriptor=resolver.openFileDescriptor(uri,"rw")?:fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")
                descriptor.use{original->
                    ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(original.fileDescriptor)).use{input->
                        val actual=hashOriginal(input)
                        if(actual.first!=first.getString("expectedDigest"))fail("DOCUMENT_PRECONDITION_CONFLICT","原文件在写入前发生变化，未覆盖新内容；提供者操作范围尚待核验。")
                        if(actual.second<=32768){
                            input.channel.position(0);val bytes=ByteArray(actual.second.toInt());var offset=0
                            while(offset<bytes.size){val count=input.read(bytes,offset,bytes.size-offset);if(count<0)fail("DOCUMENT_PRECONDITION_CONFLICT","原文件在写入前发生变化。");offset+=count}
                            if(NativeInputStore.sha256(bytes)!=first.getString("expectedDigest"))fail("DOCUMENT_PRECONDITION_CONFLICT","原文件在写入前发生变化。")
                            oldBytes=bytes
                        }
                    }
                    // A Provider open can block. Recheck both current authorization and the
                    // durable stop fence after it returns, before the first original byte write.
                    requireGrant(uri,WRITE)
                    locked{db->
                        if(operation(db,id).getString("state")!="running")fail("DOCUMENT_CANCEL_UNCONFIRMED","原件写入已请求停止，提供者范围尚待核验。")
                        NativeInputStore(context,inputNamespace).use{it.requireEffect(id)}
                    }
                    NativeProviderPolicy.beforeIo(context,inputNamespace,uri.toString(),networkSource)
                    ParcelFileDescriptor.AutoCloseOutputStream(ParcelFileDescriptor.dup(original.fileDescriptor)).use{output->
                        output.channel.position(0);FileInputStream(file).use{input->val chunk=ByteArray(32768);while(true){NativeProviderPolicy.beforeActiveIo();val count=input.read(chunk);if(count<0)break;output.write(chunk,0,count)}}
                        output.channel.truncate(first.getLong("byteLength"));output.flush();output.fd.sync()
                    }
                }
            }
            val after=open(first.getString("resourceId"));val closed=closeRead(after.getString("readerId"))
            if(after.getString("contentDigest")!=first.getString("contentDigest")||after.getLong("byteLength")!=first.getLong("byteLength")||!closed.getBoolean("unchanged"))fail("DOCUMENT_READBACK_CONFLICT","原件回读与写入内容不符，结果尚未确认。")
            val change=diff(oldBytes,if(file.length()<=32768)file.readBytes()else null)
            locked{db->
                // Completion and actual diff are one durable receipt, not a later UI embellishment.
                val row=operation(db,id).put("diff",change).put("verifiedDigest",after.getString("contentDigest"))
                transition(db,row,"completed",true,null)
            }
        }}catch(error:Exception){
            val code=when(error){is NativeDocumentException->error.code;is NativeInputException->error.code;else->"DOCUMENT_IO_UNCONFIRMED"}
            return locked{db->
                val row=operation(db,id)
                if(terminal(row))row else transition(db,row,if(began)"unknown" else "not_started",!began,code)
            }
        }
    }
    fun query(operationId:String):JSONObject = locked{db->
        val row=operation(db,operationId)
        if(row.getString("state") in setOf("running","stop_requested")){
            StorageDomainLease.acquire(operationDirectory(operationId))?.use{transition(db,row,"unknown",false,"DOCUMENT_HOST_LOST")}
        }else if(row.getString("state")=="accepted_not_started"){
            try{NativeInputStore(context,controlNamespace(row)).use{it.requireEffect(operationId)}}
            catch(error:NativeInputException){if(error.code=="EXECUTION_STOPPED")transition(db,row,"not_started",true,"EXECUTION_STOPPED")else throw error}
        }
        publish(row);row
    }
    private fun effect(row:JSONObject)=JSONObject().put("operationId",row.getString("operationId")).put("productId",row.getString("productId"))
        .put("kind","file").put("source","saf").put("namespace",row.getString("namespace")).put("requestDigest",row.getString("requestDigest"))
        .put("controlGeneration",row.getLong("controlGeneration")).put("sdkConversationId",row.getLong("sdkConversationId"))
    private fun controlNamespace(row:JSONObject)=row.getString("nativeControlNamespace").takeIf{it.matches(Regex("[a-zA-Z0-9._-]{1,100}"))}?:fail("DOCUMENT_STORAGE_CORRUPT","原文件操作的控制关联无效，未重新执行。")
    private fun publish(row:JSONObject){try{NativeInputStore(context,controlNamespace(row)).use{it.recordEffectEvidence(row.getString("operationId"),row)}}catch(_:NativeInputException){/* Durable document receipt remains authoritative; query retries native stop indexing. */}}
    private fun plan(value:JSONObject):JSONObject {
        val plan=JSONObject().put("operationId",operationId(value)).put("resourceId",digest(value,"resourceId")).put("productId",identifier(value,"productId"))
            .put("controlGeneration",integer(value,"controlGeneration",1,9_007_199_254_740_991L)).put("sdkConversationId",integer(value,"sdkConversationId",1,9_007_199_254_740_991L))
            .put("expectedDigest",digest(value,"expectedDigest")).put("contentDigest",digest(value,"contentDigest")).put("byteLength",integer(value,"byteLength",0,MAX_CONTENT))
        if(plan.getLong("byteLength")==0L&&plan.getString("contentDigest")!=NativeInputStore.sha256(byteArrayOf()))fail("DOCUMENT_CONTENT_CONFLICT","空原件内容摘要不符。")
        return plan
    }
    private fun identifier(value:JSONObject,key:String)=(value.opt(key) as? String)?.takeIf{it.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,199}"))}?:fail("DOCUMENT_INVALID","原文件操作身份无效。")
    private fun operationId(value:JSONObject)=identifier(value,"operationId")
    private fun digest(value:JSONObject,key:String)=(value.opt(key) as? String)?.takeIf{it.matches(Regex("[a-f0-9]{64}"))}?:fail("DOCUMENT_INVALID","原文件摘要或资源身份无效。")
    private fun integer(value:JSONObject,key:String,min:Long,max:Long):Long {val number=value.opt(key);if(number !is Number||number.toDouble()!=number.toLong().toDouble()||number.toLong() !in min..max)fail("DOCUMENT_INVALID","原文件操作范围无效。");return number.toLong()}
    private fun operationOrNull(db:SQLiteDatabase,id:String):JSONObject?=db.rawQuery("SELECT record FROM operations WHERE id=?",arrayOf(id)).use{if(it.moveToFirst())JSONObject(it.getString(0)).also{row->row.put("diff",publicDiff(row.optJSONObject("diff")))}else null}
    private fun operation(db:SQLiteDatabase,id:String)=operationOrNull(db,id)?:fail("DOCUMENT_OPERATION_NOT_FOUND","未找到此原文件操作，未重新执行。")
    private fun saveOperation(db:SQLiteDatabase,row:JSONObject){db.beginTransaction();try{
        val id=row.getString("operationId");val encoded=row.toString()
        db.execSQL("INSERT INTO operations(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",arrayOf(id,encoded))
        db.execSQL("INSERT INTO operation_receipts(operation_id,sequence,record) VALUES(?,?,?)",arrayOf(id,row.getLong("sequence"),encoded));db.setTransactionSuccessful()
    }finally{db.endTransaction()}}
    private fun terminal(row:JSONObject)=row.getString("state") in setOf("completed","not_started","stopped")&&row.getBoolean("scopeConfirmed")
    private fun transition(db:SQLiteDatabase,row:JSONObject,state:String,confirmed:Boolean,reason:String?):JSONObject {
        if(terminal(row))return row
        row.put("state",state).put("scopeConfirmed",confirmed).put("sequence",row.getLong("sequence")+1)
        if(reason==null)row.remove("reason")else row.put("reason",reason)
        saveOperation(db,row);publish(row);return row
    }
    private fun stageFile(id:String):File {val directory=File(File(context.noBackupFilesDir,namespace),"staging");if(!directory.mkdirs()&&!directory.isDirectory)fail("DOCUMENT_STORAGE_FAILED","无法保存原文件暂存内容。");return File(directory,NativeInputStore.sha256(id.toByteArray(Charsets.UTF_8))+".bin")}
    private fun operationDirectory(id:String)=File(File(File(context.noBackupFilesDir,namespace),"operations"),NativeInputStore.sha256(id.toByteArray(Charsets.UTF_8)))
    private fun hashFile(file:File):String {val hash=MessageDigest.getInstance("SHA-256");FileInputStream(file).use{input->val bytes=ByteArray(32768);while(true){val count=input.read(bytes);if(count<0)break;hash.update(bytes,0,count)}};return hash.digest().joinToString(""){"%02x".format(it)}}
    private fun conflict():Nothing=fail("DOCUMENT_OPERATION_CONFLICT","此操作身份已绑定不同的原件或内容，未覆盖已有记录。")
    private fun unavailableDiff(reason:String)=JSONObject().put("state","unavailable").put("available",false).put("reason",reason)
    private fun availableDiff(text:String)=JSONObject().put("state","available").put("available",true).put("format","whole-file-lines").put("text",text)
    private fun publicDiff(value:JSONObject?):JSONObject {
        // Earlier v2 receipts used state only. Project their evidence without modifying
        // append-only history or changing operation identity, sequence or scope proof.
        val available=value?.opt("available") as? Boolean
        if(available==true||available==null&&value?.optString("state")=="available"){
            val text=value?.opt("text") as? String?:return unavailableDiff("invalid_stored_diff")
            return if(text.toByteArray(Charsets.UTF_8).size<=16384)availableDiff(text)else unavailableDiff("text_budget")
        }
        val reason=value?.opt("reason") as? String
        return unavailableDiff(reason?.takeIf{it.length in 1..160}?:"not_available")
    }
    private fun diff(before:ByteArray?,after:ByteArray?):JSONObject {
        if(before==null||after==null)return unavailableDiff("text_budget")
        fun text(bytes:ByteArray):String?=try{Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString().takeUnless{it.contains('\u0000')}}catch(_:Exception){null}
        val old=text(before)?:return unavailableDiff("binary");val updated=text(after)?:return unavailableDiff("binary")
        val unified="--- original\n+++ updated\n"+old.lines().joinToString("\n"){"-$it"}+"\n"+updated.lines().joinToString("\n"){"+$it"}
        if(unified.toByteArray(Charsets.UTF_8).size>16384)return unavailableDiff("text_budget")
        return availableDiff(unified)
    }
    fun open(resourceId:String):JSONObject {
        val record=resource(resourceId);val uri=Uri.parse(record.getString("uri"));requireGrant(uri,READ)
        return originalIo(uri) {
            val descriptor=resolver.openFileDescriptor(uri,"r")?:fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")
            val input=ParcelFileDescriptor.AutoCloseInputStream(descriptor)
            try{
                val result=hashOriginal(input);val id=UUID.randomUUID().toString()
                synchronized(readers){
                    if(closed)fail("DOCUMENT_STORE_CLOSED","原文件记录已关闭，请重新连接。")
                    if(readers.size>=8)fail("DOCUMENT_READER_LIMIT","打开的原件过多，请先结束已有读取。")
                    readers[id]=Reader(resourceId,uri,input,result.first,result.second)
                }
                JSONObject().put("readerId",id).put("resourceId",resourceId).put("contentDigest",result.first).put("byteLength",result.second)
            }catch(error:Exception){try{input.close()}catch(_:Exception){};throw error}
        }
    }
    fun readReader(readerId:String,offset:Long,maxBytes:Int):JSONObject {
        if(offset !in 0..MAX_CONTENT||maxBytes !in 1..32768)fail("DOCUMENT_INVALID","原文件读取范围无效。")
        val reader=synchronized(readers){readers[readerId]}?:fail("DOCUMENT_READER_LOST","原文件 reader 已失效，请重新开始读取并核验内容。")
        return synchronized(reader){originalIo(reader.uri){
            // Android can leave an already-open FD readable after URI grant revocation.
            // The application's capability still requires current authorization per call.
            requireGrant(reader.uri,READ)
            reader.input.channel.position(offset)
            val bytes=ByteArray(maxBytes);var count=0
            while(count<bytes.size){val amount=reader.input.read(bytes,count,bytes.size-count);if(amount<0)break;count+=amount}
            JSONObject().put("offset",offset).put("base64",Base64.encodeToString(bytes.copyOf(count),Base64.NO_WRAP))
                .put("bytesRead",count).put("eof",offset+count>=reader.input.channel.size())
        }}
    }
    fun closeRead(readerId:String):JSONObject {
        val reader=synchronized(readers){readers.remove(readerId)}?:fail("DOCUMENT_READER_LOST","原文件 reader 已失效，请重新开始读取并核验内容。")
        return synchronized(reader){reader.input.use{input->originalIo(reader.uri){
            requireGrant(reader.uri,READ)
            val result=hashOriginal(input)
            JSONObject().put("currentDigest",result.first).put("byteLength",result.second).put("unchanged",result.first==reader.digest&&result.second==reader.length)
        }}}
    }
    private fun hashOriginal(input:ParcelFileDescriptor.AutoCloseInputStream):Pair<String,Long> {
        try{input.channel.position(0)}catch(_:IOException){fail("DOCUMENT_UNSUPPORTED","此提供者不支持可定位的原件 reader。")}
        val digest=MessageDigest.getInstance("SHA-256");val bytes=ByteArray(32768);var length=0L
        while(true){NativeProviderPolicy.beforeActiveIo();val count=input.read(bytes);if(count<0)break;length+=count;if(length>MAX_CONTENT)fail("DOCUMENT_BUDGET_EXCEEDED","原文件读取超过 64 MiB，未声称已读取完整内容。");digest.update(bytes,0,count)}
        return digest.digest().joinToString(""){"%02x".format(it)} to length
    }
    fun read(resourceId:String,offset:Long,maxBytes:Int):JSONObject {
        if(offset !in 0..MAX_CONTENT||maxBytes !in 1..32768)fail("DOCUMENT_INVALID","原文件读取范围无效。")
        val record=resource(resourceId);val uri=Uri.parse(record.getString("uri"));requireGrant(uri,READ)
        return originalIo(uri) {
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
        value.remove("byteLength");value.remove("lastModified");value.put("networkAccess","unknown")
        val persisted=resolver.persistedUriPermissions.firstOrNull{it.uri==uri}
        val readable=granted(uri,READ);val writable=granted(uri,WRITE)
        value.put("grant",JSONObject().put("read",readable).put("write",writable).put("persistedRead",persisted?.isReadPermission==true).put("persistedWrite",persisted?.isWritePermission==true))
        try{
            if(!readable)fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")
            originalIo(uri){
                val queried=resolver.query(uri,arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED),null,null,null)
                    ?:fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")
                queried.use{cursor->
                    if(!cursor.moveToFirst())fail("DOCUMENT_NOT_FOUND","原文件已移动、删除或无法定位。")
                    fun text(column:String,fallback:String):String {val index=cursor.getColumnIndex(column);return if(index>=0&&!cursor.isNull(index))cursor.getString(index).take(300)else fallback}
                    fun number(column:String):Long? {val index=cursor.getColumnIndex(column);return if(index>=0&&!cursor.isNull(index))cursor.getLong(index)else null}
                    value.put("displayName",text(DocumentsContract.Document.COLUMN_DISPLAY_NAME,"原文件")).put("mimeType",text(DocumentsContract.Document.COLUMN_MIME_TYPE,"application/octet-stream"))
                    value.put("providerFlags",number(DocumentsContract.Document.COLUMN_FLAGS)?:0)
                    number(DocumentsContract.Document.COLUMN_SIZE)?.let{value.put("byteLength",it)}
                    number(DocumentsContract.Document.COLUMN_LAST_MODIFIED)?.let{value.put("lastModified",it)}
                }
            }
            value.put("provider",uri.authority).put("availability","available")
            value.remove("reasonCode");value.remove("reason")
        }catch(error:NativeDocumentException){value.put("availability",when(error.code){"DOCUMENT_PERMISSION_REQUIRED"->"permission_required";"DOCUMENT_NOT_FOUND"->"not_found";else->"unavailable"}).put("reasonCode",error.code).put("reason",error.message)}
        return value
    }
    private fun granted(uri:Uri,flag:Int)=context.checkUriPermission(uri,Process.myPid(),Process.myUid(),flag)==PackageManager.PERMISSION_GRANTED
    private fun requireGrant(uri:Uri,flag:Int){if(!granted(uri,flag))fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")}
    private fun <T> originalIo(uri:Uri,action:()->T):T=try{NativeProviderPolicy.beforeIo(context,inputNamespace,uri.toString(),networkSource);action()}
        catch(error:NativeInputException){throw error}
        catch(error:NativeDocumentException){throw error}
        catch(_:SecurityException){fail("DOCUMENT_PERMISSION_REQUIRED","原文件系统授权已撤销或尚未取得，请重新选择。")}
        catch(_:FileNotFoundException){fail("DOCUMENT_NOT_FOUND","原文件已移动、删除或无法定位。")}
        catch(_:IOException){fail("DOCUMENT_UNAVAILABLE","原文件存储暂不可用，未使用缓存冒充原件。")}
        catch(_:RuntimeException){fail("DOCUMENT_UNAVAILABLE","文档提供者暂不可用。")}
    private fun <T> locked(action:(SQLiteDatabase)->T):T=synchronized(monitor){
        if(closed)fail("DOCUMENT_STORE_CLOSED","原文件记录已关闭，请重新连接。")
        if(!context.getSystemService(UserManager::class.java).isUserUnlocked)fail("DOCUMENT_WAITING_UNLOCK","请在开机后先解锁设备。")
        val directory=File(context.noBackupFilesDir,namespace)
        try{metadataLease(directory).use{val database=helper?:DocumentDatabase(context,File(directory,"documents.sqlite").absolutePath).also{helper=it};action(database.writableDatabase)}}
        catch(error:NativeDocumentException){throw error}
        catch(_:SQLiteException){fail("DOCUMENT_STORAGE_FAILED","原文件记录无法保存或读取，原记录已保留。")}
        catch(_:IOException){fail("DOCUMENT_STORAGE_FAILED","原文件暂存内容无法保存或读取，原记录已保留。")}
    }
    private fun metadataLease(directory:File):StorageDomainLease {
        // A UI observation and the agent can briefly contend on the same durable ledger.
        // Wait only before admission: never replay a transaction, staging or Provider I/O.
        if(!directory.isDirectory&&!directory.mkdirs())fail("DOCUMENT_STORAGE_FAILED","原文件记录位置不可用，已有内容已保留。")
        val deadline=SystemClock.elapsedRealtime()+1500
        while(true){
            StorageDomainLease.acquire(directory)?.let{return it}
            val remaining=deadline-SystemClock.elapsedRealtime()
            if(remaining<=0)fail("DOCUMENT_STORAGE_BUSY","原文件记录正在提交，请稍后重试。")
            try{Thread.sleep(minOf(10L,remaining))}catch(_:InterruptedException){Thread.currentThread().interrupt();fail("DOCUMENT_STORAGE_BUSY","原文件记录等待已中断，请查询原操作。")}
        }
    }
    override fun close(){
        synchronized(monitor){closed=true;helper?.close();helper=null}
        val opened=synchronized(readers){readers.values.toList().also{readers.clear()}}
        opened.forEach{reader->synchronized(reader){try{reader.input.close()}catch(_:Exception){}}}
    }
    private class DocumentDatabase(context:Context,path:String):SQLiteOpenHelper(context,path,null,2,DatabaseErrorHandler{throw NativeDocumentException("DOCUMENT_STORAGE_CORRUPT","原文件记录损坏，已保留原库。")}){
        init{setWriteAheadLoggingEnabled(true)}
        override fun onConfigure(db:SQLiteDatabase){db.execSQL("PRAGMA synchronous=FULL")}
        private fun operations(db:SQLiteDatabase){db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,record TEXT NOT NULL)");db.execSQL("CREATE TABLE operation_receipts(operation_id TEXT NOT NULL,sequence INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(operation_id,sequence))")}
        override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE resources(id TEXT PRIMARY KEY,record TEXT NOT NULL)");operations(db)}
        override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){if(oldVersion==1&&newVersion==2)operations(db)else fail("DOCUMENT_STORAGE_INCOMPATIBLE","原文件记录版本不兼容，已保留原库。")}
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
