package dev.durableagent.probe

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.UserManager
import java.io.File

/** CE-only public peer facts. A changed identity requires explicit repair, never silent trust reset. */
class ExecutionPairingStore(context: Context, namespace: String = "production-v1") : AutoCloseable {
    private val context = context.applicationContext
    private val helper: SQLiteOpenHelper
    init {
        require(namespace.matches(Regex("[a-zA-Z0-9-]{1,80}")))
        if (!this.context.getSystemService(UserManager::class.java).isUserUnlocked) throw ExecutionChannelException("FIRST_UNLOCK_REQUIRED")
        if (this.context.isDeviceProtectedStorage) throw ExecutionChannelException("CE_STORAGE_REQUIRED")
        val directory = File(this.context.noBackupFilesDir, "execution-$namespace")
        if (!directory.isDirectory && !directory.mkdirs()) throw ExecutionChannelException("PAIRING_STORAGE_UNAVAILABLE")
        helper = object : SQLiteOpenHelper(this.context, File(directory, "pairing.sqlite").absolutePath, null, 1,
            DatabaseErrorHandler { throw ExecutionChannelException("PAIRING_STORAGE_CORRUPT") }) {
            init { setWriteAheadLoggingEnabled(true) }
            override fun onConfigure(db: SQLiteDatabase) {
                db.execPerConnectionSQL("PRAGMA synchronous=FULL", null)
            }
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL("CREATE TABLE pairing(singleton INTEGER PRIMARY KEY CHECK(singleton=1),protocol INTEGER NOT NULL CHECK(protocol=1),port INTEGER NOT NULL,server_pin TEXT NOT NULL,executor_id TEXT NOT NULL,ledger_epoch TEXT NOT NULL,client_certificate TEXT NOT NULL)")
            }
            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { throw ExecutionChannelException("PAIRING_VERSION_UNSUPPORTED") }
            override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { throw ExecutionChannelException("PAIRING_VERSION_UNSUPPORTED") }
        }
    }
    @Synchronized fun read(): ExecutionPairing? = guarded { readRecord(helper.readableDatabase)?.first }
    @Synchronized fun requireClient(certificateSha256: String): ExecutionPairing = guarded {
        val record = readRecord(helper.readableDatabase) ?: throw ExecutionChannelException("PAIRING_REQUIRED")
        if (record.second != certificateSha256) throw ExecutionChannelException("CLIENT_IDENTITY_CHANGED")
        record.first
    }
    @Synchronized fun saveIfAbsent(pairing: ExecutionPairing, certificateSha256: String): ExecutionPairing = guarded {
        if (!certificateSha256.matches(Regex("[a-f0-9]{64}"))) throw ExecutionChannelException("INVALID_CLIENT_IDENTITY")
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            val previous = readRecord(db)
            if (previous != null) {
                if (previous.first != pairing || previous.second != certificateSha256) throw ExecutionChannelException("PAIRING_CONFLICT")
            } else {
                db.execSQL("INSERT INTO pairing VALUES(1,1,?,?,?,?,?)", arrayOf<Any>(pairing.port, pairing.serverSpkiSha256, pairing.executorId, pairing.ledgerEpoch, certificateSha256))
            }
            db.setTransactionSuccessful()
            pairing
        } finally { db.endTransaction() }
    }
    private fun readRecord(db: SQLiteDatabase): Pair<ExecutionPairing, String>? = db.rawQuery("SELECT protocol,port,server_pin,executor_id,ledger_epoch,client_certificate FROM pairing WHERE singleton=1", null).use {
        if (!it.moveToFirst()) null else {
            if (it.getInt(0) != 1) throw ExecutionChannelException("PAIRING_VERSION_UNSUPPORTED")
            val client = it.getString(5)
            if (!client.matches(Regex("[a-f0-9]{64}"))) throw ExecutionChannelException("PAIRING_STORAGE_CORRUPT")
            ExecutionPairing(it.getInt(1), it.getString(2), it.getString(3), it.getString(4)) to client
        }
    }
    private fun <T> guarded(action: () -> T): T = try { action() }
    catch (error: ExecutionChannelException) { throw error }
    catch (_: Exception) { throw ExecutionChannelException("PAIRING_STORAGE_UNAVAILABLE") }
    @Synchronized override fun close() { helper.close() }
}
