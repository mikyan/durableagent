package dev.durableagent.probe

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/** Immutable exact npm closure, addressed by the packaged bytes. */
object RuntimeBundle {
    fun unpack(context:Context):File {
        val digest=context.assets.open("runtime.zip").use {input ->
            val sha=MessageDigest.getInstance("SHA-256");val bytes=ByteArray(65536)
            while(true){val n=input.read(bytes);if(n<0)break;sha.update(bytes,0,n)}
            sha.digest().joinToString(""){"%02x".format(it)}
        }
        val root=File(context.filesDir,"application-bundles/$digest")
        if(File(root,".complete").exists())return root
        root.mkdirs()
        ZipInputStream(context.assets.open("runtime.zip")).use {zip ->
            while(true){val entry=zip.nextEntry?:break;val file=File(root,entry.name)
                check(file.canonicalPath.startsWith(root.canonicalPath+File.separator))
                if(entry.isDirectory)file.mkdirs() else {file.parentFile!!.mkdirs();file.outputStream().use {zip.copyTo(it)}}
            }
        }
        File(root,".complete").writeText(digest);return root
    }
}
