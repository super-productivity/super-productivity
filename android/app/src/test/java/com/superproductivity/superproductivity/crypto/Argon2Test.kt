package com.superproductivity.superproductivity.crypto

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Vectors: RFC 9106 §5.3 (the official argon2id test vector, with secret and
 * associated data) plus hash-wasm generated fixtures — hash-wasm is the exact
 * library the JS side (packages/sync-core) uses for op-payload encryption, and
 * the prod vector uses the production KDF parameters (p=1, t=3, m=64 MiB).
 */
class Argon2Test {

    private val salt16 = "000102030405060708090a0b0c0d0e0f".hexToByteArray()

    @Test
    fun `matches RFC 9106 argon2id test vector`() {
        val tag = Argon2.argon2id(
            password = ByteArray(32) { 0x01 },
            salt = ByteArray(16) { 0x02 },
            parallelism = 4,
            memoryKiB = 32,
            iterations = 3,
            outputLength = 32,
            secret = ByteArray(8) { 0x03 },
            associatedData = ByteArray(12) { 0x04 },
        )
        assertEquals(
            "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
            tag.toHexString(),
        )
    }

    @Test
    fun `matches hash-wasm with small single-lane params`() {
        val tag = Argon2.argon2id(
            password = "test-password".toByteArray(),
            salt = salt16,
            parallelism = 1,
            memoryKiB = 64,
            iterations = 3,
            outputLength = 32,
        )
        assertEquals(
            "0d786afcedf5887149009b3bf1ce23bef5769cb2dc10d058c8c40dd7f431f7f1",
            tag.toHexString(),
        )
    }

    @Test
    fun `matches hash-wasm with four lanes`() {
        val tag = Argon2.argon2id(
            password = "test-password".toByteArray(),
            salt = salt16,
            parallelism = 4,
            memoryKiB = 64,
            iterations = 3,
            outputLength = 32,
        )
        assertEquals(
            "395cb724885b0d8fe5a8ed5374cc22258ffef04b5225de589c6d24700e3fc6a0",
            tag.toHexString(),
        )
    }

    @Test
    fun `matches hash-wasm with production params`() {
        // p=1, t=3, m=64 MiB — the exact parameters sync-core uses for op
        // payload encryption. Slow (~seconds); this is the vector that proves
        // real cross-device key derivation works.
        val tag = Argon2.argon2id(
            password = "test-encryption-password-123".toByteArray(),
            salt = salt16,
            parallelism = 1,
            memoryKiB = 65536,
            iterations = 3,
            outputLength = 32,
        )
        assertEquals(
            "d72cc3369f92963baa9bc9de03be105e6c663b67ed1f085623a8f736463c20c9",
            tag.toHexString(),
        )
    }
}
