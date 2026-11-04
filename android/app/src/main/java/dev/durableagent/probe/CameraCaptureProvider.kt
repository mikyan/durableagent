package dev.durableagent.probe

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

/** Only a single opaque private capture receives a temporary system-camera URI grant. */
class CameraCaptureProvider:ContentProvider(){
    override fun onCreate()=true
    override fun getType(uri:Uri):String { file(requireNotNull(context),uri);return "image/jpeg" }
    override fun openFile(uri:Uri,mode:String):ParcelFileDescriptor {
        val target=file(requireNotNull(context),uri)
        if(!target.isFile)throw FileNotFoundException("Capture is unavailable")
        return ParcelFileDescriptor.open(target,when(mode){"r"->ParcelFileDescriptor.MODE_READ_ONLY;"w","wt"->ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_TRUNCATE;"rw"->ParcelFileDescriptor.MODE_READ_WRITE;else->throw FileNotFoundException("Unsupported capture access")})
    }
    override fun query(uri:Uri,projection:Array<out String>?,selection:String?,selectionArgs:Array<out String>?,sortOrder:String?):Cursor {
        val target=file(requireNotNull(context),uri)
        val columns=projection?:arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE)
        return MatrixCursor(columns).apply{addRow(columns.map<String,Any?>{when(it){OpenableColumns.DISPLAY_NAME->"相机照片.jpg";OpenableColumns.SIZE->target.length();else->null}}.toTypedArray())}
    }
    override fun insert(uri:Uri,values:ContentValues?):Uri?=throw UnsupportedOperationException()
    override fun update(uri:Uri,values:ContentValues?,selection:String?,selectionArgs:Array<out String>?)=0
    override fun delete(uri:Uri,selection:String?,selectionArgs:Array<out String>?)=0
    companion object {
        private fun file(context:Context,uri:Uri):File{
            val name=uri.pathSegments.singleOrNull()
            if(uri.scheme!="content"||uri.authority!=context.packageName+".camera"||name==null||!Regex("[a-f0-9-]{36}\\.jpg").matches(name))throw FileNotFoundException("Invalid capture identity")
            return File(File(context.filesDir,"camera-captures"),name)
        }
        fun create(context:Context):Uri{
            val directory=File(context.filesDir,"camera-captures").apply{mkdirs()}
            val target=File(directory,UUID.randomUUID().toString()+".jpg");check(target.createNewFile())
            return Uri.Builder().scheme("content").authority(context.packageName+".camera").appendPath(target.name).build()
        }
        fun discard(context:Context,uri:Uri){file(context,uri).delete()}
    }
}
