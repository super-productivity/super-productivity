# Encryption Enable/Disable E2E Tests - Current Status

**Last Updated:** 2026-01-24
**Status:** ❌ ALL TESTS FAILING - Timing issue with provider config reload

## Overview

Created 4 comprehensive E2E tests to verify clean slate behavior when encryption settings change. All tests follow the same pattern but are currently failing due to a timing issue in the Configure Sync dialog.

## Test Files

### Main Test File

- **Path:** `e2e/tests/sync/supersync-encryption-enable-disable.spec.ts`
- **Tests:** 4 scenarios covering encryption state changes
- **Status:** All 4 failing at the same point

### Test Helper

- **Path:** `e2e/pages/supersync.page.ts`
- **Modified Methods:** `enableEncryption()`, `disableEncryption()`, `syncAndWait()`

### Production Code Fix

- **Path:** `src/app/imex/sync/dialog-sync-initial-cfg/dialog-sync-initial-cfg.component.ts`
- **Change:** Added `ngAfterViewInit()` with provider change listener to reload config

## The 4 Tests

### Test 1: Disabling encryption triggers clean slate

**Line:** 47
**Purpose:** Verify that disabling encryption triggers a clean slate and other clients adapt
**Status:** ❌ FAILING

**Steps:**

1. Client A enables encryption with password
2. Client B configures with same password
3. Both clients sync and verify encryption works
4. Client A disables encryption (should trigger clean slate)
5. Client B reconfigures without password
6. Both clients verify sync works without encryption

**Failure Point:** Step 4 - Waiting for "Disable Encryption?" confirmation dialog

### Test 2: Enabling encryption triggers clean slate

**Line:** 170
**Purpose:** Verify that enabling encryption triggers clean slate and other clients require password
**Status:** ❌ FAILING

**Steps:**

1. Client A starts without encryption
2. Client B configures without encryption
3. Both sync and verify
4. Client A enables encryption (should trigger clean slate)
5. Client B attempts sync without password (should fail)
6. Client B reconfigures with password
7. Both verify sync works with encryption

**Failure Point:** Step 4 - Waiting for "Enable Encryption?" confirmation dialog

### Test 3: Multiple encryption state changes

**Line:** 279
**Purpose:** Verify multiple enable/disable cycles work correctly
**Status:** ❌ FAILING

**Steps:**

1. Start without encryption
2. Enable encryption → clean slate
3. Disable encryption → clean slate
4. Enable encryption again → clean slate
5. Verify final state with encryption enabled

**Failure Point:** First disable step - Waiting for "Disable Encryption?" dialog

### Test 4: Concurrent changes overwritten by encryption change

**Line:** 405
**Purpose:** Verify that encryption state changes overwrite concurrent task changes
**Status:** ❌ FAILING

**Steps:**

1. Client A enables encryption
2. Client B configures with password
3. Both create tasks while offline
4. Client A disables encryption (clean slate)
5. Client A's task survives, Client B's task is lost (expected clean slate behavior)

**Failure Point:** Step 4 - Waiting for "Disable Encryption?" dialog

## Root Cause: Checkbox Shows Wrong State

### The Problem

When the Configure Sync dialog opens during the `disableEncryption()` helper method:

**Expected State:**

- Encryption checkbox: ✅ CHECKED (because encryption is currently enabled)
- Clicking it should trigger "Disable Encryption?" confirmation dialog

**Actual State:**

- Encryption checkbox: ❌ UNCHECKED
- Clicking it triggers "Enable Encryption?" dialog instead
- Tests wait for "Disable Encryption?" dialog that never appears → timeout after 5000ms

### Evidence

Latest test screenshot shows Configure Sync dialog with:

- Provider: SuperSync (correctly selected)
- "Enable end-to-end encryption" checkbox: UNCHECKED ✗
- This is WRONG - encryption is enabled, checkbox should be checked

### Why This Happens

The Configure Sync dialog loads provider-specific configuration asynchronously when the provider dropdown changes. The test helper:

1. Right-clicks sync button → opens Configure Sync dialog
2. Selects "SuperSync" from provider dropdown
3. Waits 1000ms for async config loading to complete
4. Expects encryption checkbox to be checked

**The 1000ms wait is not sufficient** - the async provider change listener hasn't finished loading the configuration and updating the form model.

## Production Code Changes

### File: `src/app/imex/sync/dialog-sync-initial-cfg/dialog-sync-initial-cfg.component.ts`

**What Changed:** Added provider change listener in `ngAfterViewInit()` lifecycle hook

**Why:** Dialog was only loading config once on open with `.pipe(first())`, never reloading when provider changed in dropdown

**Implementation:**

```typescript
ngAfterViewInit(): void {
  // Setup provider change listener after the form is initialized by Formly
  setTimeout(() => {
    const syncProviderControl = this.form.get('syncProvider');
    if (!syncProviderControl) {
      SyncLog.warn('syncProvider form control not found');
      return;
    }

    // Listen for provider changes and reload provider-specific configuration
    this._subs.add(
      syncProviderControl.valueChanges
        .pipe(skip(1))
        .subscribe(async (newProvider: LegacySyncProvider | null) => {
          if (!newProvider) {
            return;
          }

          const providerId = toSyncProviderId(newProvider);
          if (!providerId) {
            return;
          }

          // Load the provider's stored configuration
          const provider = this._providerManager.getProviderById(providerId);
          if (!provider) {
            return;
          }

          const privateCfg = await provider.privateCfg.load();
          const globalCfg = await this._globalConfigService.sync$
            .pipe(first())
            .toPromise();

          // Create provider-specific config based on provider type
          let providerSpecificUpdate: Partial<SyncConfig> = {};

          if (newProvider === LegacySyncProvider.SuperSync && privateCfg) {
            providerSpecificUpdate = {
              superSync: privateCfg as any,
              encryptKey: privateCfg.encryptKey || '',
            };
          } else if (newProvider === LegacySyncProvider.WebDAV && privateCfg) {
            providerSpecificUpdate = {
              webDav: privateCfg as any,
              encryptKey: privateCfg.encryptKey || '',
            };
          } else if (newProvider === LegacySyncProvider.LocalFile && privateCfg) {
            providerSpecificUpdate = {
              localFileSync: privateCfg as any,
              encryptKey: privateCfg.encryptKey || '',
            };
          } else if (newProvider === LegacySyncProvider.Dropbox && privateCfg) {
            providerSpecificUpdate = {
              encryptKey: privateCfg.encryptKey || '',
            };
          }

          // Update the model, preserving non-provider-specific fields
          this._tmpUpdatedCfg = {
            ...this._tmpUpdatedCfg,
            ...providerSpecificUpdate,
            syncProvider: newProvider,
            isEnabled: this._tmpUpdatedCfg.isEnabled,
            syncInterval: globalCfg?.syncInterval || this._tmpUpdatedCfg.syncInterval,
            isManualSyncOnly:
              globalCfg?.isManualSyncOnly || this._tmpUpdatedCfg.isManualSyncOnly,
            isCompressionEnabled:
              globalCfg?.isCompressionEnabled ||
              this._tmpUpdatedCfg.isCompressionEnabled,
          };

          // For non-SuperSync providers, update encryption from global config
          if (newProvider !== LegacySyncProvider.SuperSync) {
            this._tmpUpdatedCfg = {
              ...this._tmpUpdatedCfg,
              isEncryptionEnabled: globalCfg?.isEncryptionEnabled || false,
            };
          }
        }),
    );
  }, 0);
}
```

**Status:** ✅ Code is committed and running in dev server

## Test Helper Changes

### File: `e2e/pages/supersync.page.ts`

#### Change 1: `disableEncryption()` method (lines 294-414)

**What Changed:** Added provider selection to trigger config reload

**Before:**

```typescript
async disableEncryption(): Promise<void> {
  await this.syncBtn.click({ button: 'right' });
  // Dialog opens but doesn't have current encryption state loaded
  await this.encryptionCheckbox.click();
  // ...
}
```

**After:**

```typescript
async disableEncryption(): Promise<void> {
  await this.syncBtn.click({ button: 'right' });
  await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

  // CRITICAL: Select "SuperSync" to load current configuration
  await this.providerSelect.click();
  const superSyncOption = this.page.locator('mat-option:has-text("SuperSync")');
  await superSyncOption.click();

  // Wait for provider change listener to complete
  await this.page.waitForTimeout(1000);

  // Expand Advanced Config
  const advancedCollapsible = this.page.locator('.collapsible-header:has-text("Advanced")');
  await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

  // Wait for collapse animation
  await this.page.waitForTimeout(300);
  const isExpanded = await advancedCollapsible.evaluate((el) =>
    el.classList.contains('expanded'),
  );

  if (!isExpanded) {
    await advancedCollapsible.click();
    await this.page.waitForTimeout(500);
  }

  await this.encryptionCheckbox.waitFor({ state: 'visible', timeout: 3000 });
  await this.page.waitForTimeout(500);

  const isChecked = await this.encryptionCheckbox.isChecked();
  console.log('[disableEncryption] Checkbox state:', { isChecked });

  if (isChecked) {
    // Click checkbox to trigger confirmation dialog
    const checkboxLabel = this.page.locator('.e2e-isEncryptionEnabled label');
    await checkboxLabel.click();
    await this.page.waitForTimeout(200);

    // Wait for and handle "Disable Encryption?" confirmation dialog
    const confirmDialog = this.page.locator(
      'mat-dialog-container:has-text("Disable Encryption?")',
    );
    await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });

    const confirmBtn = confirmDialog.locator('button:has-text("Yes, Disable")');
    await confirmBtn.click();

    await this.page.waitForTimeout(500);
    await confirmDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  // Rest of method...
}
```

**Status:** ✅ Code committed but **FAILING** - 1000ms wait not sufficient

#### Change 2: `enableEncryption()` method (lines 202-305)

**What Changed:**

1. Added provider selection to trigger config reload
2. Added `force: true` to password field fill (bypasses visibility check)

**Key Addition:**

```typescript
// Fill password using force option to bypass visibility checks
await this.encryptionPasswordInput.fill(password, { force: true });
await this.page.waitForTimeout(300);
```

**Status:** ✅ Code committed and working

#### Change 3: `syncAndWait()` method (lines 459-534)

**What Changed:** Handle fast syncs where spinner appears/disappears quickly

**Before:**

```typescript
async syncAndWait(): Promise<void> {
  await this.syncBtn.click();
  await this.syncSpinner.waitFor({ state: 'visible', timeout: 5000 });
  await this.syncSpinner.waitFor({ state: 'hidden', timeout: 15000 });
  // Would fail if sync completed before spinner could be detected
}
```

**After:**

```typescript
async syncAndWait(
  options: { useLocal?: boolean; timeout?: number } = {},
): Promise<void> {
  const { useLocal = false, timeout = 15000 } = options;

  await this.syncBtn.click();

  // Check if sync already completed (for very fast syncs)
  const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

  if (!checkAlreadyVisible) {
    // Try to wait for spinner, but if it's already gone, that's fine
    const spinnerAppeared = await this.syncSpinner
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    if (spinnerAppeared) {
      // Handle dialogs that might appear during sync
      // ...dialog handling code...

      await this.syncSpinner.waitFor({ state: 'hidden', timeout });
    }

    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 });
  }

  // Wait for overlay backdrop to fully disappear
  await this.page.waitForTimeout(500);
  const backdrop = this.page.locator('.cdk-overlay-backdrop');
  const backdropExists = await backdrop.count();
  if (backdropExists > 0) {
    await backdrop.waitFor({ state: 'hidden', timeout: 3000 });
  }
}
```

**Status:** ✅ Code committed and working

## Current Failure Pattern

All 4 tests fail with the same error:

```
Error: locator.waitFor: Timeout 5000ms exceeded.
=========================== logs ===========================
waiting for locator('mat-dialog-container:has-text("Disable Encryption?")')
==============================================================

  364 |       const confirmDialog = this.page.locator(
  365 |         'mat-dialog-container:has-text("Disable Encryption?")',
  366 |       );
> 367 |       await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });
```

**Why it fails:**

1. Encryption checkbox is UNCHECKED (wrong state)
2. Test clicks it, expecting "Disable Encryption?" dialog
3. Instead, "Enable Encryption?" dialog would appear (but test doesn't wait for it)
4. Test times out waiting for dialog that never appears

## Attempted Fixes

### ✅ Fix 1: Production code - Add provider change listener

- **Status:** Implemented and running
- **Result:** Listener exists but may not be completing in time

### ✅ Fix 2: Test helper - Select provider to trigger reload

- **Status:** Implemented
- **Result:** Provider is selected, listener fires, but timing is wrong

### ❌ Fix 3: Wait 1000ms after provider selection

- **Status:** Implemented
- **Result:** NOT SUFFICIENT - checkbox still shows wrong state

## Next Steps to Fix

### Option 1: Poll for checkbox state (RECOMMENDED)

Instead of arbitrary timeout, wait for the checkbox to reach the expected state:

```typescript
// Wait for checkbox to become checked (indicates config loaded)
await this.page.waitForFunction(
  () => {
    const checkbox = document.querySelector('.e2e-isEncryptionEnabled input');
    return checkbox?.checked === true;
  },
  { timeout: 5000 },
);
```

### Option 2: Wait for password field to have value

The password field gets populated when config loads:

```typescript
// Wait for password field to be populated
await this.encryptionPasswordInput.waitFor(
  async (input) => {
    const value = await input.inputValue();
    return value.length > 0;
  },
  { timeout: 5000 },
);
```

### Option 3: Increase timeout to 3000ms+

Simple but not ideal - doesn't guarantee success:

```typescript
// Wait longer for provider change listener
await this.page.waitForTimeout(3000);
```

### Option 4: Add debug logging to production code

Verify the listener is actually firing and completing:

```typescript
console.log('[DialogSyncInitialCfg] Provider changed to:', newProvider);
// ... load config ...
console.log('[DialogSyncInitialCfg] Config loaded:', privateCfg);
// ... update model ...
console.log('[DialogSyncInitialCfg] Model updated:', this._tmpUpdatedCfg);
```

### Option 5: Wait for Formly form to update

Wait for the form model to reflect the changes:

```typescript
await this.page.waitForFunction(
  () => {
    const form = window['ng']?.probe?.(...); // Access Angular form
    return form?.value?.superSync?.isEncryptionEnabled === true;
  },
  { timeout: 5000 }
);
```

## Recommendations

1. **Immediate fix:** Use Option 1 (poll for checkbox state) - most robust
2. **Debug step:** Add Option 4 (console logging) to verify listener is firing
3. **Long term:** Consider adding a data attribute to dialog when config is fully loaded

## Running the Tests

```bash
# Run single test file
npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-enable-disable.spec.ts -- --retries=0

# Run specific test by name
npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-enable-disable.spec.ts -- --grep "Disabling encryption" --retries=0

# View test file
cat e2e/tests/sync/supersync-encryption-enable-disable.spec.ts
```

## Related Files

- Test file: `e2e/tests/sync/supersync-encryption-enable-disable.spec.ts`
- Test helpers: `e2e/pages/supersync.page.ts`
- Production fix: `src/app/imex/sync/dialog-sync-initial-cfg/dialog-sync-initial-cfg.component.ts`
- Server status: Docker containers must be running (`docker compose up -d supersync`)
- Dev server: Must be running on port 4242 (`npm run startFrontend:e2e`)

## Key Learnings

1. **Async form loading:** Angular Material + Formly forms load asynchronously, arbitrary timeouts are unreliable
2. **Provider change listener:** Production code correctly reloads config but timing is unpredictable
3. **Polling > Timeouts:** Wait for specific state changes rather than arbitrary delays
4. **Force option:** Playwright's `force: true` bypasses visibility checks for hidden form fields
5. **Fast syncs:** Sync can complete before spinner is visible, need to handle gracefully
