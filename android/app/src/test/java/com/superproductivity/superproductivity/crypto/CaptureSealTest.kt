package com.superproductivity.superproductivity.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.io.encoding.Base64

/**
 * The seal is a contract with the server and the app's open side, so the
 * vector below is the one pinned in
 * packages/super-sync-server/tests/capture-seal.spec.ts and
 * packages/sync-core/tests/capture-open.spec.ts: user key 0x01×32,
 * ephemeral key 0x02×32, IV 0x03×12, item id "item-1".
 */
class CaptureSealTest {
    private val userSpki =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEb/A7lJJBzh2t1DUZ5pYOCoW0GmmgXDKBA6orzhWUyhY8T3U6Vb8B3FP2wLDH7ueLQMb/fSWpbiKCuYnO9xwUSg=="
    private val ephemeralPoint = Base64.decode(
        "BFUPRxAD89+Xw99QaseX9nIfsaH7e49vg9IkSYplyI4kE2CT1wEuUJpzcVy9CwCjzA/0tcAbP/oZarH7MnA2uOY=",
    )
    private val sealedVector =
        "AQRVD0cQA/Pfl8PfUGrHl/ZyH7Gh+3uPb4PSJEmKZciOJBNgk9cBLlCac3FcvQsAo8wP9LXAGz/6GWqx+zJwNrjm" +
            "AwMDAwMDAwMDAwMDVvPcrvop4zkadZl48K6FngoPEOmueJnbVQpq/L3kuXad+gVrd8UPZvLd5bkSyJANaDo0" +
            "7JGPJM67pw7l2yyLylKJEyur+1ke1Pc="

    /** JSON.stringify of the vector payload: the seal takes raw bytes. */
    private val payload = """{"v":1,"title":"Buy milk","createdAt":1,"client":"Claude"}"""

    private fun privateKey(params: ECPublicKey, fill: Int) = KeyFactory.getInstance("EC")
        .generatePrivate(ECPrivateKeySpec(BigInteger(1, ByteArray(32) { fill.toByte() }), params.params))

    @Test
    fun sealsThePinnedVectorByteForByte() {
        val user = CaptureSeal.parsePublicKey(userSpki)
        val sealed = CaptureSeal.seal(
            user,
            privateKey(user, 2),
            ephemeralPoint,
            ByteArray(12) { 3 },
            "item-1",
            payload.toByteArray(Charsets.UTF_8),
        )
        assertEquals(sealedVector, sealed)
    }

    @Test
    fun fingerprintMatchesTheServer() {
        // captureKeyFingerprint() in capture-seal.ts for the same SPKI.
        assertEquals("-FeuTtbjTjN2Guolyq7j_lShWWD7ktzWOjdasSHesqk", CaptureSeal.fingerprint(userSpki))
    }

    @Test
    fun freshSealsDifferAndOpenWithTheUserKey() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        repeat(20) {
            val user = generator.generateKeyPair()
            val spki = Base64.encode(user.public.encoded)
            val a = CaptureSeal.seal(spki, "id-$it", payload.toByteArray())
            val b = CaptureSeal.seal(spki, "id-$it", payload.toByteArray())
            assertNotEquals(a, b)
            assertEquals(payload, open(user.private as ECPrivateKey, user.public as ECPublicKey, "id-$it", a))
            assertEquals(payload, open(user.private as ECPrivateKey, user.public as ECPublicKey, "id-$it", b))
        }
    }

    @Test
    fun padsAndStripsCoordinatesToExactly32Bytes() {
        val withSignByte = BigInteger(1, ByteArray(32) { 0xff.toByte() })
        assertEquals(33, withSignByte.toByteArray().size)
        assertArrayEquals(ByteArray(32) { 0xff.toByte() }, CaptureSeal.fixedLength(withSignByte))

        val short = BigInteger.valueOf(0x0102)
        val padded = CaptureSeal.fixedLength(short)
        assertEquals(32, padded.size)
        assertArrayEquals(ByteArray(30) + byteArrayOf(1, 2), padded)
    }

    @Test
    fun encodesAShortCoordinateAsA65BytePoint() {
        val user = CaptureSeal.parsePublicKey(userSpki)
        // Same curve, a point whose x has leading zero bytes is rare; check the
        // encoding length on the pinned key and on a synthetic small x.
        assertEquals(65, CaptureSeal.sec1(user).size)
        val synthetic = object : ECPublicKey by user {
            override fun getW() = ECPoint(BigInteger.ONE, user.w.affineY)
        }
        val point = CaptureSeal.sec1(synthetic)
        assertEquals(65, point.size)
        assertEquals(1.toByte(), point[32])
        assertEquals(0.toByte(), point[1])
    }

    @Test
    fun refusesKeysThatAreNotP256Spki() {
        assertThrows(CaptureSeal.InvalidCaptureKeyException::class.java) {
            CaptureSeal.seal("bm90IGEga2V5", "id", payload.toByteArray())
        }
        val rsa = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        assertThrows(CaptureSeal.InvalidCaptureKeyException::class.java) {
            CaptureSeal.seal(Base64.encode(rsa.public.encoded), "id", payload.toByteArray())
        }
    }

    /** Independent open side, as capture-open.ts implements it. */
    private fun open(user: ECPrivateKey, userPublic: ECPublicKey, itemId: String, sealed: String): String {
        val bytes = Base64.decode(sealed)
        assertEquals(1.toByte(), bytes[0])
        val eph = bytes.copyOfRange(1, 66)
        val iv = bytes.copyOfRange(66, 78)
        val ephKey = KeyFactory.getInstance("EC").generatePublic(
            ECPublicKeySpec(
                ECPoint(BigInteger(1, eph.copyOfRange(1, 33)), BigInteger(1, eph.copyOfRange(33, 65))),
                userPublic.params,
            ),
        )
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(user)
        agreement.doPhase(ephKey, true)
        val prk = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(ByteArray(32), "HmacSHA256"))
            doFinal(agreement.generateSecret())
        }
        val userPoint = byteArrayOf(4) + CaptureSeal.fixedLength(userPublic.w.affineX) +
            CaptureSeal.fixedLength(userPublic.w.affineY)
        val key = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(prk, "HmacSHA256"))
            update("sp-capture-v1".toByteArray() + eph + userPoint)
            update(1)
            doFinal()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(byteArrayOf(1) + itemId.toByteArray())
        return String(cipher.doFinal(bytes.copyOfRange(78, bytes.size)), Charsets.UTF_8)
    }
}
