package com.superproductivity.superproductivity.crypto

/**
 * Ciphertexts produced by the REAL JS encrypt() (packages/sync-core, Argon2id
 * + AES-256-GCM) with [PASSWORD] and distinct session salts — the shared
 * cross-language proof that the Kotlin side can read production op payloads.
 *
 * When the KDF parameters or wire format change, regenerate every constant
 * here together (see the contract note in
 * packages/sync-core/src/encryption/argon2.ts).
 */
object EncryptedOpFixtures {
    const val PASSWORD = "test-encryption-password-123"

    const val CRT_PLAINTEXT =
        "{\"actionPayload\":{},\"entityChanges\":[{\"entityType\":\"TASK\"," +
            "\"entityId\":\"task-crt-1\",\"opType\":\"CRT\",\"changes\":{" +
            "\"id\":\"task-crt-1\",\"title\":\"Water plants\"," +
            "\"remindAt\":4102444500000,\"deadlineRemindAt\":4102444700000}}]}"

    const val CRT_CIPHERTEXT =
        "yInMh3KUZFmkCS83epg2CtNuiIkgEa0YXB+kFt8WQ3sRR0a4Y4qJSLABI1u1vZ/7MMTjvm2lJRHP" +
            "+tyojvcwQHLRi3/AJNjuW6f2RlmiWd3BvseQ+6yohZHO1nLR6oST8bG+Z+8919wcgrR//qUxTDVi" +
            "v6LkuzfuPDTgxbReesJzu8H0KahiMK1iwHznRTB/FXHeBHh3agHu4B5i23VPRFLVHpFjyrbqRSje" +
            "Afhx07467A6Z0j4PYAHssN7jOBkMJOh6qA4M8kyMkc53h7R2Y77efjR6tL30wTaurg9IB3gNrySO" +
            "0rLBKV3dvRd9DjlQKIcNCDkFSaQJcu/tU7I="

    const val SCHEDULE_PLAINTEXT =
        "{\"actionPayload\":{\"task\":{\"id\":\"task-sched-1\",\"title\":\"Buy milk\"}," +
            "\"dueWithTime\":4102444800000,\"remindAt\":4102444200000},\"entityChanges\":[]}"

    const val SCHEDULE_CIPHERTEXT =
        "NZGjL4VYD9CYLgZql5KbDLKGIgXfko/I2n2ydKIu8MS6xrPmesgUIS4Vm5aOzZFL9ubGAQ1lqolm" +
            "D+WM/ORvX0SfQAHroLS9hovvqzh5mHFrrY75L/N//JWcLjPx1H+SY3gDTonXZD+fAxWVvmMUUOXt" +
            "lriaR2bztfF9yw3JvnmJEtJ6f7QpZ334czpvY0hg1wNaNDMs1aRNoSTXQD9+6qbWh3faDBShq78p" +
            "UHfyxJulwn+f5Nl2"

    const val DISMISS_CIPHERTEXT =
        "91DsnzZw6biDoWvY2a3R8WSZXwXu2+1jARKgfyA0PIlR3rN5cttbLFEFhf2ZX3vd5zc9kkJCnXyx" +
            "q/CjBd2f/QR+pEpEncU4atId6zYLK+UodKS0jhF76543enULpD8cDiyGBWqhlck="
}

class InMemoryKeyCache : DerivedKeyCache {
    val map = mutableMapOf<String, ByteArray>()
    var putCount = 0

    override fun get(saltB64: String): ByteArray? = map[saltB64]

    override fun put(saltB64: String, key: ByteArray) {
        putCount++
        map[saltB64] = key
    }
}
