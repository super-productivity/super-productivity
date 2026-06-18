package com.superproductivity.superproductivity.app

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import com.superproductivity.superproductivity.App

class KeyValStore(private val context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

//    private static final String CREATE_TABLE = "CREATE TABLE supKeyValStore(TEXT PRIMARY KEY,VALUE TEXT,KEY_CREATED_AT DATETIME)"

    override fun onCreate(db: SQLiteDatabase?) {
        Log.v(TAG, "onCreate")
        db?.execSQL(CREATE_TABLE)
    }

    override fun onUpgrade(db: SQLiteDatabase?, oldVersion: Int, newVersion: Int) {
        Log.v(TAG, "onUpgrade $oldVersion -> $newVersion")
        // #7901: NEVER drop this table on upgrade. It holds the durable on-device
        // backup ('backup' / 'backup_prev') — the last line of defence against
        // WebView IndexedDB eviction (#7892). The previous "DROP TABLE; onCreate"
        // would destroy that backup the moment DATABASE_VERSION was ever bumped,
        // i.e. a self-inflicted total data loss. Keep upgrades strictly additive:
        // ensure the table exists and leave existing rows intact. Add real
        // column/table migrations here as future versions need them.
        onCreate(db)
    }

    /**
     * Setter method. Sets a (key, value) pair in sqlite3 db.
     *
     * @param key     The URL or some other unique id for data can be used
     * @param value   String data to be saved
     * @return rowid of the insertion row
     */
    @Synchronized
    fun set(key: String, value: String?): Long {
        val newKey = DatabaseUtils.sqlEscapeString(key)
        Log.v(TAG, "setting db value: $newKey")
        val dbHelper = (context.applicationContext as App).keyValStore
        val db = dbHelper.writableDatabase
        var row = 0L
        if (db != null) {
            val values = ContentValues()
            values.put(KEY, newKey)
            values.put(VALUE, value)
            // Store real epoch millis. The previous "time('now')" literal was
            // never evaluated by SQLite (ContentValues binds it as text), so the
            // column held a constant string instead of a usable write timestamp.
            values.put(KEY_CREATED_AT, System.currentTimeMillis())
            row = db.replace(DATABASE_TABLE, null, values)
            Log.v(TAG, "save db value size: " + value?.length)
            db.close()
        }
        return row
    }

    /**
     * @param key          The URL or some other unique id for data can be used
     * @param defaultValue value to be returned in case something goes wrong or no data is found
     * @return value stored in DB if present, defaultValue otherwise.
     */
    @Synchronized
    fun get(key: String, defaultValue: String): String {
        val newKey = DatabaseUtils.sqlEscapeString(key)
        Log.v(TAG, "getting db value: $newKey")
        val dbHelper = (context.applicationContext as App).keyValStore
        val database = dbHelper.readableDatabase ?: return defaultValue
        return try {
            // Read in <2 MB chunks: a single cursor.getString() on a row past Android's
            // ~2 MB CursorWindow throws SQLiteBlobTooBigException. substr() is 1-indexed
            // and counts code points, so the reassembled chunks are byte-exact.
            val sb = StringBuilder()
            var offset = 1
            while (true) {
                val chunk = database.rawQuery(
                    "SELECT substr($VALUE, ?, ?) FROM $DATABASE_TABLE WHERE $KEY=? LIMIT 1",
                    arrayOf(offset.toString(), GET_CHUNK_CHARS.toString(), newKey)
                ).use { if (it.moveToFirst()) it.getString(0) else null }
                if (chunk.isNullOrEmpty()) break // no row, NULL column, or past end-of-string
                sb.append(chunk)
                if (chunk.length < GET_CHUNK_CHARS) break // short chunk = finished
                offset += GET_CHUNK_CHARS
            }
            Log.v(TAG, "get db value size:" + sb.length)
            // The only caller passes "" as default, so empty-value and absent collapse.
            sb.toString().ifEmpty { defaultValue }
        } catch (e: Exception) {
            // Never let a read failure crash the JS bridge — degrade to default so
            // callers can surface "no backup" instead of an opaque invocation error.
            Log.e(TAG, "get failed for key $newKey", e)
            defaultValue
        } finally {
            database.close()
        }
    }

    fun clearAll(context: Context) {
        val dbHelper = (context.applicationContext as App).keyValStore
        val db = dbHelper.writableDatabase
        if (db != null) {
            db.delete(DATABASE_TABLE, null, null)
            Log.v(TAG, "cleared db ")
            db.close()
        }
    }

    companion object {
        private const val DATABASE_TABLE: String = "supKeyValStore"
        private const val DATABASE_VERSION: Int = 1
        private const val KEY: String = "KEY"
        private const val DATABASE_NAME: String = "SupKeyValStore"
        private const val VALUE: String = "VALUE"
        private const val KEY_CREATED_AT: String = "KEY_CREATED_AT"
        private const val TAG: String = "SupKeyValStore"

        // Read large rows in chunks of this many CHARACTERS. Even at 4 bytes/char
        // (256K * 4 = 1 MB) this stays well under the ~2 MB CursorWindow limit.
        private const val GET_CHUNK_CHARS: Int = 256 * 1024
        // IF NOT EXISTS so the additive onUpgrade() (which calls onCreate) is safe
        // to run against an already-populated DB without throwing (#7901).
        private const val CREATE_TABLE =
            ("CREATE TABLE IF NOT EXISTS $DATABASE_TABLE($KEY TEXT PRIMARY KEY,$VALUE TEXT,$KEY_CREATED_AT DATETIME)")
    }
}
