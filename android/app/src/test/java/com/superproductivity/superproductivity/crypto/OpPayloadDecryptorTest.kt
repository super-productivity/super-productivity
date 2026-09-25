package com.superproductivity.superproductivity.crypto

import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.CRT_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.CRT_PLAINTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.PASSWORD
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.SCHEDULE_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.SCHEDULE_PLAINTEXT
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.io.encoding.Base64

/** See [EncryptedOpFixtures] for provenance of the real-JS ciphertexts. */
class OpPayloadDecryptorTest {

    private fun newDecryptor(
        cache: InMemoryKeyCache = InMemoryKeyCache(),
        password: String = PASSWORD,
    ): OpPayloadDecryptor = OpPayloadDecryptor(password, cache)

    @Test
    fun `decrypts real sync-core ciphertext for a CRT payload`() {
        assertEquals(CRT_PLAINTEXT, newDecryptor().decrypt(CRT_CIPHERTEXT))
    }

    @Test
    fun `decrypts real sync-core ciphertext with a different session salt`() {
        assertEquals(SCHEDULE_PLAINTEXT, newDecryptor().decrypt(SCHEDULE_CIPHERTEXT))
    }

    @Test
    fun `derives the key only once per salt`() {
        val cache = InMemoryKeyCache()
        val decryptor = newDecryptor(cache)
        assertEquals(CRT_PLAINTEXT, decryptor.decrypt(CRT_CIPHERTEXT))
        assertEquals(CRT_PLAINTEXT, decryptor.decrypt(CRT_CIPHERTEXT))
        assertEquals(1, cache.putCount)
    }

    @Test
    fun `reuses a pre-populated cache across decryptor instances`() {
        val cache = InMemoryKeyCache()
        newDecryptor(cache).decrypt(CRT_CIPHERTEXT)
        assertEquals(CRT_PLAINTEXT, newDecryptor(cache).decrypt(CRT_CIPHERTEXT))
        assertEquals(1, cache.putCount)
    }

    @Test
    fun `cache-only mode returns null on a cold cache but decrypts once primed`() {
        val cache = InMemoryKeyCache()
        val cacheOnly = OpPayloadDecryptor(PASSWORD, cache, deriveOnMiss = false)
        assertNull(cacheOnly.decrypt(CRT_CIPHERTEXT))
        // The periodic worker primes the cache...
        newDecryptor(cache).decrypt(CRT_CIPHERTEXT)
        // ...after which the deadline-bound receiver can decrypt too
        assertEquals(CRT_PLAINTEXT, cacheOnly.decrypt(CRT_CIPHERTEXT))
    }

    @Test
    fun `wrong password returns null`() {
        assertNull(newDecryptor(password = "wrong-password").decrypt(CRT_CIPHERTEXT))
    }

    @Test
    fun `tampered ciphertext fails GCM authentication and returns null`() {
        val bytes = Base64.decode(CRT_CIPHERTEXT)
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 0x01).toByte()
        assertNull(newDecryptor().decrypt(Base64.encode(bytes)))
    }

    @Test
    fun `invalid base64 returns null`() {
        assertNull(newDecryptor().decrypt("not-base64!!!"))
    }

    @Test
    fun `too-short input returns null without deriving a key`() {
        val cache = InMemoryKeyCache()
        assertNull(newDecryptor(cache).decrypt(Base64.encode(ByteArray(20))))
        assertEquals(0, cache.putCount)
    }
}
