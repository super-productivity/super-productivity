package com.superproductivity.superproductivity.crypto

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Vectors: "abc" (RFC 7693 appendix A) plus hash-wasm generated fixtures —
 * hash-wasm is the exact library the JS side (packages/sync-core) uses, so
 * matching it is what guarantees cross-language key derivation.
 */
class Blake2bTest {

    @Test
    fun `abc with 64-byte digest matches RFC 7693`() {
        assertEquals(
            "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
                "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
            Blake2b(64).update("abc".toByteArray()).digest().toHexString(),
        )
    }

    @Test
    fun `300-byte multi-block input matches hash-wasm`() {
        val input = ByteArray(300) { it.toByte() }
        assertEquals(
            "d9cf5983dc6b34c0fa1f0226926855ad3eccd2bcdcd8f8053b9a80664d33b5af" +
                "cc32fd21c70ea14f4ef50ca97c3203c4d1803159f0e01bb6cb1d1c83db52b63c",
            Blake2b(64).update(input).digest().toHexString(),
        )
    }

    @Test
    fun `incremental updates equal single update`() {
        val input = ByteArray(300) { it.toByte() }
        val single = Blake2b(64).update(input).digest()
        val incremental = Blake2b(64)
            .update(input, 0, 1)
            .update(input, 1, 127)
            .update(input, 128, 128)
            .update(input, 256, 44)
            .digest()
        assertEquals(single.toHexString(), incremental.toHexString())
    }

    @Test
    fun `abc with 28-byte digest matches hash-wasm`() {
        assertEquals(
            "9bd237b02a29e43bdd6738afa5b53ff0eee178d6210b618e4511aec8",
            Blake2b(28).update("abc".toByteArray()).digest().toHexString(),
        )
    }

    @Test
    fun `empty input with 64-byte digest matches RFC 7693 reference`() {
        // From the BLAKE2 reference implementation's testvectors (blake2b, empty input)
        assertEquals(
            "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419" +
                "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
            Blake2b(64).digest().toHexString(),
        )
    }
}

internal fun ByteArray.toHexString(): String = joinToString("") { "%02x".format(it) }
