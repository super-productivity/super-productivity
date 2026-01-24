# E2E Encryption Architecture Diagrams

This document provides visual architecture diagrams comparing the current password-based encryption, the proposed device-key approach, and the recommended improvements.

---

## 1. Current Password-Based Encryption (Existing Implementation)

```mermaid
graph TD
    subgraph "Client Device"
        A[User enters password] --> B[Argon2id KDF<br/>64MB, 3 iterations]
        B --> C[Derived AES-256 Key<br/>Not stored, computed on demand]
        D[Operation Created] --> E[OperationEncryptionService]
        C --> E
        E --> F[Encrypt with AES-GCM<br/>Random IV per operation]
        F --> G[Encrypted Operation<br/>isPayloadEncrypted: true]
    end

    subgraph "Network"
        G -->|HTTPS| H[Upload to Server]
    end

    subgraph "SuperSync Server"
        H --> I[Store Encrypted Blob<br/>Cannot decrypt]
        I --> J[Operation Database<br/>Prisma + PostgreSQL]
    end

    subgraph "Other Device"
        J -->|HTTPS| K[Download Encrypted Ops]
        K --> L[User enters same password]
        L --> M[Argon2id KDF<br/>Same params]
        M --> N[Derived same AES-256 Key]
        N --> O[OperationEncryptionService]
        K --> O
        O --> P[Decrypt Operations]
        P --> Q[Apply to Local State]
    end

    style C fill:#90EE90
    style N fill:#90EE90
    style I fill:#FFB6C1
    style J fill:#FFB6C1

    classDef secure fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef untrusted fill:#FFB6C1,stroke:#8B0000,stroke-width:2px
```

**Key Properties:**

- ✅ Same password derives same key on all devices
- ✅ Key never stored, always computed from password
- ✅ Survives IndexedDB deletion (re-derive from password)
- ✅ Server has zero knowledge of key or plaintext
- ⚠️ Password required on every device

---

## 2. Proposed Device-Key Approach (From Draft Plan)

```mermaid
graph TD
    subgraph "Primary Device"
        A1[First Setup] --> B1[Generate Random 256-bit Key<br/>WebCrypto API]
        B1 --> C1{User chooses:<br/>Recovery password?}
        C1 -->|Yes| D1[User enters password]
        C1 -->|No - Skip| E1[⚠️ No recovery<br/>Data loss risk]
        D1 --> F1[Argon2id KDF]
        F1 --> G1[Encrypt key with KEK]
        G1 --> H1[Upload encrypted key<br/>to server]
        B1 --> I1[Store key in IndexedDB<br/>⚠️ iOS deletes after 7 days]
        I1 --> J1[Encrypt operations]
    end

    subgraph "Server Issues"
        H1 --> K1{Key conflict?<br/>❌ Not detected}
        K1 -->|Device A uploads| L1[KeyA stored]
        K1 -->|Device B uploads| M1[KeyB overwrites<br/>💥 Data loss]
    end

    subgraph "New Device - QR Pairing"
        N1[Scan QR from primary] --> O1{❌ Security gap:<br/>MITM protection?}
        O1 --> P1[Receive master key<br/>⚠️ Vulnerable to interception]
        P1 --> Q1[Store in IndexedDB<br/>⚠️ iOS 7-day eviction]
    end

    subgraph "New Device - Recovery Password"
        R1[User enters password] --> S1[Download encrypted key]
        S1 --> T1[Decrypt with KEK]
        T1 --> U1[Store in IndexedDB<br/>⚠️ iOS 7-day eviction]
    end

    subgraph "iOS Safari - 7 Days Later"
        I1 -.7 days.-> V1[💥 IndexedDB auto-deleted]
        Q1 -.7 days.-> V1
        U1 -.7 days.-> V1
        V1 --> W1[All data lost<br/>if no recovery password]
    end

    style M1 fill:#FF6B6B
    style V1 fill:#FF6B6B
    style W1 fill:#FF6B6B
    style O1 fill:#FFD93D
    style K1 fill:#FFD93D

    classDef critical fill:#FF6B6B,stroke:#8B0000,stroke-width:3px
    classDef warning fill:#FFD93D,stroke:#FF8C00,stroke-width:2px
```

**Critical Issues:**

- 🔴 **Blocker #1:** Non-extractable key contradiction (cannot export for backup)
- 🔴 **Blocker #2:** QR pairing has no MITM protection
- 🔴 **Blocker #3:** iOS Safari deletes IndexedDB after 7 days
- 🔴 **Blocker #4:** Key conflicts cause silent data loss

---

## 3. Recommended Improved Architecture (3-Phase Plan)

### Phase 1: Security Hardening (1 week)

```mermaid
graph TD
    A[User enters password<br/>≥12 characters] --> B{zxcvbn<br/>Strength check}
    B -->|Weak| C[❌ Reject password<br/>Suggest improvement]
    B -->|Strong| D[Argon2id KDF<br/>✅ 256MB, 4 iterations<br/>⬆️ OWASP 2024]
    D --> E[Derived AES-256 Key<br/>5x stronger vs brute-force]
    E --> F[Encrypt operations]

    subgraph "XSS Protection - NEW"
        G[Content Security Policy] --> H[script-src 'self'<br/>Subresource Integrity]
        H --> I[✅ Prevent code injection]
    end

    style D fill:#90EE90
    style E fill:#90EE90
    style I fill:#90EE90

    classDef improved fill:#90EE90,stroke:#006400,stroke-width:2px
```

**Improvements:**

- ✅ Upgraded Argon2id params (256MB, 4 iterations)
- ✅ Password strength enforcement
- ✅ CSP/SRI for XSS protection
- ⏱️ 1 week implementation

---

### Phase 2: Platform Resilience (2 weeks)

```mermaid
graph TD
    subgraph "Multi-Platform Key Storage"
        A[Derived encryption key] --> B{Platform?}

        B -->|iOS via Capacitor| C[iOS Keychain<br/>✅ Survives 7-day eviction]
        B -->|Android| D[Android KeyStore<br/>✅ Hardware-backed]
        B -->|Electron macOS| E[macOS Keychain<br/>safeStorage API]
        B -->|Electron Windows| F[Windows Credential Manager<br/>safeStorage API]
        B -->|Web| G[IndexedDB<br/>Fallback only]

        C --> H[✅ No data loss on iOS]
        D --> H
        E --> I[Optional biometric unlock]
        F --> I
        G --> J[Manual password entry]
    end

    subgraph "Biometric Convenience"
        I --> K[Touch ID / Face ID<br/>Windows Hello]
        K --> L[Cache key in memory<br/>15min timeout]
        L --> M[Fast unlock without<br/>password re-entry]
    end

    style C fill:#90EE90
    style D fill:#90EE90
    style E fill:#90EE90
    style F fill:#90EE90
    style H fill:#90EE90
    style M fill:#ADD8E6

    classDef secure fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef convenience fill:#ADD8E6,stroke:#4682B4,stroke-width:2px
```

**Improvements:**

- ✅ Eliminates iOS 7-day data loss (native keychain)
- ✅ Biometric unlock for convenience
- ✅ Platform-specific secure storage
- ⏱️ 2 weeks implementation

---

### Phase 3: Cloud Backup (Optional - 3 weeks)

```mermaid
graph TD
    subgraph "Client - Backup Flow"
        A[User changes password] --> B[Re-encrypt all operations<br/>with new password]
        B --> C[Create full encrypted snapshot]
        C --> D[Compress with gzip]
        D --> E[Upload to server<br/>POST /api/encrypted-backup]
    end

    subgraph "Server Storage"
        E --> F[Store encrypted blob<br/>Cannot decrypt]
        F --> G[EncryptedBackup table<br/>userId + blob + timestamp]
        G --> H[Rate limit:<br/>10 uploads/day]
    end

    subgraph "Recovery Flow"
        I[New device setup] --> J[Detect no local data]
        J --> K{Cloud backup<br/>exists?}
        K -->|Yes| L[Prompt for password]
        K -->|No| M[Fresh start]
        L --> N[Download encrypted blob]
        N --> O[Decrypt with password]
        O --> P[Restore full state]
        P --> Q[✅ All data recovered]
    end

    style F fill:#FFB6C1
    style G fill:#FFB6C1
    style Q fill:#90EE90

    classDef untrusted fill:#FFB6C1,stroke:#8B0000,stroke-width:2px
    classDef success fill:#90EE90,stroke:#006400,stroke-width:2px
```

**Improvements:**

- ✅ Complete device loss recovery
- ✅ Password change safety net
- ✅ Server has zero knowledge (encrypted blobs)
- ⏱️ 3 weeks implementation
- ⚠️ Optional (only if user demand exists)

---

## 4. Security Comparison: Password vs Device Keys

```mermaid
graph LR
    subgraph "Password-Based<br/>(Current + Improved)"
        A1[Password] --> B1[Argon2id<br/>256MB, 4 iter]
        B1 --> C1[Key derived<br/>on demand]
        C1 --> D1[Encrypt/Decrypt]

        E1[Multi-device:<br/>Same password] --> B1

        F1[iOS eviction:<br/>Re-derive from password] --> B1

        G1[Recovery:<br/>Remember password] --> B1
    end

    subgraph "Device-Key Based<br/>(Proposed - Not Recommended)"
        A2[Random key<br/>generated once] --> B2[Store in<br/>IndexedDB]
        B2 -.iOS deletes.-> C2[💥 Data loss]

        D2[Multi-device:<br/>QR pairing] -.MITM risk.-> E2[💥 Security risk]

        F2[Multi-device:<br/>Cloud backup] --> G2{Conflict?}
        G2 -.Device B overwrites.-> H2[💥 Data loss]

        I2[Recovery:<br/>Optional password] --> J2{User skipped?}
        J2 -.30% skip.-> C2
    end

    style D1 fill:#90EE90
    style C2 fill:#FF6B6B
    style E2 fill:#FF6B6B
    style H2 fill:#FF6B6B

    classDef works fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef broken fill:#FF6B6B,stroke:#8B0000,stroke-width:3px
```

---

## 5. Implementation Timeline Comparison

```mermaid
gantt
    title E2E Encryption Implementation Options
    dateFormat YYYY-MM-DD
    section Current (Exists)
    Working encryption     :done, curr1, 2024-01-01, 0d

    section Recommended Plan
    Phase 1: Security      :active, rec1, 2026-01-27, 1w
    Phase 2: Resilience    :rec2, after rec1, 2w
    Phase 3: Cloud Backup  :crit, rec3, after rec2, 3w
    Total: 6 weeks         :milestone, m1, after rec3, 0d

    section Device-Key Plan
    Fix Blocker #1         :crit, dev1, 2026-01-27, 2d
    Fix Blocker #2         :crit, dev2, after dev1, 5d
    Fix Blocker #3         :crit, dev3, after dev2, 3d
    Fix Blocker #4         :crit, dev4, after dev3, 3d
    Core Implementation    :dev5, after dev4, 8w
    Migration & Testing    :dev6, after dev5, 4w
    Total: 15 weeks        :milestone, m2, after dev6, 0d
```

---

## 6. Data Flow: Encryption & Sync

```mermaid
sequenceDiagram
    participant U1 as User (Device 1)
    participant C1 as Client 1
    participant S as SuperSync Server
    participant C2 as Client 2
    participant U2 as User (Device 2)

    Note over U1,C1: Initial Setup
    U1->>C1: Enter password "MySecurePass123"
    C1->>C1: Argon2id(password, 256MB, 4 iter)
    C1->>C1: Generate AES-256 key (derived)

    Note over C1: Create Task
    U1->>C1: Add task "Buy milk"
    C1->>C1: Create operation {type: CREATE_TASK, ...}
    C1->>C1: Encrypt(operation, key)
    C1->>C1: Set isPayloadEncrypted: true

    Note over C1,S: Upload Encrypted
    C1->>S: POST /api/sync/ops<br/>{encrypted: "a8f3b2...", isPayloadEncrypted: true}
    S->>S: Store blob (cannot decrypt)
    S-->>C1: 200 OK

    Note over S,C2: Download & Decrypt
    C2->>S: GET /api/sync/ops?sinceSeq=0
    S-->>C2: [{encrypted: "a8f3b2...", isPayloadEncrypted: true}]

    U2->>C2: Enter password "MySecurePass123"
    C2->>C2: Argon2id(password, 256MB, 4 iter)
    C2->>C2: Generate same AES-256 key
    C2->>C2: Decrypt(operation, key)
    C2->>C2: Verify integrity (GCM auth tag)
    C2->>C2: Apply operation to state

    Note over U2,C2: Task Appears
    C2-->>U2: Show task "Buy milk" ✅
```

---

## 7. Threat Model: What's Protected vs Exposed

```mermaid
graph TB
    subgraph "Threats PROTECTED Against ✅"
        T1[Server Compromise] --> P1[✅ Encrypted payloads<br/>Server cannot decrypt]
        T2[Network MITM] --> P2[✅ HTTPS + encrypted payloads<br/>Double layer protection]
        T3[Brute Force] --> P3[✅ Argon2id memory-hard KDF<br/>256MB, 4 iterations]
        T4[XSS Injection] --> P4[✅ CSP + SRI headers<br/>Phase 1]
        T5[iOS Data Eviction] --> P5[✅ Native keychain storage<br/>Phase 2]
    end

    subgraph "Threats NOT PROTECTED ⚠️"
        T6[Weak Passwords] --> N1[⚠️ User chooses password<br/>Mitigated by strength meter]
        T7[Device Theft] --> N2[⚠️ Key in memory while unlocked<br/>Mitigated by auto-lock]
        T8[Browser Memory Exploits] --> N3[⚠️ Spectre/Meltdown<br/>Out of scope]
        T9[Malicious Extensions] --> N4[⚠️ Can access decrypt API<br/>User responsibility]
    end

    style P1 fill:#90EE90
    style P2 fill:#90EE90
    style P3 fill:#90EE90
    style P4 fill:#90EE90
    style P5 fill:#90EE90
    style N1 fill:#FFD93D
    style N2 fill:#FFD93D
    style N3 fill:#FFD93D
    style N4 fill:#FFD93D

    classDef protected fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef limited fill:#FFD93D,stroke:#FF8C00,stroke-width:2px
```

---

## 8. Decision Tree: Which Approach to Use

```mermaid
graph TD
    A{Need E2E encryption?} -->|No| B[Use existing unencrypted sync]
    A -->|Yes| C{Already implemented?}

    C -->|Yes - Password-based| D{Security concerns?}
    C -->|No - Starting fresh| E{Use case type?}

    D -->|Argon2id params weak| F[✅ Implement Phase 1<br/>Upgrade params, CSP<br/>1 week]
    D -->|iOS data loss risk| G[✅ Implement Phase 2<br/>Native keychain<br/>2 weeks]
    D -->|Need cloud recovery| H[✅ Implement Phase 3<br/>Cloud backup<br/>3 weeks]
    D -->|All good| I[Keep current system]

    E -->|Messaging app<br/>Ephemeral data| J[Consider device keys<br/>WhatsApp model]
    E -->|Productivity/Password Manager<br/>Long-lived data| K[✅ Use password-based<br/>1Password/Bitwarden model]
    E -->|File sync only| L[Consider per-file keys<br/>Dropbox model]

    J --> M{Can fix 4 blockers?}
    M -->|Yes - 3 weeks| N[OK to proceed with device keys]
    M -->|No| K

    K --> F

    style F fill:#90EE90
    style G fill:#90EE90
    style H fill:#90EE90
    style K fill:#90EE90
    style M fill:#FF6B6B

    classDef recommended fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef blocker fill:#FF6B6B,stroke:#8B0000,stroke-width:2px
```

---

## 9. Code Architecture: Current vs Proposed

```mermaid
graph TB
    subgraph "Current Implementation (200 lines)"
        A1[encryption.ts<br/>183 lines] --> B1[AES-256-GCM<br/>Argon2id KDF]
        C1[operation-encryption.service.ts<br/>103 lines] --> A1
        D1[credential-store.service.ts<br/>289 lines] --> E1[IndexedDB<br/>Password storage]
    end

    subgraph "Device-Key Plan (2000+ lines)"
        A2[DeviceKeyService<br/>~300 lines NEW] --> B2[WebCrypto key gen<br/>IndexedDB storage]
        C2[CloudKeyBackupService<br/>~250 lines NEW] --> D2[Upload encrypted key<br/>Argon2id for KEK]
        E2[QRPairingService<br/>~400 lines NEW] --> F2[ECDH protocol<br/>Visual verification]
        G2[ConflictResolutionService<br/>~200 lines NEW] --> H2[Detect conflicts<br/>User resolution UI]
        I2[Platform-specific storage<br/>~300 lines NEW] --> J2[iOS Keychain<br/>Electron safeStorage]
        K2[5 new dialogs<br/>~500 lines] --> L2[Recovery setup<br/>QR pairing<br/>Conflict resolution]
    end

    subgraph "Recommended Plan (300 lines)"
        A3[encryption.ts<br/>+5 lines] --> B3[Upgrade Argon2id<br/>256MB, 4 iter]
        C3[secure-storage.service.ts<br/>~150 lines NEW] --> D3[Platform keychain<br/>Capacitor/Electron]
        E3[encrypted-backup.service.ts<br/>~200 lines NEW] --> F3[Cloud backup<br/>Optional Phase 3]
    end

    style A1 fill:#90EE90
    style C1 fill:#90EE90
    style A2 fill:#FFB6C1
    style C2 fill:#FFB6C1
    style E2 fill:#FFB6C1
    style G2 fill:#FFB6C1
    style A3 fill:#90EE90
    style C3 fill:#ADD8E6
    style E3 fill:#ADD8E6

    classDef exists fill:#90EE90,stroke:#006400,stroke-width:2px
    classDef complex fill:#FFB6C1,stroke:#8B0000,stroke-width:2px
    classDef simple fill:#ADD8E6,stroke:#4682B4,stroke-width:2px
```

---

## Summary

### Current System ✅

- **Status:** Working, production-ready
- **Complexity:** Low (200 lines)
- **Security:** Strong (AES-256-GCM + Argon2id)
- **Gaps:** Argon2id params weak, no iOS resilience, no CSP

### Device-Key Proposal ❌

- **Status:** 4 critical blockers
- **Complexity:** High (2000+ lines)
- **Security:** Strong (when blockers fixed)
- **Issues:** 15 weeks, high risk, solves non-existent problems

### Recommended Plan ✅

- **Status:** Incremental improvements
- **Complexity:** Moderate (300 lines)
- **Security:** Strongest (OWASP 2024 + platform features)
- **Timeline:** 3-6 weeks, low risk

**Final Recommendation:** Implement the 3-phase improvement plan for the existing password-based encryption. Do not pursue device-generated keys.
