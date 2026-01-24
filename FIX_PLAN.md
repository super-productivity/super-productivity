# 🛠️ Fix Plan: Restore Force Upload Button

**Branch:** `fix/restore-force-upload-ui`
**Base:** `upstream/master` (Latest RC)
**Goal:** Restore the "Force Upload" button lost during the Tabbed UI migration. This is critical for resolving Sync deadlocks (e.g. WebDAV 412 Precondition Failed).

## 📋 Steps

1.  [x] **Setup:**
    - Stashed personal user config.
    - Created clean branch `fix/restore-force-upload-ui`.

2.  [ ] **Code Changes:**
    - `src/app/imex/sync/sync-wrapper.service.ts`:
      - Change `private _forceUpload()` to `public forceUpload()`.
    - `src/app/pages/config-page/config-page.component.ts`:
      - Add the "Force Upload" button to the `globalSyncConfigFormCfg` configuration array.
      - Use `btnType: 'warn'` to indicate destructive action.
      - Ensure it calls `this._syncWrapperService.forceUpload()`.

3.  [ ] **Verification:**
    - Build locally (`npm run dist` or similar) to ensure compilation passes.
    - (Optional) Verify UI appearance if possible.

4.  [ ] **PR Submission:**
    - Commit with convention: `fix(sync): restore missing force upload button in new config UI`.
    - Push to `origin` (mycochang/super-productivity).
    - Open PR to `super-productivity/super-productivity`.

5.  [ ] **Cleanup:**
    - Switch back to user working branch.
    - Pop stash to restore personal context.

## 📝 Context & Rationale

The "Force Upload" button existed in v16 but was accidentally omitted during the Config Page rewrite (RC.6+). Without it, users facing "Remote file changed" errors have no in-app way to resolve the conflict, forcing manual file deletion on the server.
