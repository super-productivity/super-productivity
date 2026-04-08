# Plan: Upgrade Electron from 37.10.3 to 40.8.3

> **Status: Planned**
> **Last updated: 2026-03-23** (comprehensive research review)

## Context

Super Productivity ships on Linux as AppImage, deb, snap, rpm, and has a community Flatpak on Flathub. Two previous upgrade attempts (Electron 38 in Oct 2025, Electron 39 in Dec 2025) both failed and were reverted due to **Snap crashes on Wayland**.

**Electron 37 is end-of-life** (since January 13, 2026). This upgrade is a security and support lifecycle necessity, not just a feature request.

**Root cause of snap crashes:** Electron 38+ defaults `--ozone-platform` to `auto` (native Wayland). electron-builder's snap template hardcodes the ancient `gnome-3-28-1804` runtime which lacks modern GNOME schemas (`font-antialiasing`) and Mesa drivers, causing crashes. Tracked in [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452) (still open, no upstream fix). Issue [#8548](https://github.com/electron-userland/electron-builder/issues/8548) (core22/core24 support) was **closed as "not planned"** on March 19, 2026.

**macOS Tahoe clarification:** Issue [#5712](https://github.com/super-productivity/super-productivity/issues/5712) requests this upgrade to fix macOS Tahoe slowness. However, the specific GPU fix (Electron PR #48376, `_cornerMask` override) was already backported to **Electron 37.6.0** — our current 37.10.3 includes it. Ongoing freeze reports (March 2026) are a **macOS Tahoe system-level memory management issue** affecting all apps (Safari, Firefox, Chrome, VS Code on E39), not Electron-specific. The upgrade is still warranted for EOL/security reasons but should not be marketed as a fix for macOS Tahoe freezes.

**Strategy:** Two-pronged approach for Snap: (1) upgrade the gnome runtime via a plug override (Tidal HiFi pattern), and (2) keep a defense-in-depth X11 override in code. For Flatpak: coordinate a separate PR to the Flathub manifest.

---

## Research Summary (March 2026)

### Ecosystem Snapshot

| App                    | Electron    | Snap Strategy                                    | Flatpak Runtime                       | Wayland         |
| ---------------------- | ----------- | ------------------------------------------------ | ------------------------------------- | --------------- |
| VS Code                | **39.8.3**  | Classic, forces X11 via wrapper                  | N/A                                   | X11 in snap     |
| Obsidian               | **39.7.0**  | N/A                                              | **25.08**, wrapper-controlled Wayland | Auto in Flatpak |
| Bitwarden              | **39.2.6**  | Strict/core22, allowNativeWayland=true           | N/A                                   | Buggy in snap   |
| Element                | **41.0.2**  | N/A                                              | **25.08**                             | Auto in Flatpak |
| Signal                 | N/A         | core24 + gnome extension (custom snapcraft.yaml) | **25.08**                             | Auto in Flatpak |
| Joplin                 | **38.x**    | core24 + gnome extension (custom snapcraft.yaml) | **25.08**                             | Enabled         |
| Tidal HiFi             | **40.7.0**  | **core22 + gnome-42-2204 plug override**         | N/A                                   | Enabled         |
| Teams-for-Linux        | **39.8.2**  | core22, forces X11 via executableArgs            | N/A                                   | X11 in snap     |
| **Super Productivity** | **37.10.3** | core22, allowNativeWayland=true, gnome-3-28-1804 | **24.08**                             | Force-disabled  |

### Key Findings

- **Ecosystem consensus is Electron 39.x.** 40.8.3 is a reasonable forward-looking target.
- **Tidal HiFi solved the snap runtime problem** by overriding the `gnome-3-28-1804` plug to point to `gnome-42-2204` in electron-builder.yaml. This is confirmed working in production with strict confinement on core22.
- **Signal and Joplin use custom snapcraft.yaml files** with the `gnome` extension — more future-proof but requires a build pipeline change.
- **SP's Flathub manifest is behind peers:** runtime 24.08 (vs 25.08), 1-line wrapper script (vs Obsidian's 85 lines), Wayland force-disabled via `--unset-env=XDG_SESSION_TYPE`.
- **The planned `protocol.handle` migration code had a fatal infinite recursion bug** (now fixed in this plan).
- **Node.js 22→24 jump is safe** for SP's codebase. Only real risk: OpenSSL 3.5 raises minimum RSA key size to 2048 bits (affects users with legacy server certificates).

### Past Attempts

1. **Electron 38 (Oct 2025):** 25+ commits trying Mesa drivers, env vars, plugs configs in snap. All failed. Reverted (commit `6486b41bd9`).
2. **Electron 39 (Dec 2025):** Forced X11 via `app.commandLine.appendSwitch('ozone-platform', 'x11')` globally for all Linux. Reverted next day (commit `6e60bde789`) — still crashed because `allowNativeWayland: true` in electron-builder.yaml caused the snap launch wrapper to attempt Wayland initialization _before_ the Electron main process ran.

---

## Changes

### 1. Bump Electron version in `package.json`

**File:** `package.json` (line 231)

```
"electron": "37.10.3"  →  "electron": "40.8.3"
```

Why 40.8.3 over 40.6.1: 8 patch releases of stability. Why not 41.x: only 2 weeks old (released March 10, 2026). Why not 39.x: Node.js 22→24 is the same jump regardless, and 40.x has more mature Wayland support (frameless window shadows, CSD).

### 2. Upgrade Snap gnome runtime via plug override in `electron-builder.yaml`

**File:** `electron-builder.yaml` (snap section, lines 77-94)

Replace the entire snap section:

```yaml
snap:
  grade: stable
  # Keep allowNativeWayland true — the gnome-42-2204 runtime has proper
  # Mesa drivers and GSettings schemas for Wayland. The old crashes were
  # caused by gnome-3-28-1804, not by Wayland itself.
  allowNativeWayland: true
  autoStart: true
  base: core22
  confinement: strict
  environment:
    # Fix for issue #4920: Isolate fontconfig cache to prevent GTK dialog rendering issues
    # https://github.com/super-productivity/super-productivity/issues/4920
    FC_CACHEDIR: $SNAP_USER_DATA/.cache/fontconfig
  plugs:
    - default
    - password-manager-service
    - system-observe
    - login-session-observe
    # Fix for issue #6031: Add filesystem access for local file sync
    # https://github.com/super-productivity/super-productivity/issues/6031
    - removable-media
    # Override electron-builder's hardcoded gnome-3-28-1804 content snap (core20 era)
    # with gnome-42-2204 (core22 era) for up-to-date Mesa drivers and GSettings schemas.
    # The plug name must match the template key to replace it rather than duplicate it.
    # The explicit `content` attribute tells snapd to match the gnome-42-2204 slot.
    # Pattern from Tidal HiFi: https://github.com/Mastermindzh/tidal-hifi
    # gnome-42-2204 has global auto-connect (granted June 2022).
    # Ref: electron-builder#9452, electron-builder#8548 (closed, not planned)
    - gnome-3-28-1804:
        interface: content
        content: gnome-42-2204
        target: $SNAP/gnome-platform
        default-provider: gnome-42-2204
```

**Why this works:** electron-builder's `normalizePlugConfiguration()` overwrites the template's `gnome-3-28-1804` plug definition with the user-provided one via direct property assignment. snapd matches content interfaces on the `content` attribute (not plug name), so `content: gnome-42-2204` correctly connects to the gnome-42-2204 snap. Verified by tracing through electron-builder source code and by Tidal HiFi shipping this in production.

**Auto-connect:** gnome-42-2204 was granted global auto-connect on June 6, 2022. SP has no plug-side snap-declarations for content interfaces that would override this. Should auto-connect without a store request.

**Fallback (if gnome-42-2204 causes issues):** Revert to `allowNativeWayland: false` and remove the plug override. This falls back to the X11-only approach from the original plan.

### 3. Add Snap-only X11 override in `start-app.ts` (defense-in-depth)

**File:** `electron/start-app.ts` — after line 68 (the existing `gtk-version` switch)

```typescript
// Defense-in-depth: Force X11 in Snap if the gnome-42-2204 runtime is not
// available or Wayland init fails. The primary fix is the gnome-42-2204
// plug override in electron-builder.yaml. This code catches edge cases where
// the content snap is not connected or the runtime is missing.
// Users can override with: superproductivity --ozone-platform=wayland
if (
  process.platform === 'linux' &&
  process.env.SNAP &&
  !process.argv.some((arg) => arg.includes('--ozone-platform='))
) {
  // Check if the gnome-42-2204 runtime is mounted at the expected path.
  // If not, fall back to X11 to prevent crashes.
  const gnomePlatformPath = join(process.env.SNAP || '', 'gnome-platform');
  try {
    const fs = require('fs');
    if (
      !fs.existsSync(gnomePlatformPath) ||
      fs.readdirSync(gnomePlatformPath).length === 0
    ) {
      app.commandLine.appendSwitch('ozone-platform', 'x11');
      log('Snap: gnome-42-2204 runtime not found, forcing X11');
    }
  } catch {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
    log('Snap: Could not check gnome runtime, forcing X11');
  }
}
```

Key differences from the failed December 2025 attempt:

- Scoped to Snap only (`process.env.SNAP`), not all Linux
- Only forces X11 when the gnome-42-2204 runtime is missing (not unconditionally)
- Respects user override (`--ozone-platform=` check)
- Defense-in-depth alongside the plug override from step 2

### 4. Update Flatpak runtime in `electron-builder.yaml`

**File:** `electron-builder.yaml` (line 97)

```yaml
runtimeVersion: '23.08'  →  runtimeVersion: '24.08'
```

Also fix the linter-invalid socket combination (Flathub linter flags `x11` + `wayland` as ERROR):

```yaml
# Before (linter error):
- --socket=x11
- --socket=wayland
- --socket=fallback-x11

# After (linter-valid):
- --socket=wayland
- --socket=fallback-x11
```

> **Note:** The Flathub manifest is maintained separately at
> [github.com/flathub/com.super_productivity.SuperProductivity](https://github.com/flathub/com.super_productivity.SuperProductivity)
> and should be upgraded to **25.08** (see step 9). This electron-builder.yaml
> flatpak config is effectively dead code for Flathub but useful for local builds.

### 5. Migrate deprecated `protocol.registerFileProtocol` in `start-app.ts`

**File:** `electron/start-app.ts` (lines 293-296)

> **WARNING:** The previously planned migration code (`net.fetch('file:///' + pathname)`)
> has a **fatal infinite recursion bug** — `protocol.handle('file', ...)` intercepts ALL
> `file://` requests including the `net.fetch` inside itself. It also breaks filenames
> with spaces, `#`, `?`, or `%` characters, and Windows backslash paths.

**Option A (preferred): Remove the handler entirely.**

The handler was added in 2020 (commit `2c8255b081`, issue #549) for Electron ~10. Modern Electron handles `file://` URLs correctly by default. The CSP already permits `file:` in `img-src`. Test by commenting out lines 293-296 and verifying:

- Angular app loads correctly
- Task attachment images with `file://` paths display (including paths with spaces)
- Background images set to `file://` paths work
- Test on Windows with backslash paths

If removing works → delete lines 293-296. No new code needed.

**Option B (fallback): Use `pathToFileURL` + `bypassCustomProtocolHandlers`.**

Add to electron imports:

```typescript
import { pathToFileURL } from 'url';
import {
  App,
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  powerMonitor,
  protocol,
} from 'electron';
```

Replace lines 293-296:

```typescript
protocol.handle('file', (request) => {
  const pathname = decodeURI(new URL(request.url).pathname);
  return net.fetch(pathToFileURL(pathname).href, {
    bypassCustomProtocolHandlers: true,
  });
});
```

Key differences from the previously planned code:

- `bypassCustomProtocolHandlers: true` prevents infinite recursion
- `new URL(request.url).pathname` properly parses the URL structure
- `pathToFileURL()` properly encodes spaces as `%20`, `#` as `%23`, converts Windows backslashes

### 6. Add GPU cache cleanup on Electron version change in `start-app.ts`

**File:** `electron/start-app.ts` — in a new `appIN.on('ready', ...)` block, before `createMainWin()` (around line 150)

```typescript
import * as fs from 'fs';

appIN.on('ready', () => {
  // Clear GPU cache when Electron version changes to prevent blank/black screens.
  // Stale GPU shader caches from old Electron versions cause rendering failures.
  // Pattern used by Obsidian's Flatpak wrapper.
  if (process.platform === 'linux') {
    const userDataPath = app.getPath('userData');
    const versionFile = join(userDataPath, '.electron-version');
    const currentVersion = process.versions.electron;
    try {
      let lastVersion = '';
      try {
        lastVersion = fs.readFileSync(versionFile, 'utf8').trim();
      } catch {
        // File doesn't exist on first run
      }
      if (lastVersion !== currentVersion) {
        const gpuCachePath = join(userDataPath, 'GPUCache');
        if (fs.existsSync(gpuCachePath)) {
          fs.rmSync(gpuCachePath, { recursive: true, force: true });
          log(
            `Cleared GPUCache after Electron upgrade (${lastVersion} → ${currentVersion})`,
          );
        }
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(versionFile, currentVersion);
      }
    } catch (e) {
      log('Failed to check/clear GPU cache:', e);
    }
  }
});
```

### 7. Migrate `url.format()` (proactive deprecation cleanup)

**File:** `electron/main-window.ts` (line 198) and `electron/full-screen-blocker.ts` (line 38)

`url.format()` is documentation-deprecated (DEP0116). Still works in Node 24 without warnings, but worth cleaning up. Replace:

```typescript
format({ pathname: normalize(join(...)), protocol: 'file:', slashes: true })
```

With:

```typescript
`file://${normalize(join(...))}`
```

### 8. Run npm install and verify

```bash
npm install
npm run electron:build
npm run checkFile electron/start-app.ts
npm run checkFile electron/main-window.ts
npm run checkFile electron/full-screen-blocker.ts
npm test
```

Verify `@types/node` compatibility — Electron 40 uses Node 24, and there's a known type conflict ([electron#49213](https://github.com/electron/electron/issues/49213)) where `@types/node` added `noDeprecation` as optional but Electron defines it as required. May need `skipLibCheck: true` or a types version pin.

### 9. Update Flathub manifest (separate PR)

**Repo:** [github.com/flathub/com.super_productivity.SuperProductivity](https://github.com/flathub/com.super_productivity.SuperProductivity)

The Flathub manifest is maintained separately and is currently behind peers:

- Runtime 24.08 (peers on **25.08**: Signal, FreeTube, Obsidian, Element)
- 1-line wrapper script (peers: 50-85 line scripts with TMPDIR isolation)
- Wayland force-disabled via `--unset-env=XDG_SESSION_TYPE` (since PR #58, Oct 2025)
- Missing `--system-talk-name=org.freedesktop.login1` (needed for idle detection)
- Missing `--talk-name=org.freedesktop.secrets` (keyring access)

> **Flathub linter constraint:** `--socket=x11` + `--socket=wayland` is flagged as an **ERROR**.
> Only two valid socket patterns exist:
>
> 1. X11-only: `--socket=x11` + `--share=ipc`
> 2. Wayland + fallback: `--socket=wayland` + `--socket=fallback-x11` + `--share=ipc`
>
> The current `electron-builder.yaml` flatpak section declares both `--socket=x11` AND
> `--socket=wayland` — this would fail the linter. Another reason this config is dead code.

**Phase 1 — Runtime upgrade + missing permissions (1 PR):**

- Bump `runtime-version` and `base-version` from `24.08` to `25.08`
  (25.08 BaseApp bundles zypak v2025.09 + libsecret 0.21.7)
- Add `--system-talk-name=org.freedesktop.login1` (idle/sleep detection)
- Add `--talk-name=org.freedesktop.secrets` (keyring access)
- Add `"automerge-flathubbot-prs": true` to `flathub.json` (if using extra-data)

**Phase 2 — Re-enable Wayland (1 PR):**

- Remove `--unset-env=XDG_SESSION_TYPE` (a workaround, not needed for Electron 40+)
- Replace `--socket=x11` with `--socket=wayland` + `--socket=fallback-x11`
- Electron 40+ auto-detects Wayland — no `--ozone-platform-hint` flag needed
- No `GTK_USE_PORTAL=1` needed (automatic inside Flatpak sandbox)
- Signal Desktop pattern: trust Electron's built-in Wayland detection

**Phase 3 — Enhance wrapper script (1 PR):**

```bash
#!/bin/sh

# Isolate TMPDIR per best practice (Signal, FreeTube pattern).
# Prevents lock file collisions between Flatpak apps.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"

# GPU cache cleanup (opt-in, for blank screen issues after driver updates)
if [ "${SP_CLEAN_CACHE:-0}" = "1" ]; then
  rm -rf "${XDG_CONFIG_HOME}/superProductivity/GPUCache"
fi

# GPU disable (for problem GPUs)
if [ "${SP_DISABLE_GPU:-0}" = "1" ]; then
  set -- --disable-gpu "$@"
fi

# Trash integration
export ELECTRON_TRASH=gio

exec zypak-wrapper.sh /app/superproductivity/superproductivity "$@"
```

**Target finish-args (gold standard, following Signal Desktop + Flathub linter):**

```yaml
finish-args:
  - --socket=wayland
  - --socket=fallback-x11
  - --share=ipc
  - --share=network
  - --device=dri
  - --socket=pulseaudio
  - --filesystem=xdg-download
  - --talk-name=org.freedesktop.Notifications
  - --talk-name=org.kde.StatusNotifierWatcher
  - --talk-name=org.gnome.Mutter.IdleMonitor
  - --talk-name=org.freedesktop.secrets
  - --system-talk-name=org.freedesktop.login1
  - --env=XCURSOR_PATH=/run/host/user-share/icons:/run/host/share/icons
  - --env=ELECTRON_TRASH=gio
```

> **Note:** The `electron-builder.yaml` flatpak section is effectively dead code — Flathub
> uses its own manifest. Keep it for local builds but don't expect it to affect Flathub.
> The current config also has a linter error (`--socket=x11` + `--socket=wayland`).

---

## What NOT to change

Based on the failed 25+ commit Electron 38 attempt:

- Do NOT add Mesa/GPU driver packages to snap stagePackages
- Do NOT try software rendering (`LIBGL_ALWAYS_SOFTWARE`)
- Do NOT change CI workflows
- Do NOT enumerate individual snap plugs (keep `- default`)
- Do NOT force X11 for all Linux (only as Snap fallback when gnome runtime is missing)

---

## Breaking Changes Audit (Electron 38→40)

| Breaking Change                            | Version | Affects SP?  | Action                                                |
| ------------------------------------------ | ------- | ------------ | ----------------------------------------------------- |
| macOS 11 dropped                           | E38     | Low          | Document in release notes                             |
| `ozone-platform` defaults to `auto`        | E38     | **Critical** | gnome-42-2204 plug override + code fallback           |
| `ELECTRON_OZONE_PLATFORM_HINT` removed     | E38     | No           | Not used in codebase                                  |
| `window.open` always resizable             | E39     | No           | All popups denied via `setWindowOpenHandler`          |
| Node.js 22→24                              | E40     | **Medium**   | No native modules; test TLS connections (OpenSSL 3.5) |
| Clipboard deprecated in renderer           | E40     | No           | SP uses clipboard in main process only                |
| `protocol.registerFileProtocol` deprecated | E25+    | **Yes**      | Migrated in step 5                                    |
| `url.format()` documentation-deprecated    | E25+    | Minor        | Migrated in step 7                                    |

### Node.js 22→24 Details

- **OpenSSL 3.5 security level 2:** RSA/DSA/DH keys must be ≥2048 bits. Users connecting to Jira/WebDAV/sync servers with legacy certificates may see TLS failures. Error will be visible (connection refused), not silent.
- **`require(esm)` enabled by default:** Additive — things that used to fail now work. No breakage.
- **All `fs`, `child_process`, `path`, `process`, timer APIs:** Verified safe. SP uses standard patterns.

---

## Expected behavior after upgrade

| Distribution | Wayland session                                                    | X11 session |
| ------------ | ------------------------------------------------------------------ | ----------- |
| **Snap**     | Native Wayland via gnome-42-2204 (X11 fallback if runtime missing) | Normal X11  |
| **AppImage** | Native Wayland (Electron auto)                                     | Normal X11  |
| **deb/rpm**  | Native Wayland (Electron auto)                                     | Normal X11  |
| **Flatpak**  | Native Wayland (after Flathub manifest update)                     | Normal X11  |

---

## Risk Assessment

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                                              |
| -------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------- |
| gnome-42-2204 auto-connect fails in Snap Store                       | Low        | High   | File store request at forum.snapcraft.io (turnaround: days). Fallback: set `allowNativeWayland: false`. |
| Snap crashes despite gnome-42-2204                                   | Low        | High   | Defense-in-depth X11 fallback in start-app.ts                                                           |
| AppImage/deb regressions on Wayland                                  | Low        | Medium | No forced X11 for non-Snap; Electron 40 Wayland is more mature                                          |
| `protocol.handle` breaks file loading                                | Low        | High   | Try removing handler entirely first (Option A). `registerFileProtocol` still works in E40 as fallback.  |
| OpenSSL 3.5 rejects legacy server certs                              | Medium     | Medium | Document in release notes. Users can downgrade TLS security via environment variables if needed.        |
| `@types/node` v24 type conflicts at build                            | Medium     | Low    | `skipLibCheck` or pin types version                                                                     |
| `stage-packages` exclusion list mismatch with core22 + gnome-42-2204 | Low        | Low    | May increase snap size; functionally correct                                                            |

---

## Verification

1. `npm run electron:build` — compiles without errors
2. `npm run checkFile electron/start-app.ts` — passes lint/prettier
3. `npm test` — unit tests pass
4. Local dev test: `npm start` — app launches, idle detection works
5. Verify `protocol.handle` migration:
   - Angular app loads (JS bundles, CSS, fonts, SVGs)
   - Task attachment images with `file://` paths display
   - Test filenames with spaces, `#`, `?` characters
   - Test on Windows with backslash paths
6. Build snap locally: `npm run localInstall:snap`
   - Verify gnome-42-2204 auto-connects: `snap connections superproductivity`
   - Test on Wayland session — app launches without crash
   - Test on X11 session — app launches normally
7. Verify GPU cache cleanup: check logs for "Cleared GPUCache" message on first launch after upgrade
8. Verify idle detection: confirm logs show correct method (powerMonitor on X11, gdbus on GNOME Wayland)
9. **macOS Tahoe soak test:** Run on macOS 26.x for 30+ minutes with active use. Verify no GPU lag. (Note: system-level freezes are an Apple bug, not ours.)
10. **TLS connection test:** Test Jira, WebDAV, and sync server connections to verify no OpenSSL regressions.

---

## Rollout Plan

### 1. GitHub Pre-release / Beta Tag

Push a GitHub release tagged as pre-release (e.g., `v18.0.0-beta.1`). This gives direct `.deb`, `.AppImage`, `.snap`, `.flatpak` artifacts without touching stable channels.

### 2. Snap Beta Channel

```bash
snapcraft upload --release=beta super-productivity_*.snap
```

**Critical post-upload check:**

```bash
# Install on a clean system and verify auto-connect
snap install super-productivity --channel=beta
snap connections superproductivity
# Look for: gnome-3-28-1804  gnome-42-2204:gnome-42-2204  -
```

If auto-connect fails, file a request at [forum.snapcraft.io/c/store-requests](https://forum.snapcraft.io/c/store-requests).

### 3. Flathub Manifest Update

Submit PR to the Flathub repo with runtime 25.08 upgrade and Wayland re-enablement (step 9). This is independent of the Electron upgrade and can be done in parallel.

### 4. Call to Action

- **GitHub Issue** — update #5712 with what changed, clarify the macOS Tahoe situation
- **Ask specifically for Snap testers on Wayland** — this is the highest-risk scenario
- **Ask for macOS Tahoe testers** — to confirm no new regressions (even though the original bug is already fixed)

---

## Future Considerations

### Custom snapcraft.yaml (long-term)

The gnome-42-2204 plug override is a pragmatic workaround. The long-term solution is a **custom snapcraft.yaml** with `extensions: [gnome]` on core24, following Signal Desktop and Joplin. This provides:

- Automatic gnome-46-2404 runtime + mesa-2404 GPU drivers
- Proper `desktop-launch` command chain
- No dependency on electron-builder's unmaintained snap template

This would involve using electron-builder's `--dir` target and wrapping the output with a custom snapcraft.yaml. Worth doing when core24 is well-tested or when electron-builder's template becomes a bigger liability.

### Electron 41+

Electron 41 (released March 10, 2026) brings improved Wayland support: frameless window shadows, extended resize boundaries, CSD in all configurations. Once 40.8.3 is validated, bumping to 41.x should be a smaller, lower-risk change.

---

## References

- [electron-builder#9452: Snap crashes on Wayland with Electron 38+](https://github.com/electron-userland/electron-builder/issues/9452)
- [electron-builder#8548: core22/core24 support (closed, not planned)](https://github.com/electron-userland/electron-builder/issues/8548)
- [Tidal HiFi gnome-42-2204 plug override](https://github.com/Mastermindzh/tidal-hifi/blob/master/build/electron-builder.base.yml)
- [Signal Desktop snapcraft.yaml (core24 + gnome extension)](https://github.com/snapcrafters/signal-desktop/blob/master/snap/snapcraft.yaml)
- [gnome-42-2204 global auto-connect grant](https://forum.snapcraft.io/t/autoconnect-request-for-gnome-42-2204/30290)
- [VS Code snap electron-launch wrapper](https://github.com/microsoft/vscode/blob/main/resources/linux/snap/electron-launch)
- [Obsidian Flatpak wrapper (gold standard)](https://github.com/flathub/md.obsidian.Obsidian/blob/master/obsidian.sh)
- [Element Desktop Flatpak wrapper](https://github.com/flathub/im.riot.Riot/blob/master/element.sh)
- [Signal Desktop Flatpak manifest](https://github.com/flathub/org.signal.Signal)
- [Super Productivity Flathub manifest](https://github.com/flathub/com.super_productivity.SuperProductivity)
- [Electron 40 release notes](https://www.electronjs.org/blog/electron-40-0)
- [Electron 41 release notes](https://www.electronjs.org/blog/electron-41-0)
- [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
- [Electron end-of-life dates](https://endoflife.date/electron)
- [Node.js 22→24 migration guide](https://nodejs.org/en/blog/migrations/v22-to-v24)
- [macOS Tahoe cornerMask fix (Electron PR #48376)](https://github.com/electron/electron/pull/48376)
- [macOS Tahoe system-level memory issues (MacRumors)](https://forums.macrumors.com/threads/macos-tahoe-windowserver-memory-pressure-over-long-uptimes-anyone-else-seeing-this.2476977/)
- [ShameElectron tracker](https://avarayr.github.io/shamelectron/)
- [Snapcraft GNOME Extension docs](https://documentation.ubuntu.com/snapcraft/stable/reference/extensions/gnome-extension/)
- [Flatpak Electron docs](https://docs.flatpak.org/en/latest/electron.html)
