package com.superproductivity.superproductivity.crypto

/**
 * Minimal unkeyed BLAKE2b (RFC 7693) with variable digest length (1..64 bytes).
 *
 * Exists only as a building block for [Argon2] (initial hash H0 and the
 * variable-length hash H'): Android ships no BLAKE2b and the project rules
 * forbid adding a crypto dependency. Verified against RFC 7693 and hash-wasm
 * generated vectors in Blake2bTest.
 */
class Blake2b(private val digestSize: Int) {

    companion object {
        private val IV = longArrayOf(
            0x6a09e667f3bcc908L, -0x4498517a7b3558c5L, 0x3c6ef372fe94f82bL, -0x5ab00ac5a0e2c90fL,
            0x510e527fade682d1L, -0x64fa9773d4c193e1L, 0x1f83d9abfb41bd6bL, 0x5be0cd19137e2179L,
        )

        private val SIGMA = arrayOf(
            intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
            intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3),
            intArrayOf(11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4),
            intArrayOf(7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8),
            intArrayOf(9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13),
            intArrayOf(2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9),
            intArrayOf(12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11),
            intArrayOf(13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10),
            intArrayOf(6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5),
            intArrayOf(10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0),
        )
    }

    init {
        require(digestSize in 1..64) { "digestSize must be 1..64" }
    }

    private val h = IV.copyOf().also {
        it[0] = it[0] xor (0x01010000L or digestSize.toLong())
    }
    private val buffer = ByteArray(128)
    private var bufferLength = 0

    // Byte counter. RFC 7693 defines it as 128-bit; Argon2 inputs are far below
    // 2^63 bytes so a single Long low word suffices (high word stays 0).
    private var counter = 0L

    fun update(data: ByteArray, offset: Int = 0, length: Int = data.size - offset): Blake2b {
        var pos = offset
        var remaining = length
        while (remaining > 0) {
            // Compress only when more input follows — the final block must stay
            // buffered for the finalization-flagged compression in digest().
            if (bufferLength == 128) {
                counter += 128
                compress(isFinal = false)
                bufferLength = 0
            }
            val toCopy = minOf(128 - bufferLength, remaining)
            System.arraycopy(data, pos, buffer, bufferLength, toCopy)
            bufferLength += toCopy
            pos += toCopy
            remaining -= toCopy
        }
        return this
    }

    fun digest(): ByteArray {
        counter += bufferLength
        buffer.fill(0, bufferLength, 128)
        compress(isFinal = true)
        val out = ByteArray(digestSize)
        for (i in 0 until digestSize) {
            out[i] = (h[i / 8] ushr (8 * (i % 8))).toByte()
        }
        return out
    }

    private fun compress(isFinal: Boolean) {
        val m = LongArray(16)
        for (i in 0 until 16) {
            m[i] = readLongLE(buffer, i * 8)
        }
        val v = LongArray(16)
        h.copyInto(v)
        IV.copyInto(v, 8)
        v[12] = v[12] xor counter
        if (isFinal) {
            v[14] = v[14].inv()
        }
        for (round in 0 until 12) {
            val s = SIGMA[round % 10]
            g(v, 0, 4, 8, 12, m[s[0]], m[s[1]])
            g(v, 1, 5, 9, 13, m[s[2]], m[s[3]])
            g(v, 2, 6, 10, 14, m[s[4]], m[s[5]])
            g(v, 3, 7, 11, 15, m[s[6]], m[s[7]])
            g(v, 0, 5, 10, 15, m[s[8]], m[s[9]])
            g(v, 1, 6, 11, 12, m[s[10]], m[s[11]])
            g(v, 2, 7, 8, 13, m[s[12]], m[s[13]])
            g(v, 3, 4, 9, 14, m[s[14]], m[s[15]])
        }
        for (i in 0 until 8) {
            h[i] = h[i] xor v[i] xor v[i + 8]
        }
    }

    private fun g(v: LongArray, a: Int, b: Int, c: Int, d: Int, x: Long, y: Long) {
        v[a] = v[a] + v[b] + x
        v[d] = (v[d] xor v[a]).rotateRight(32)
        v[c] = v[c] + v[d]
        v[b] = (v[b] xor v[c]).rotateRight(24)
        v[a] = v[a] + v[b] + y
        v[d] = (v[d] xor v[a]).rotateRight(16)
        v[c] = v[c] + v[d]
        v[b] = (v[b] xor v[c]).rotateRight(63)
    }
}

internal fun readLongLE(data: ByteArray, offset: Int): Long {
    var result = 0L
    for (i in 7 downTo 0) {
        result = (result shl 8) or (data[offset + i].toLong() and 0xFF)
    }
    return result
}
