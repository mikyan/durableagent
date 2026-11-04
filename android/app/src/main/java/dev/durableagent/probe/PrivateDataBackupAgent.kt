package dev.durableagent.probe

import android.app.backup.BackupAgent
import android.app.backup.BackupDataInput
import android.app.backup.BackupDataOutput
import android.app.backup.FullBackupDataOutput
import android.os.ParcelFileDescriptor
import java.io.File

/** No private work export, regardless of transport flags (including future full-backup channels). */
class PrivateDataBackupAgent:BackupAgent() {
    override fun onBackup(oldState:ParcelFileDescriptor?,data:BackupDataOutput?,newState:ParcelFileDescriptor?) {}
    override fun onRestore(data:BackupDataInput?,appVersionCode:Int,newState:ParcelFileDescriptor?) { flagUnsupportedRestore() }
    override fun onFullBackup(data:FullBackupDataOutput) {}
    override fun onRestoreFile(data:ParcelFileDescriptor,size:Long,destination:File,type:Int,mode:Long,mtime:Long) {
        flagUnsupportedRestore()
        // Consume the framework-owned stream without creating/replacing destination content.
        val input=java.io.FileInputStream(data.fileDescriptor);val buffer=ByteArray(8192);var remaining=size
        while(remaining>0){val count=input.read(buffer,0,minOf(buffer.size.toLong(),remaining).toInt());if(count<0)break;remaining-=count}
    }
    private fun flagUnsupportedRestore() {
        val marker=File(noBackupFilesDir,"unsupported-restore")
        java.io.FileOutputStream(marker).use{it.write("unsupported-system-restore-v1".toByteArray());it.fd.sync()}
    }
}
