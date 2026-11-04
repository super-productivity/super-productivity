package com.superproductivity.superproductivity.service

import android.content.Context
import androidx.security.crypto.MasterKey
import androidx.test.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore

/**
 * Instrumented test for [BackgroundSyncCredentialStore].
 *
 * MUST run on an emulator/device, not Robolectric: the whole point is the real
 * Android Keystore, which is what does not survive a device migration.
 *
 * Regression for the migration data-exposure bug. The EncryptedSharedPreferences
 * master key is device-bound; cloud backup and device-to-device transfer carry
 * the prefs file but never the key. On the new device Tink then throws out of
 * `EncryptedSharedPreferences.create()`, and the catch in `createPrefs()` used to
 * fall straight through to a plaintext SharedPreferences over that same file — so
 * the SuperSync access token and the E2EE password were written to disk in the
 * clear from the first launch onward, and never re-encrypted, because create()
 * keeps failing on the stale keyset on every later process start.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class BackgroundSyncCredentialStoreInstrumentedTest {

    private val context: Context
        get() = InstrumentationRegistry.getTargetContext().applicationContext

    private val prefsFile: File
        get() = File(context.applicationInfo.dataDir, "shared_prefs/$PREFS_FILE_NAME")

    @Before
    fun reset() = wipe()

    @After
    fun cleanUp() = wipe()

    private fun wipe() {
        BackgroundSyncCredentialStore.clear(context)
        context.deleteSharedPreferences(PREFS_NAME)
        BackgroundSyncCredentialStore.forgetCachedPrefsForTest()
    }

    /**
     * What a restore onto a new device leaves behind: the prefs file is still
     * there, the Keystore key that wrapped its keyset is not. Dropping the cached
     * instance stands in for the fresh process on the new device.
     */
    private fun simulateDeviceMigration() {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        BackgroundSyncCredentialStore.forgetCachedPrefsForTest()
    }

    @Test
    fun credentialsRoundTripAndAreNotStoredInCleartext() {
        BackgroundSyncCredentialStore.save(context, BASE_URL, TOKEN)
        BackgroundSyncCredentialStore.setEncryptionPassword(context, PASSWORD)

        val credentials = BackgroundSyncCredentialStore.get(context)
        assertNotNull(credentials)
        assertEquals(BASE_URL, credentials!!.baseUrl)
        assertEquals(TOKEN, credentials.accessToken)
        assertNoSecretsOnDisk()
    }

    /**
     * After a migration the inherited credentials are unreadable, which must read
     * as "not signed in" rather than as a crash — the WebView re-supplies them.
     */
    @Test
    fun migratedInstallReportsNoCredentials() {
        BackgroundSyncCredentialStore.save(context, BASE_URL, TOKEN)
        simulateDeviceMigration()

        assertNull(BackgroundSyncCredentialStore.get(context))
    }

    /**
     * Core regression. Pre-fix the store silently degraded to plaintext for the
     * rest of the install's life, so this write landed on disk unencrypted.
     */
    @Test
    fun migratedInstallReEncryptsInsteadOfFallingBackToCleartext() {
        BackgroundSyncCredentialStore.save(context, BASE_URL, TOKEN)
        BackgroundSyncCredentialStore.setEncryptionPassword(context, PASSWORD)
        simulateDeviceMigration()

        // Whatever the WebView supplies after the migration must still be encrypted.
        BackgroundSyncCredentialStore.save(context, BASE_URL, TOKEN)
        BackgroundSyncCredentialStore.setEncryptionPassword(context, PASSWORD)

        assertEquals(TOKEN, BackgroundSyncCredentialStore.get(context)?.accessToken)
        assertEquals(PASSWORD, BackgroundSyncCredentialStore.getEncryptionPassword(context))
        assertNoSecretsOnDisk()
    }

    private fun assertNoSecretsOnDisk() {
        val raw = prefsFile.takeIf { it.exists() }?.readText().orEmpty()
        assertFalse("access token found in cleartext in $PREFS_FILE_NAME", raw.contains(TOKEN))
        assertFalse("E2EE password found in cleartext in $PREFS_FILE_NAME", raw.contains(PASSWORD))
        assertFalse("base url found in cleartext in $PREFS_FILE_NAME", raw.contains(BASE_URL))
    }

    private companion object {
        const val PREFS_NAME = "SuperProductivitySync"
        const val PREFS_FILE_NAME = "$PREFS_NAME.xml"

        // Distinctive values so a cleartext hit cannot be a coincidental substring.
        const val BASE_URL = "https://instr-test-sync.example.invalid"
        const val TOKEN = "instr-test-token-6f3a9c2e1b7d"
        const val PASSWORD = "instr-test-password-4e8b1d0a5c9f"
    }
}
