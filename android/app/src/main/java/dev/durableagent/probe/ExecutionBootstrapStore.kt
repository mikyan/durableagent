package dev.durableagent.probe

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import java.io.File

/** Cross-process one-shot callback mailbox. Its public facts never authorize execution. */
class ExecutionBootstrapStore(context: Context, namespace: String = "production-v1") : AutoCloseable {
    private val context = context.applicationContext
    private val helper: SQLiteOpenHelper
    init {
        require(namespace.matches(Regex("[a-zA-Z0-9-]{1,80}")))
        if (!this.context.getSystemService(UserManager::class.java).isUserUnlocked) throw ExecutionChannelException("FIRST_UNLOCK_REQUIRED")
        if (this.context.isDeviceProtectedStorage) throw ExecutionChannelException("CE_STORAGE_REQUIRED")
        val directory = File(this.context.noBackupFilesDir, "execution-$namespace")
        if (!directory.isDirectory && !directory.mkdirs()) throw ExecutionChannelException("BOOTSTRAP_STORAGE_UNAVAILABLE")
        helper = object : SQLiteOpenHelper(this.context, File(directory, "bootstrap.sqlite").absolutePath, null, 1,
            DatabaseErrorHandler { throw ExecutionChannelException("BOOTSTRAP_STORAGE_CORRUPT") }) {
            init { setWriteAheadLoggingEnabled(true) }
            override fun onConfigure(db: SQLiteDatabase) { db.execPerConnectionSQL("PRAGMA synchronous=FULL", null) }
            override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE pending(nonce TEXT PRIMARY KEY,boot INTEGER NOT NULL,expires INTEGER NOT NULL,result TEXT)") }
            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { throw ExecutionChannelException("BOOTSTRAP_VERSION_UNSUPPORTED") }
            override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { throw ExecutionChannelException("BOOTSTRAP_VERSION_UNSUPPORTED") }
        }
    }
    @Synchronized fun register(nonce: String) = transaction { db ->
        require(nonce.matches(Regex("[a-f0-9-]{36}")))
        expire(db)
        val count = db.rawQuery("SELECT COUNT(*) FROM pending", null).use { it.moveToFirst(); it.getInt(0) }
        if (count >= 8) throw ExecutionChannelException("BOOTSTRAP_BUSY")
        db.execSQL("INSERT INTO pending VALUES(?,?,?,NULL)", arrayOf<Any>(nonce, boot(), SystemClock.elapsedRealtime() + 20000))
    }
    @Synchronized fun complete(nonce: String, result: String): Boolean = transaction { db ->
        if (result.toByteArray(Charsets.UTF_8).size > 16384) return@transaction false
        expire(db)
        db.update("pending", ContentValues().apply { put("result", result) }, "nonce=? AND result IS NULL", arrayOf(nonce)) == 1
    }
    @Synchronized fun take(nonce: String): String? = transaction { db ->
        expire(db)
        val result = db.rawQuery("SELECT result FROM pending WHERE nonce=?", arrayOf(nonce)).use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }
        if (result != null) db.delete("pending", "nonce=?", arrayOf(nonce))
        result
    }
    @Synchronized fun forget(nonce: String) { helper.writableDatabase.delete("pending", "nonce=?", arrayOf(nonce)) }
    private fun boot() = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
    private fun expire(db: SQLiteDatabase) { db.delete("pending", "boot<>? OR expires<=?", arrayOf(boot().toString(), SystemClock.elapsedRealtime().toString())) }
    private fun <T> transaction(action: (SQLiteDatabase) -> T): T {
        val db = helper.writableDatabase
        db.beginTransaction()
        try { val result = action(db); db.setTransactionSuccessful(); return result } finally { db.endTransaction() }
    }
    @Synchronized override fun close() { helper.close() }
}
