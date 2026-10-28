package com.superproductivity.superproductivity.crypto

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.io.encoding.Base64

/**
 * Seals a capture on the device to the account's capture public key, so the
 * SuperSync server only ever stores ciphertext (Android share,
 * docs/plans/2026-10-24-android-share-capture.md).
 *
 * Must match packages/super-sync-server/src/capture/capture-seal.ts and the
 * app's open side (packages/sync-core/src/encryption/capture-open.ts) byte for
 * byte; CaptureSealTest pins the same vector as their specs.
 *
 * Wire, base64: [0x01][ephemeral public key, SEC1 uncompressed, 65][iv, 12][ciphertext ‖ tag, 16].
 * Key: HKDF-SHA-256(ECDH(ephemeral, user), salt = empty,
 *      info = "sp-capture-v1" ‖ ephemeral key ‖ user key (both SEC1 uncompressed)), 32 bytes.
 * Cipher: AES-256-GCM, AAD = 0x01 ‖ UTF-8 item id.
 */
object CaptureSeal {
    private const val SEAL_VERSION: Byte = 0x01
    private const val INFO_LABEL = "sp-capture-v1"
    private const val COORDINATE_BYTES = 32
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private val random = SecureRandom()

    class InvalidCaptureKeyException(message: String) : Exception(message)

    /** Base64url SHA-256 of the SPKI DER bytes, no padding; what the server compares. */
    fun fingerprint(publicKeySpkiBase64: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(Base64.decode(publicKeySpkiBase64))
        return Base64.UrlSafe.encode(digest).trimEnd('=')
    }

    /** Seals [plaintext] (the UTF-8 JSON payload) for item [itemId]. */
    fun seal(publicKeySpkiBase64: String, itemId: String, plaintext: ByteArray): String {
        val userKey = parsePublicKey(publicKeySpkiBase64)
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), random)
        val ephemeral = generator.generateKeyPair()
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        return seal(
            userKey,
            ephemeral.private,
            sec1(ephemeral.public as ECPublicKey),
            iv,
            itemId,
            plaintext,
        )
    }

    /** Deterministic core; the test passes a fixed ephemeral key and IV. */
    internal fun seal(
        userKey: ECPublicKey,
        ephemeralPrivate: PrivateKey,
        ephemeralPoint: ByteArray,
        iv: ByteArray,
        itemId: String,
        plaintext: ByteArray,
    ): String {
        val userPoint = sec1(userKey)
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(ephemeralPrivate)
        agreement.doPhase(userKey, true)
        val key = hkdf(
            agreement.generateSecret(),
            INFO_LABEL.toByteArray(Charsets.UTF_8) + ephemeralPoint + userPoint,
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(TAG_BITS, iv),
        )
        cipher.updateAAD(byteArrayOf(SEAL_VERSION) + itemId.toByteArray(Charsets.UTF_8))
        // JCA appends the tag to the ciphertext, as the wire wants it.
        val body = cipher.doFinal(plaintext)
        return Base64.encode(byteArrayOf(SEAL_VERSION) + ephemeralPoint + iv + body)
    }

    internal fun parsePublicKey(publicKeySpkiBase64: String): ECPublicKey {
        val key: PublicKey = try {
            KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(Base64.decode(publicKeySpkiBase64)))
        } catch (e: Exception) {
            throw InvalidCaptureKeyException("Not a valid SPKI public key")
        }
        if (key !is ECPublicKey || key.params.curve.field.fieldSize != 256) {
            throw InvalidCaptureKeyException("Capture key must be an ECDH P-256 key")
        }
        return key
    }

    /** SEC1 uncompressed point: 0x04 ‖ x ‖ y, each exactly 32 bytes. */
    internal fun sec1(key: ECPublicKey): ByteArray =
        byteArrayOf(0x04) + fixedLength(key.w.affineX) + fixedLength(key.w.affineY)

    /**
     * BigInteger.toByteArray() is minimal two's complement: a leading 0x00 when
     * the top bit is set, fewer bytes when the value is small.
     */
    internal fun fixedLength(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        return when {
            bytes.size == COORDINATE_BYTES -> bytes
            bytes.size > COORDINATE_BYTES -> bytes.copyOfRange(bytes.size - COORDINATE_BYTES, bytes.size)
            else -> ByteArray(COORDINATE_BYTES - bytes.size) + bytes
        }
    }

    /**
     * RFC 5869 with an empty salt, which HMAC treats as HashLen zero bytes
     * (JCA's SecretKeySpec rejects an empty key). One output block: 32 bytes.
     */
    private fun hkdf(sharedSecret: ByteArray, info: ByteArray): ByteArray {
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(ByteArray(32), "HmacSHA256"))
        val prk = extract.doFinal(sharedSecret)
        val expand = Mac.getInstance("HmacSHA256")
        expand.init(SecretKeySpec(prk, "HmacSHA256"))
        expand.update(info)
        expand.update(1.toByte())
        return expand.doFinal()
    }
}
