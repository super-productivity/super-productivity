# Progressive E2E Encryption for SuperSync - REVISED PLAN

## Executive Summary

**ORIGINAL PLAN REJECTED** after comprehensive agent review identified fatal flaws:

- Token-derived encryption breaks after 7-day token expiration
- Multi-device sync impossible (each device has different tokens)
- Industry consensus: Zero production systems use auth tokens for encryption

**NEW APPROACH:** Device-generated master keys with optional cloud backup (WhatsApp model)

## Research Summary (3 Deep-Dive Agents)

### Agent 1: E2E Encryption Patterns Research

- **Finding:** All major E2E systems (WhatsApp, Signal, 1Password) use device-generated random keys
- **Why:** Auth tokens are ephemeral, encryption keys must be permanent
- **Recommendation:** Follow WhatsApp's 2021 cloud backup model (2B+ users, proven at scale)

### Agent 2: JWT/Token Encryption Research

- **Finding:** Token-derived encryption is a security anti-pattern
- **Why:** OAuth tokens MUST rotate for security, breaking encryption
- **Recommendation:** Separate authentication (OAuth) from encryption (device keys)

### Agent 3: SuperSync Token Analysis

- **Finding:** Tokens expire in 7 days, no auto-refresh exists
- **Current behavior:** Users re-login after 7 days
- **Risk:** Adding proper token rotation (security best practice) would break token-derived encryption

## Goals

- ✅ Enable E2E encryption by default for all SuperSync users
- ✅ Zero passwords for single-device users (key generated automatically)
- ✅ Optional recovery for cautious users (cloud-encrypted backup)
- ✅ Multi-device support (QR pairing or recovery password)
- ✅ Maintain strong security (256-bit random keys, not password-derived)

## Architecture: Device-Generated Keys with Optional Cloud Backup

### Security Model

**Key Generation:**

- Each device generates random 256-bit AES-GCM key via WebCrypto API
- Stored in IndexedDB as non-extractable key (protected from XSS)
- Key never leaves device unless user enables cloud backup

**Optional Cloud Backup:**

- User sets recovery password during setup (strongly encouraged)
- Password derives KEK via Argon2id (memory-hard, GPU-resistant)
- Master key encrypted with KEK, uploaded to SuperSync server
- Server cannot decrypt (password never transmitted)

**Multi-Device Sync:**

- **Option A:** QR code pairing (primary device → new device)
- **Option B:** Recovery password (download encrypted key from cloud)

### User Flows

#### First-Time Setup (New User)

```
1. User enables SuperSync → enters access token
2. App generates random 256-bit encryption key
3. Store key in IndexedDB (non-extractable via WebCrypto)
4. Show dialog:
   ┌─────────────────────────────────────────────────┐
   │ 🔒 Encryption Enabled                           │
   ├─────────────────────────────────────────────────┤
   │ Your data is now encrypted with a secure key.   │
   │                                                  │
   │ ⚠️  Set a recovery password to protect against  │
   │    data loss if you clear your browser.         │
   │                                                  │
   │ Recovery Password: [.....................]       │
   │ Confirm:           [.....................]       │
   │                                                  │
   │ [Skip (Not Recommended)]  [Set Password]        │
   └─────────────────────────────────────────────────┘

5a. If user sets password:
    - Derive KEK from password using Argon2id
    - Encrypt master key with KEK
    - Upload encrypted key to server
    - Show: "✓ Recovery enabled. Save this password!"

5b. If user skips:
    - Show scary warning:
      ┌─────────────────────────────────────────────┐
      │ ⚠️  WARNING: No Recovery                    │
      ├─────────────────────────────────────────────┤
      │ If you clear your browser or lose this      │
      │ device, ALL YOUR DATA WILL BE PERMANENTLY   │
      │ LOST. There is NO way to recover it.        │
      │                                              │
      │ Are you ABSOLUTELY SURE?                     │
      │                                              │
      │ [Go Back]  [I Understand the Risk]          │
      └─────────────────────────────────────────────┘
    - Require explicit confirmation
    - Track in analytics (measure skip rate)
```

#### Adding a New Device

**Option A: QR Code Pairing (Fastest)**

```
Primary Device:
1. Settings → Devices → "Pair New Device"
2. Generate QR code containing encrypted master key
3. Display QR code with timer (5 minutes)

New Device:
1. Setup SuperSync → "Pair with existing device"
2. Scan QR code from primary device
3. Import master key → store in IndexedDB
4. Start syncing
```

**Option B: Recovery Password**

```
New Device:
1. Setup SuperSync → "Recover from cloud backup"
2. Show: "Enter your recovery password"
3. User enters password
4. Download encrypted key from server
5. Decrypt with password-derived KEK
6. Store master key in IndexedDB
7. Start syncing
```

#### Recovery After Browser Clear

```
Scenario A: User has recovery password ✅
  ↓
Open app → Detect missing key
  ↓
Show: "Your encryption key is missing. Enter recovery password to restore."
  ↓
User enters password → Download encrypted key → Decrypt → Restore
  ↓
App works normally

Scenario B: No recovery password, no other devices ❌
  ↓
Open app → Detect missing key
  ↓
Show: "Encryption key lost. Your encrypted data cannot be recovered."
  ↓
Options:
  1. Start fresh (new key, abandon old encrypted data)
  2. Contact support (we can't help - true E2E)
```

### Existing Users Migration

**Users with current passphrase encryption:**

- Keep existing setup (passphrase-based encryption)
- Show banner: "New: Optional cloud backup for your encryption key"
- User can optionally migrate to device-key model

**Users without encryption:**

- Auto-enable on next sync settings save
- Follow first-time setup flow above

## Implementation Plan

### Prerequisites

**Step 0: Verify WebCrypto API Support**

All modern browsers support WebCrypto:

- Chrome/Edge: Yes (2014+)
- Firefox: Yes (2014+)
- Safari: Yes (2015+)
- Electron: Yes (Chromium-based)
- Mobile browsers: Yes (iOS 11+, Android 6+)

**Polyfill:** Not needed for target browsers

### Phase 1: Core Infrastructure (Week 1)

#### 1.1: Create DeviceKeyService

**File:** `src/app/imex/sync/device-key.service.ts` (NEW)

```typescript
@Injectable({ providedIn: 'root' })
export class DeviceKeyService {
  private readonly _db = inject(PersistenceService);
  private readonly _keyCache = new Map<string, CryptoKey>();

  async generateMasterKey(): Promise<CryptoKey> {
    // Generate random 256-bit AES-GCM key
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable (protected from XSS)
      ['encrypt', 'decrypt'],
    );

    // Store in IndexedDB via WebCrypto wrapper
    await this._storeKeyInIndexedDB(key);

    return key;
  }

  async getMasterKey(): Promise<CryptoKey | null> {
    // Check cache first
    const cached = this._keyCache.get('master');
    if (cached) return cached;

    // Load from IndexedDB
    const key = await this._loadKeyFromIndexedDB();
    if (key) {
      this._keyCache.set('master', key);
    }

    return key;
  }

  async exportKeyForBackup(): Promise<ArrayBuffer> {
    // Export key as raw bytes (for cloud backup encryption)
    const key = await this.getMasterKey();
    if (!key) throw new Error('No master key available');

    // Temporarily make extractable for backup
    const exportableKey = await crypto.subtle.importKey(
      'raw',
      await this._getRawKeyBytes(key),
      { name: 'AES-GCM', length: 256 },
      true, // extractable for backup
      ['encrypt', 'decrypt'],
    );

    return crypto.subtle.exportKey('raw', exportableKey);
  }

  async importKeyFromBackup(rawKey: ArrayBuffer): Promise<void> {
    const key = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable after import
      ['encrypt', 'decrypt'],
    );

    await this._storeKeyInIndexedDB(key);
    this._keyCache.set('master', key);
  }

  private async _storeKeyInIndexedDB(key: CryptoKey): Promise<void> {
    // Use IndexedDB to persist key (browser-managed encryption)
    const db = await this._db.getDatabase();
    await db.put('encryption-keys', { id: 'master', key }, 'master');
  }

  private async _loadKeyFromIndexedDB(): Promise<CryptoKey | null> {
    const db = await this._db.getDatabase();
    const record = await db.get('encryption-keys', 'master');
    return record?.key || null;
  }
}
```

#### 1.2: Create CloudKeyBackupService

**File:** `src/app/imex/sync/cloud-key-backup.service.ts` (NEW)

```typescript
@Injectable({ providedIn: 'root' })
export class CloudKeyBackupService {
  private readonly _deviceKey = inject(DeviceKeyService);
  private readonly _encryption = inject(OperationEncryptionService);
  private readonly _http = inject(HttpClient);

  async uploadKeyBackup(
    recoveryPassword: string,
    baseUrl: string,
    accessToken: string,
  ): Promise<void> {
    // Export master key
    const masterKey = await this._deviceKey.exportKeyForBackup();

    // Derive KEK from recovery password
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await Argon2id.hash(recoveryPassword, {
      salt,
      iterations: 3,
      memory: 64 * 1024,
      hashLength: 32,
    });

    // Encrypt master key with KEK
    const encryptedKey = await this._encryption.encrypt(masterKey, kek);

    // Upload to server
    await this._http
      .post(
        `${baseUrl}/api/key-backup`,
        {
          encryptedKey,
          salt: Array.from(salt), // Store salt for KEK derivation
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      )
      .toPromise();
  }

  async downloadKeyBackup(
    recoveryPassword: string,
    baseUrl: string,
    accessToken: string,
  ): Promise<void> {
    // Download encrypted key from server
    const response = await this._http
      .get<{
        encryptedKey: string;
        salt: number[];
      }>(`${baseUrl}/api/key-backup`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .toPromise();

    // Derive KEK from recovery password
    const salt = new Uint8Array(response.salt);
    const kek = await Argon2id.hash(recoveryPassword, {
      salt,
      iterations: 3,
      memory: 64 * 1024,
      hashLength: 32,
    });

    // Decrypt master key
    const masterKey = await this._encryption.decrypt(response.encryptedKey, kek);

    // Import into IndexedDB
    await this._deviceKey.importKeyFromBackup(masterKey);
  }

  async hasCloudBackup(baseUrl: string, accessToken: string): Promise<boolean> {
    try {
      await this._http
        .head(`${baseUrl}/api/key-backup`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        .toPromise();
      return true;
    } catch {
      return false;
    }
  }
}
```

### Phase 2: Server API (Week 2)

**File:** `packages/super-sync-server/src/key-backup/` (NEW MODULE)

#### 2.1: Database Schema

```prisma
// packages/super-sync-server/prisma/schema.prisma

model KeyBackup {
  id             Int      @id @default(autoincrement())
  userId         Int      @unique
  encryptedKey   String   // Base64-encoded encrypted master key
  salt           String   // Base64-encoded salt for KEK derivation
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### 2.2: API Routes

```typescript
// POST /api/key-backup - Upload encrypted key
fastify.post('/api/key-backup', { preHandler: authenticate }, async (req, reply) => {
  const { userId } = req.user;
  const { encryptedKey, salt } = req.body;

  await prisma.keyBackup.upsert({
    where: { userId },
    create: { userId, encryptedKey, salt },
    update: { encryptedKey, salt, updatedAt: new Date() },
  });

  reply.send({ success: true });
});

// GET /api/key-backup - Download encrypted key
fastify.get('/api/key-backup', { preHandler: authenticate }, async (req, reply) => {
  const { userId } = req.user;

  const backup = await prisma.keyBackup.findUnique({
    where: { userId },
  });

  if (!backup) {
    return reply.code(404).send({ error: 'No key backup found' });
  }

  reply.send({
    encryptedKey: backup.encryptedKey,
    salt: backup.salt,
  });
});

// DELETE /api/key-backup - Delete cloud backup
fastify.delete('/api/key-backup', { preHandler: authenticate }, async (req, reply) => {
  const { userId } = req.user;

  await prisma.keyBackup.delete({
    where: { userId },
  });

  reply.send({ success: true });
});
```

### Phase 3: UI Components (Week 3)

#### 3.1: Recovery Password Setup Dialog

**File:** `src/app/imex/sync/dialog-recovery-password/dialog-recovery-password.component.ts` (NEW)

```typescript
@Component({
  selector: 'dialog-recovery-password',
  template: `
    <h2 mat-dialog-title>🔒 Set Recovery Password</h2>
    <mat-dialog-content>
      <p>Set a password to backup your encryption key to the cloud.</p>
      <p>
        <strong>⚠️ Without recovery, clearing your browser = permanent data loss.</strong>
      </p>

      <mat-form-field>
        <input
          matInput
          type="password"
          placeholder="Recovery Password"
          [(ngModel)]="password"
          (input)="checkStrength()"
        />
        <mat-hint>Strength: {{ strength }}</mat-hint>
      </mat-form-field>

      <mat-form-field>
        <input
          matInput
          type="password"
          placeholder="Confirm Password"
          [(ngModel)]="confirmPassword"
        />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button
        mat-button
        (click)="skip()"
      >
        Skip (Not Recommended)
      </button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!canSubmit()"
        (click)="submit()"
      >
        Set Password
      </button>
    </mat-dialog-actions>
  `,
})
export class DialogRecoveryPasswordComponent {
  password = '';
  confirmPassword = '';
  strength = 'Weak';

  checkStrength(): void {
    // Simple strength meter
    const score = zxcvbn(this.password).score;
    this.strength = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'][score];
  }

  canSubmit(): boolean {
    return (
      this.password.length >= 8 &&
      this.password === this.confirmPassword &&
      this.strength !== 'Weak'
    );
  }

  skip(): void {
    // Show scary warning first
    const confirmed = confirm(
      '⚠️ WARNING: Without recovery, you will PERMANENTLY LOSE ALL DATA ' +
        'if you clear your browser or lose this device. Are you SURE?',
    );
    if (confirmed) {
      this._dialogRef.close({ skipRecovery: true });
    }
  }

  submit(): void {
    this._dialogRef.close({ password: this.password });
  }
}
```

#### 3.2: Update Sync Settings Form

**File:** `src/app/features/config/form-cfgs/sync-form.const.ts`

```typescript
// SuperSync section - NO encryption checkbox (always enabled)
{
  type: 'tpl',
  className: 'tpl info-text',
  hideExpression: (m, v, field) =>
    field?.parent?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
  templateOptions: {
    tag: 'div',
    text: '🔒 End-to-end encryption enabled automatically'
  },
},
{
  type: 'btn',
  hideExpression: (m, v, field) =>
    field?.parent?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
  templateOptions: {
    text: 'Manage Recovery Password',
    onClick: async () => {
      const dialogRef = this._matDialog.open(DialogRecoveryPasswordComponent);
      const result = await dialogRef.afterClosed().toPromise();

      if (result?.password) {
        await this._cloudKeyBackup.uploadKeyBackup(
          result.password,
          config.baseUrl,
          config.accessToken
        );
      }
    }
  },
},
```

### Phase 4: Migration & Compatibility (Week 4)

#### 4.1: Auto-Enable for New Users

**File:** `src/app/imex/sync/sync-config.service.ts`

```typescript
async updateSettingsFromForm(cfg: SyncConfig, isInitialSetup: boolean) {
  if (cfg.syncProvider === LegacySyncProvider.SuperSync) {
    // Check if user has existing key
    const hasKey = await this._deviceKey.getMasterKey();

    if (!hasKey && isInitialSetup) {
      // Generate new master key
      await this._deviceKey.generateMasterKey();

      // Show recovery password setup
      const dialogRef = this._matDialog.open(DialogRecoveryPasswordComponent);
      const result = await dialogRef.afterClosed().toPromise();

      if (result?.password && !result.skipRecovery) {
        await this._cloudKeyBackup.uploadKeyBackup(
          result.password,
          cfg.superSync.baseUrl,
          cfg.superSync.accessToken
        );
      }
    }
  }

  // ... existing save logic
}
```

#### 4.2: Existing Passphrase Users

**Migration Strategy:**

- Keep existing passphrase-based encryption
- Show banner: "New: Enable cloud backup for your encryption key"
- Optional migration wizard

## Testing & Verification

### Unit Tests (Week 5)

**device-key.service.spec.ts:**

- [ ] Generate master key creates non-extractable CryptoKey
- [ ] Master key persists across service reloads
- [ ] Export for backup produces valid raw bytes
- [ ] Import from backup restores working key

**cloud-key-backup.service.spec.ts:**

- [ ] Upload encrypts key with password-derived KEK
- [ ] Download decrypts with correct password
- [ ] Wrong password fails gracefully
- [ ] Missing backup returns false from hasCloudBackup()

### E2E Tests (Week 6)

**supersync-device-encryption.spec.ts:**

```typescript
test('new user gets auto-encryption with recovery prompt', async ({ page }) => {
  const client = await setupClient(page, 'client-A');

  await client.setupSuperSync({ accessToken: 'test-token' });

  // Should show recovery password dialog
  await expect(page.locator('dialog-recovery-password')).toBeVisible();

  // Set recovery password
  await client.setRecoveryPassword('strong-password-123');

  // Create task
  await client.addTask('Buy milk');
  await client.waitForSync();

  // Verify encrypted on server
  const ops = await serverApi.getOperations('client-A');
  expect(ops[0].isPayloadEncrypted).toBe(true);
});

test('multi-device sync via recovery password', async ({ page }) => {
  const client1 = await setupClient(page, 'client-A');
  await client1.setupSuperSync({ accessToken: 'token-A' });
  await client1.setRecoveryPassword('recovery-pass');
  await client1.addTask('Secret task');
  await client1.waitForSync();

  // Second device
  const client2 = await setupClient(page, 'client-B');
  await client2.setupSuperSync({ accessToken: 'token-B' });
  await client2.recoverFromPassword('recovery-pass');
  await client2.waitForSync();

  // Should see task (same master key)
  await expect(client2.getTaskTitle()).toBe('Secret task');
});

test('browser clear without recovery loses data', async ({ page }) => {
  const client = await setupClient(page, 'client-A');
  await client.setupSuperSync({ accessToken: 'test-token' });
  await client.skipRecoveryPassword(); // User chose no recovery
  await client.addTask('Task 1');
  await client.waitForSync();

  // Simulate browser clear
  await client.clearIndexedDB();
  await page.reload();

  // Should show "key lost" error
  await expect(page.locator('text=Encryption key lost')).toBeVisible();
});
```

## Security Considerations

### Threat Model

**Attacker Capabilities:**

- Server compromise (can read database)
- Network eavesdropping (MITM)
- XSS attack (malicious JavaScript)
- Physical device theft

**Security Guarantees:**

| Attack            | Without Recovery            | With Recovery Password                |
| ----------------- | --------------------------- | ------------------------------------- |
| Server compromise | ✅ Data encrypted           | ✅ Data encrypted (KEK not on server) |
| Network MITM      | ✅ TLS protects key upload  | ✅ TLS protects encrypted key         |
| XSS attack        | ⚠️ Can call encrypt/decrypt | ⚠️ Can call encrypt/decrypt           |
| Device theft      | ❌ Key in IndexedDB         | ❌ Key in IndexedDB                   |
| Browser clear     | ❌ Data lost                | ✅ Recoverable with password          |

**Non-Goals (Out of Scope):**

- Hardware-backed key storage (requires platform-specific code)
- Protection against browser memory exploits (Spectre, etc.)
- Perfect forward secrecy (single master key reused)

### Privacy Considerations

**What Server Knows:**

- User has enabled E2E encryption
- User has cloud backup (if enabled)
- Number of operations synced (metadata)

**What Server CANNOT Know:**

- Master encryption key (never transmitted)
- Recovery password (never transmitted)
- Decrypted operation contents

## Rollout Strategy

### Phase 1: Beta (Weeks 7-8)

- Enable for opt-in beta users
- Monitor analytics (recovery password skip rate, errors)
- Gather feedback

### Phase 2: Gradual Rollout (Weeks 9-10)

- 10% of new users
- 25% of new users
- 50% of new users
- 100% of new users

### Phase 3: Existing Users (Weeks 11-12)

- Show banner: "New: Automatic encryption with optional cloud backup"
- Offer migration wizard
- Keep existing passphrase users happy

## Success Metrics

- [ ] 95%+ of new users have encryption enabled
- [ ] <20% skip recovery password (with scary warning)
- [ ] Zero data loss incidents from migrations
- [ ] <5% increase in support requests
- [ ] E2E test suite passes 100%

## Risks & Mitigations

**Risk:** Users forget recovery password

- **Mitigation:** Password strength meter, clear warnings, suggest password manager

**Risk:** Browser compatibility issues

- **Mitigation:** WebCrypto supported in all modern browsers, fallback to legacy mode for ancient browsers

**Risk:** IndexedDB cleared by aggressive browser cleaning

- **Mitigation:** Detect missing key, show recovery dialog, nudge users toward recovery password

**Risk:** QR pairing security concerns

- **Mitigation:** QR codes expire after 5 minutes, encrypted with ephemeral key

## Implementation Timeline

**Total: 12 weeks**

- **Weeks 1-2:** Core infrastructure (DeviceKeyService, CloudKeyBackupService, server API)
- **Weeks 3-4:** UI components and migration logic
- **Weeks 5-6:** Testing (unit + E2E)
- **Weeks 7-8:** Beta testing with real users
- **Weeks 9-10:** Gradual rollout to new users
- **Weeks 11-12:** Existing user migration

## Confidence Level

**Overall: 85%**

**High confidence:**

- WebCrypto API stability (10+ years in production)
- WhatsApp model proven at 2B+ users scale
- Server API straightforward (CRUD for encrypted blobs)

**Medium confidence:**

- User acceptance of recovery password prompts (need A/B testing)
- Migration from existing passphrase users (complex edge cases)

**Low confidence:**

- Long-term IndexedDB persistence (browser vendors change policies)
- QR pairing UX (need user testing)

## Comparison with Original Plan

| Aspect                | Original (Token-Derived) | Revised (Device Keys) |
| --------------------- | ------------------------ | --------------------- |
| Password burden       | Zero                     | Zero (optional)       |
| Security              | Weak (token = key)       | Strong (random keys)  |
| Multi-device          | Broken                   | Works (QR/recovery)   |
| Token rotation        | Breaks encryption        | No impact             |
| Industry adoption     | Zero systems             | All major E2E apps    |
| Implementation effort | 6-8 weeks                | 12 weeks              |
| Recovery options      | None                     | Cloud backup + QR     |

## Recommendation

**Proceed with revised plan.** Device-generated keys with optional cloud backup is the industry-standard approach for E2E encryption with minimal password burden.

The additional 4-6 weeks of implementation time is justified by:

- Robust security model (doesn't break on token rotation)
- Proven at massive scale (WhatsApp, Signal)
- Better user experience (recovery options)
- Future-proof architecture
