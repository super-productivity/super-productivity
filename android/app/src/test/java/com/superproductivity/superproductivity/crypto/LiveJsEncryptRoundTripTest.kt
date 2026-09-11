package com.superproductivity.superproductivity.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import kotlin.io.encoding.Base64

/**
 * Round-trip against ciphertexts freshly produced by the REAL sync-core
 * encrypt() — regenerated on every CI run by
 * tools/generate-android-crypto-fixtures.mjs, so KDF-parameter or wire-format
 * drift fails the PR that introduces it instead of silently degrading
 * background reminders on Android.
 *
 * Skipped when the fixture file is absent (plain local runs); the frozen
 * vectors in [EncryptedOpFixtures] still cover compatibility there. Local run:
 *
 *   node tools/generate-android-crypto-fixtures.mjs
 *   cd android && ./gradlew :app:testFdroidDebugUnitTest
 */
class LiveJsEncryptRoundTripTest {

    private data class Fixture(val name: String, val plaintext: String, val ciphertext: String)

    @Test
    fun `decrypts fixtures freshly encrypted by the real JS implementation`() {
        val file = locateFixtures()
        assumeTrue("live fixtures not generated - skipping", file != null)

        var password: String? = null
        val fixtures = mutableListOf<Fixture>()
        file!!.readLines().forEach { line ->
            val parts = line.split('\t')
            when (parts.firstOrNull()) {
                "password" -> password = decodeUtf8(parts[1])
                "entry" -> fixtures.add(Fixture(parts[1], decodeUtf8(parts[2]), parts[3]))
            }
        }
        assertTrue("fixture file has no entries", fixtures.size >= 2)

        val decryptor = OpPayloadDecryptor(password!!, InMemoryKeyCache())
        for ((name, plaintext, ciphertext) in fixtures) {
            assertEquals("fixture '$name'", plaintext, decryptor.decrypt(ciphertext))
        }

        // The generator clears the JS session cache between entries, so the
        // fixtures must span distinct salts (like ops from different devices).
        val salts = fixtures.map { Base64.decode(it.ciphertext).copyOf(16).toHexString() }
        assertTrue("expected distinct session salts", salts.toSet().size >= 2)
    }

    private fun decodeUtf8(b64: String): String = String(Base64.decode(b64), Charsets.UTF_8)

    private fun locateFixtures(): File? =
        listOfNotNull(System.getenv("LIVE_CRYPTO_FIXTURES"), "build/live-crypto-fixtures.tsv")
            .map(::File)
            .firstOrNull { it.isFile }
}
