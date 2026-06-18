package com.superproductivity.superproductivity.app

import androidx.test.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.App
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented test for [KeyValStore].
 *
 * MUST run on an emulator/device, not Robolectric: the ~2 MB CursorWindow limit
 * that this is guarding against only manifests against real Android SQLite.
 *
 * Regression for the on-device backup data-loss bug: a backup blob larger than
 * Android's ~2 MB CursorWindow could be written via [KeyValStore.set] but not
 * read back via [KeyValStore.get] — `cursor.getString()` threw
 * SQLiteBlobTooBigException ("Row too big to fit into CursorWindow"). That surfaced
 * to the WebView as "Error invoking loadFromDb: Java exception …", so the
 * eviction-recovery path (#7901) silently failed and the user lost everything.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class KeyValStoreInstrumentedTest {

    private val store by lazy {
        (InstrumentationRegistry.getTargetContext().applicationContext as App).keyValStore
    }

    private val testKey = "instr_test_keyvalstore"

    @After
    fun cleanUp() {
        store.set(testKey, null)
    }

    @Test
    fun smallValueRoundTrips() {
        val value = "hello / with 'apostrophes' and \"quotes\" and \n newlines"
        store.set(testKey, value)
        assertEquals(value, store.get(testKey, "DEFAULT"))
    }

    @Test
    fun missingKeyReturnsDefault() {
        assertEquals("DEFAULT", store.get("instr_test_definitely_absent_key", "DEFAULT"))
    }

    /**
     * Core regression: a value well past the ~2 MB CursorWindow limit.
     * Pre-fix this throws inside get(); post-fix the chunked read returns it whole.
     */
    @Test
    fun largeValueOverCursorWindowRoundTrips() {
        val big = buildString {
            // ~3 MB of varied content (not one repeated char) to mimic a real JSON backup.
            val unit = "{\"id\":\"abc123def456\",\"title\":\"do the thing\",\"t\":600000},"
            while (length < 3 * 1024 * 1024) append(unit)
        }
        store.set(testKey, big)

        val read = store.get(testKey, "DEFAULT")

        assertEquals(big.length, read.length)
        assertEquals(big, read)
    }
}
