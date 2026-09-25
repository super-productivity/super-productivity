package com.superproductivity.superproductivity.crypto

/**
 * Argon2id key derivation (RFC 9106, version 0x13), ported for decrypting
 * E2EE SuperSync op payloads in the background sync worker.
 *
 * The JS side derives keys via hash-wasm's argon2id
 * (packages/sync-core/src/encryption/argon2.ts); this implementation must
 * produce identical output for identical inputs — locked by Argon2Test
 * against the RFC 9106 test vector and hash-wasm generated vectors,
 * including the production parameters (p=1, t=3, m=64 MiB).
 *
 * Lanes are computed sequentially: parallelism only permits concurrency, the
 * result is identical. Fine here — production always uses parallelism=1.
 *
 * shortcut: pure-Kotlin block permutation via index tables — a derivation with
 * production params takes seconds on a phone. Acceptable because results are
 * cached per salt (see DerivedKeyCache); hand-inlined BlaMka rounds or JNI are
 * the upgrade path if it ever matters.
 */
object Argon2 {

    private const val VERSION = 0x13
    private const val TYPE_ARGON2ID = 2
    private const val BLOCK_LONGS = 128
    private const val SYNC_POINTS = 4
    private const val MASK_32 = 0xFFFFFFFFL

    /** Row i of the 8x8 register matrix = 16 consecutive u64 words. */
    private val ROW_INDICES = Array(8) { row -> IntArray(16) { row * 16 + it } }

    /** Column i = register pairs (2i, 2i+1) of each row. */
    private val COL_INDICES = Array(8) { col ->
        IntArray(16) { k -> (k / 2) * 16 + 2 * col + (k % 2) }
    }

    fun argon2id(
        password: ByteArray,
        salt: ByteArray,
        parallelism: Int,
        memoryKiB: Int,
        iterations: Int,
        outputLength: Int,
        secret: ByteArray = ByteArray(0),
        associatedData: ByteArray = ByteArray(0),
    ): ByteArray {
        require(parallelism >= 1) { "parallelism must be >= 1" }
        require(memoryKiB >= 8 * parallelism) { "memoryKiB must be >= 8 * parallelism" }
        require(iterations >= 1) { "iterations must be >= 1" }
        require(outputLength >= 4) { "outputLength must be >= 4" }

        val lanes = parallelism
        val blockCount = 4 * lanes * (memoryKiB / (4 * lanes))
        val laneLength = blockCount / lanes
        val segmentLength = laneLength / SYNC_POINTS

        val memory = LongArray(blockCount * BLOCK_LONGS)
        val h0 = initialHash(
            password, salt, secret, associatedData,
            lanes, memoryKiB, iterations, outputLength,
        )

        for (lane in 0 until lanes) {
            fillFirstBlocks(memory, h0, lane, laneLength)
        }
        h0.fill(0)

        for (pass in 0 until iterations) {
            for (slice in 0 until SYNC_POINTS) {
                for (lane in 0 until lanes) {
                    fillSegment(
                        memory, pass, lane, slice,
                        lanes, laneLength, segmentLength, iterations, blockCount,
                    )
                }
            }
        }

        // C = XOR of the last block of every lane; tag = H'(outputLength, C)
        val finalBlock = LongArray(BLOCK_LONGS)
        for (lane in 0 until lanes) {
            val base = (lane * laneLength + laneLength - 1) * BLOCK_LONGS
            for (i in 0 until BLOCK_LONGS) {
                finalBlock[i] = finalBlock[i] xor memory[base + i]
            }
        }
        memory.fill(0)
        return variableLengthHash(outputLength, longsToBytesLE(finalBlock))
    }

    private fun initialHash(
        password: ByteArray,
        salt: ByteArray,
        secret: ByteArray,
        associatedData: ByteArray,
        lanes: Int,
        memoryKiB: Int,
        iterations: Int,
        outputLength: Int,
    ): ByteArray =
        Blake2b(64)
            .update(le32(lanes))
            .update(le32(outputLength))
            .update(le32(memoryKiB))
            .update(le32(iterations))
            .update(le32(VERSION))
            .update(le32(TYPE_ARGON2ID))
            .update(le32(password.size)).update(password)
            .update(le32(salt.size)).update(salt)
            .update(le32(secret.size)).update(secret)
            .update(le32(associatedData.size)).update(associatedData)
            .digest()

    private fun fillFirstBlocks(memory: LongArray, h0: ByteArray, lane: Int, laneLength: Int) {
        for (blockIndex in 0..1) {
            val blockBytes = variableLengthHash(
                1024,
                h0 + le32(blockIndex) + le32(lane),
            )
            val base = (lane * laneLength + blockIndex) * BLOCK_LONGS
            for (i in 0 until BLOCK_LONGS) {
                memory[base + i] = readLongLE(blockBytes, i * 8)
            }
        }
    }

    private fun fillSegment(
        memory: LongArray,
        pass: Int,
        lane: Int,
        slice: Int,
        lanes: Int,
        laneLength: Int,
        segmentLength: Int,
        iterations: Int,
        blockCount: Int,
    ) {
        // Argon2id: data-independent addressing for the first two slices of the
        // first pass, data-dependent afterwards.
        val dataIndependent = pass == 0 && slice < 2
        val addressBlock = LongArray(BLOCK_LONGS)
        val inputBlock = LongArray(BLOCK_LONGS)
        val work = LongArray(BLOCK_LONGS)
        val workCopy = LongArray(BLOCK_LONGS)
        val permuteBuf = LongArray(16)

        if (dataIndependent) {
            inputBlock[0] = pass.toLong()
            inputBlock[1] = lane.toLong()
            inputBlock[2] = slice.toLong()
            inputBlock[3] = blockCount.toLong()
            inputBlock[4] = iterations.toLong()
            inputBlock[5] = TYPE_ARGON2ID.toLong()
        }

        var startingIndex = 0
        if (pass == 0 && slice == 0) {
            startingIndex = 2
            if (dataIndependent) {
                nextAddresses(addressBlock, inputBlock, work, workCopy, permuteBuf)
            }
        }

        var currOffset = lane * laneLength + slice * segmentLength + startingIndex
        var prevOffset =
            if (currOffset % laneLength == 0) currOffset + laneLength - 1 else currOffset - 1

        for (index in startingIndex until segmentLength) {
            if (currOffset % laneLength == 1) {
                prevOffset = currOffset - 1
            }

            val pseudoRand = if (dataIndependent) {
                if (index % BLOCK_LONGS == 0) {
                    nextAddresses(addressBlock, inputBlock, work, workCopy, permuteBuf)
                }
                addressBlock[index % BLOCK_LONGS]
            } else {
                memory[prevOffset * BLOCK_LONGS]
            }

            val refLane = if (pass == 0 && slice == 0) {
                lane
            } else {
                ((pseudoRand ushr 32) % lanes).toInt()
            }
            val refIndex = indexAlpha(
                pass, slice, index,
                sameLane = refLane == lane,
                laneLength = laneLength,
                segmentLength = segmentLength,
                j1 = pseudoRand and MASK_32,
            )
            val refOffset = refLane * laneLength + refIndex

            fillBlock(
                memory, prevOffset, refOffset, currOffset,
                withXor = pass != 0,
                work = work, workCopy = workCopy, permuteBuf = permuteBuf,
            )
            currOffset++
            prevOffset++
        }
    }

    /** RFC 9106 §3.4.1.3: map J1 onto the reference block index. */
    private fun indexAlpha(
        pass: Int,
        slice: Int,
        index: Int,
        sameLane: Boolean,
        laneLength: Int,
        segmentLength: Int,
        j1: Long,
    ): Int {
        val referenceAreaSize: Long = if (pass == 0) {
            when {
                slice == 0 -> (index - 1).toLong()
                sameLane -> (slice * segmentLength + index - 1).toLong()
                else -> (slice * segmentLength + (if (index == 0) -1 else 0)).toLong()
            }
        } else {
            if (sameLane) {
                (laneLength - segmentLength + index - 1).toLong()
            } else {
                (laneLength - segmentLength + (if (index == 0) -1 else 0)).toLong()
            }
        }
        var relativePosition = (j1 * j1) ushr 32
        relativePosition = referenceAreaSize - 1L - ((referenceAreaSize * relativePosition) ushr 32)
        val startPosition = if (pass != 0 && slice != SYNC_POINTS - 1) {
            ((slice + 1) * segmentLength).toLong()
        } else {
            0L
        }
        return ((startPosition + relativePosition) % laneLength).toInt()
    }

    /** addressBlock = G(0, G(0, ++inputBlock)) — RFC 9106 §3.4.1.2. */
    private fun nextAddresses(
        addressBlock: LongArray,
        inputBlock: LongArray,
        work: LongArray,
        workCopy: LongArray,
        permuteBuf: LongArray,
    ) {
        inputBlock[6]++
        gBlock(inputBlock, addressBlock, work, workCopy, permuteBuf)
        gBlock(addressBlock, addressBlock, work, workCopy, permuteBuf)
    }

    /** out = G(0, input) = P-permuted(input) XOR input, both standalone blocks. */
    private fun gBlock(
        input: LongArray,
        out: LongArray,
        work: LongArray,
        workCopy: LongArray,
        permuteBuf: LongArray,
    ) {
        input.copyInto(work)
        input.copyInto(workCopy)
        applyPermutations(work, permuteBuf)
        for (i in 0 until BLOCK_LONGS) {
            out[i] = work[i] xor workCopy[i]
        }
    }

    /**
     * memory[curr] = G(memory[prev], memory[ref]) — XORed with the old block
     * content on later passes (version 0x13 behavior).
     */
    private fun fillBlock(
        memory: LongArray,
        prevOffset: Int,
        refOffset: Int,
        currOffset: Int,
        withXor: Boolean,
        work: LongArray,
        workCopy: LongArray,
        permuteBuf: LongArray,
    ) {
        val prevBase = prevOffset * BLOCK_LONGS
        val refBase = refOffset * BLOCK_LONGS
        val currBase = currOffset * BLOCK_LONGS
        for (i in 0 until BLOCK_LONGS) {
            val r = memory[prevBase + i] xor memory[refBase + i]
            work[i] = r
            workCopy[i] = if (withXor) r xor memory[currBase + i] else r
        }
        applyPermutations(work, permuteBuf)
        for (i in 0 until BLOCK_LONGS) {
            memory[currBase + i] = work[i] xor workCopy[i]
        }
    }

    /** P applied to the 8 rows, then the 8 columns, of the 8x8 register matrix. */
    private fun applyPermutations(v: LongArray, buf: LongArray) {
        for (i in 0 until 8) {
            permute(v, ROW_INDICES[i], buf)
        }
        for (i in 0 until 8) {
            permute(v, COL_INDICES[i], buf)
        }
    }

    private fun permute(v: LongArray, indices: IntArray, w: LongArray) {
        for (k in 0 until 16) {
            w[k] = v[indices[k]]
        }
        blamka(w, 0, 4, 8, 12)
        blamka(w, 1, 5, 9, 13)
        blamka(w, 2, 6, 10, 14)
        blamka(w, 3, 7, 11, 15)
        blamka(w, 0, 5, 10, 15)
        blamka(w, 1, 6, 11, 12)
        blamka(w, 2, 7, 8, 13)
        blamka(w, 3, 4, 9, 14)
        for (k in 0 until 16) {
            v[indices[k]] = w[k]
        }
    }

    /** BlaMka GB: BLAKE2b's G with a + b replaced by a + b + 2 * lo32(a) * lo32(b). */
    private fun blamka(w: LongArray, a: Int, b: Int, c: Int, d: Int) {
        w[a] = w[a] + w[b] + 2 * (w[a] and MASK_32) * (w[b] and MASK_32)
        w[d] = (w[d] xor w[a]).rotateRight(32)
        w[c] = w[c] + w[d] + 2 * (w[c] and MASK_32) * (w[d] and MASK_32)
        w[b] = (w[b] xor w[c]).rotateRight(24)
        w[a] = w[a] + w[b] + 2 * (w[a] and MASK_32) * (w[b] and MASK_32)
        w[d] = (w[d] xor w[a]).rotateRight(16)
        w[c] = w[c] + w[d] + 2 * (w[c] and MASK_32) * (w[d] and MASK_32)
        w[b] = (w[b] xor w[c]).rotateRight(63)
    }

    /** H'(T, X) — RFC 9106 §3.3 variable-length hash on top of BLAKE2b. */
    private fun variableLengthHash(outputLength: Int, input: ByteArray): ByteArray {
        if (outputLength <= 64) {
            return Blake2b(outputLength).update(le32(outputLength)).update(input).digest()
        }
        val fullBlocks = (outputLength + 31) / 32 - 2
        val out = ByteArray(outputLength)
        var v = Blake2b(64).update(le32(outputLength)).update(input).digest()
        System.arraycopy(v, 0, out, 0, 32)
        for (i in 1 until fullBlocks) {
            v = Blake2b(64).update(v).digest()
            System.arraycopy(v, 0, out, i * 32, 32)
        }
        val lastLength = outputLength - 32 * fullBlocks
        v = Blake2b(lastLength).update(v).digest()
        System.arraycopy(v, 0, out, 32 * fullBlocks, lastLength)
        return out
    }

    private fun le32(value: Int): ByteArray = byteArrayOf(
        value.toByte(),
        (value ushr 8).toByte(),
        (value ushr 16).toByte(),
        (value ushr 24).toByte(),
    )

    private fun longsToBytesLE(longs: LongArray): ByteArray {
        val out = ByteArray(longs.size * 8)
        for (i in longs.indices) {
            val value = longs[i]
            for (j in 0 until 8) {
                out[i * 8 + j] = (value ushr (8 * j)).toByte()
            }
        }
        return out
    }
}
