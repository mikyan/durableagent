package dev.durableagent.probe

import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException

/** OS ownership, acquired before SQLite migration/Session open and released after Node closes.
 * The inode is stable: never delete/replace this lock file. Process death releases the lock.
 */
class StorageDomainLease private constructor(private val file:RandomAccessFile,private val lock:FileLock,private val key:String):AutoCloseable {
    private var closed=false
    override fun close() {synchronized(owners) {
        if(closed)return
        try {lock.release()}finally {try {file.close()}finally {closed=true;owners.remove(key)}}
    }}
    companion object {
        private val owners=mutableSetOf<String>()
        fun acquire(directory:File):StorageDomainLease? = synchronized(owners) {
            check(directory.mkdirs()||directory.isDirectory)
            val lockFile=File(directory,"writer.lock")
            val key=lockFile.canonicalPath
            // Do not open/close another descriptor for an inode locked by this process:
            // POSIX process locks may be released by closing any descriptor for it.
            if(key in owners)return@synchronized null
            val file=RandomAccessFile(lockFile,"rw")
            try {
                val lock=try {file.channel.tryLock()}catch(_:OverlappingFileLockException){null}
                if(lock==null){file.close();return@synchronized null}
                owners.add(key)
                StorageDomainLease(file,lock,key)
            } catch(error:Throwable) {file.close();throw error}
        }
    }
}
