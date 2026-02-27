# Plan: Upgrade Electron from 37.10.3 to 40

## Context

Super Productivity ships on Linux as AppImage, deb, snap, rpm, and has a community Flatpak on Flathub. Two previous upgrade attempts (Electron 38 in Oct 2025, Electron 39 in Dec 2025) both failed and were reverted due to **Snap crashes on Wayland**.

**Root cause:** Electron 38+ defaults `--ozone-platform` to `auto` (native Wayland). electron-builder's snap template uses the ancient `gnome-3-28-1804` runtime which lacks modern GNOME schemas, causing crashes. This is tracked in [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452).

**Industry consensus** (from analyzing VS Code, Slack, Discord, Obsidian, Bitwarden, Joplin, Element, 1Password, Brave, Notion): Every major Electron app either forces X11 in Snap or uses classic confinement. VS Code (Electron 39) forces `--ozone-platform=x11` via a custom wrapper. Super Productivity's `allowNativeWayland: true` is more aggressive than any other app.

**Strategy:** Follow the VS Code pattern — force X11 in Snap only, allow native Wayland for all other Linux distributions (AppImage, deb, rpm, Flatpak).

---

## Research Summary

### Past Attempts

1. **Electron 38 (Oct 2025):** 25+ commits trying Mesa drivers, env vars, plugs configs in snap. All failed. Reverted (commit `6486b41bd9`).
2. **Electron 39 (Dec 2025):** Forced X11 via `app.commandLine.appendSwitch('ozone-platform', 'x11')` globally for all Linux. Reverted next day (commit `6e60bde789`) — still crashed because `allowNativeWayland: true` in electron-builder.yaml caused the snap launch wrapper to attempt Wayland initialization *before* the Electron main process ran.

### How Other Apps Handle This

| App | Electron | Snap Strategy | Flatpak | Wayland |
|-----|----------|--------------|---------|---------|
| VS Code | 39 | Official, forces X11 via custom wrapper | None | X11 in snap |
| Slack | 40 | Classic confinement | Community (Flathub) | X11 default |
| Discord | 37 (custom fork) | Community | Community (Flathub) | X11 default |
| Obsidian | 34 | Official, classic confinement | Community (Flathub) | X11 in snap, auto in Flatpak |
| Bitwarden | 39 | Official, strict | Community (Flathub) | X11 workaround documented |
| Joplin | 39 | Community | Community (Flathub) | X11 default |
| Element | 38 | None | Community (Flathub) | Auto in Flatpak wrapper |
| 1Password | Recent | Official (degraded features) | Official (degraded) | Opt-in |
| Brave | N/A | Official (degraded) | Official (degraded) | Opt-in |

### Key Patterns

- **Nobody defaults to Wayland in strict-confinement Snap packages**
- Element Desktop and Obsidian have excellent Flatpak wrapper scripts with Wayland auto-detection, NVIDIA fallback, and GPU cache cleanup
- 1Password and Brave explicitly call Snap/Flatpak "second-class citizens"
- Obsidian clears GPUCache on startup to prevent blank screens after Electron upgrades

---

## Changes

### 1. Bump Electron version in `package.json`

**File:** `package.json` (line 230)

```
"electron": "37.10.3"  →  "electron": "40.6.1"
```

### 2. Fix Snap config in `electron-builder.yaml`

**File:** `electron-builder.yaml` (line 76)

```yaml
allowNativeWayland: true  →  allowNativeWayland: false
```

This tells electron-builder to set `DISABLE_WAYLAND=1` in the generated snapcraft.yaml, preventing the snap launch wrapper from attempting Wayland initialization.

### 3. Update Flatpak runtime in `electron-builder.yaml`

**File:** `electron-builder.yaml` (line 94)

```yaml
runtimeVersion: '23.08'  →  runtimeVersion: '24.08'
```

The Flathub manifest already uses 24.08. This keeps electron-builder config in sync.

### 4. Add Snap-only X11 override in `start-app.ts`

**File:** `electron/start-app.ts` — after line 77 (the existing `gtk-version` switch)

```typescript
// Force X11 in Snap to avoid Wayland crashes with electron-builder's outdated
// gnome-3-28-1804 snap runtime (electron-builder#9452). All major Electron apps
// (VS Code, Bitwarden, etc.) force X11 in Snap. Non-Snap Linux gets native Wayland.
// Users can override with: superproductivity --ozone-platform=wayland
if (
  process.platform === 'linux' &&
  process.env.SNAP &&
  !process.argv.some((arg) => arg.includes('--ozone-platform='))
) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
```

Key differences from the failed December 2025 attempt:
- Scoped to Snap only (`process.env.SNAP`), not all Linux
- Respects user override (`--ozone-platform=` check)
- Defense-in-depth alongside `DISABLE_WAYLAND` from step 2

### 5. Migrate deprecated `protocol.registerFileProtocol` in `start-app.ts`

**File:** `electron/start-app.ts` (lines 282-285)

Replace:
```typescript
protocol.registerFileProtocol('file', (request, callback) => {
  const pathname = decodeURI(request.url.replace('file:///', ''));
  callback(pathname);
});
```

With:
```typescript
protocol.handle('file', (request) => {
  const pathname = decodeURI(request.url.replace('file:///', ''));
  return net.fetch('file:///' + pathname);
});
```

Add `net` to the electron import (lines 3-11):
```typescript
import {
  App, app, BrowserWindow, globalShortcut, ipcMain,
  net, powerMonitor, protocol,
} from 'electron';
```

### 6. Add GPU cache cleanup on Electron version change in `start-app.ts`

**File:** `electron/start-app.ts` — in a new `appIN.on('ready', ...)` block, before `createMainWin()` (around line 155)

```typescript
appIN.on('ready', () => {
  // Clear GPU cache when Electron version changes to prevent blank/black screens.
  // Stale GPU shader caches from old Electron versions cause rendering failures.
  // Pattern used by Obsidian's Flatpak wrapper.
  if (process.platform === 'linux') {
    const userDataPath = app.getPath('userData');
    const versionFile = join(userDataPath, '.electron-version');
    const currentVersion = process.versions.electron;
    try {
      const fs = require('fs');
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
          log(`Cleared GPUCache after Electron upgrade (${lastVersion} → ${currentVersion})`);
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

### 7. Run npm install and verify

```bash
npm install
npm run electron:build
npm run checkFile electron/start-app.ts
```

---

## What NOT to change

Based on the failed 25+ commit Electron 38 attempt:
- Do NOT add Mesa/GPU driver packages to snap stagePackages
- Do NOT try software rendering (`LIBGL_ALWAYS_SOFTWARE`)
- Do NOT change CI workflows
- Do NOT enumerate individual snap plugs (keep `- default`)
- Do NOT force X11 for all Linux (only Snap)

---

## Expected behavior after upgrade

| Distribution | Wayland session | X11 session |
|---|---|---|
| **Snap** | Forced X11 via DISABLE_WAYLAND + ozone-platform=x11 | Normal X11 |
| **AppImage** | Native Wayland (Electron auto) | Normal X11 |
| **deb/rpm** | Native Wayland (Electron auto) | Normal X11 |
| **Flatpak** | Native Wayland (sockets: x11+wayland+fallback-x11) | Normal X11 |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Snap still crashes despite DISABLE_WAYLAND | Low | High | start-app.ts defense-in-depth also forces X11 |
| AppImage/deb regressions on Wayland | Low | Medium | No forced X11 for non-Snap; Electron 40 Wayland is more mature than 38 |
| `protocol.handle` behaves differently | Low | Medium | Well-documented migration path, can revert this single change |
| Global shortcuts break on native Wayland | Medium | Low | Only affects non-Snap Linux; pre-existing limitation |

---

## Verification

1. `npm run electron:build` — compiles without errors
2. `npm run checkFile electron/start-app.ts` — passes lint/prettier
3. `npm test` — unit tests pass
4. Local dev test: `npm start` — app launches, idle detection works
5. Build snap locally: `npm run localInstall:snap` — launches on both X11 and Wayland without crash
6. Verify GPU cache cleanup: check logs for "Cleared GPUCache" message on first launch after upgrade
7. Verify idle detection: confirm logs show correct method (powerMonitor on X11, gdbus on GNOME Wayland)

---

## Rollout Plan

### 1. GitHub Pre-release / Beta Tag

The lowest-friction option. Push a GitHub release tagged as pre-release (e.g., `v11.0.0-beta.1`). This gives you direct `.deb`, `.AppImage`, `.snap`, `.flatpak` artifacts without touching stable channels. Users opt in by downloading manually.

### 2. Snap Edge/Beta Channel

Snap has built-in risk channels: `stable` → `candidate` → `beta` → `edge`. Push the Electron upgrade to the `beta` or `edge` channel:

```bash
snapcraft upload --release=beta super-productivity_*.snap
```

Users test with:

```bash
snap install super-productivity --channel=beta
```

This is the cleanest path for Snap users since they stay in the Snap ecosystem and can switch back with `--channel=stable`.

### 3. Flatpak Beta Branch

Flathub supports beta branches. Submit a PR to the `beta` branch of the Flathub repo with the updated Electron. Users install with:

```bash
flatpak install --user flathub-beta com.superproductivity.SuperProductivity
```

This requires some Flathub-side setup but is the proper way for Flatpak users.

### 4. Call to Action

Whichever approach you choose, the key is reaching the right users:

- **GitHub Issue** — create a tracking issue explaining what's changing, what might break, and how to test
- **In-app notification** — if there's a news/changelog mechanism, mention the beta there
- **Ask specifically for Flatpak/Snap testers** — most users are on AppImage/deb and won't catch packaging-specific issues

### Recommended Approach

Combine **GitHub pre-release** (covers everyone) + **Snap beta channel** (trivial for Snap users) + **Flatpak beta branch** (if Flathub setup isn't too painful). The Snap channel approach is particularly nice because users can seamlessly switch back.

---

## References

- [electron-builder#9452: Snap crashes on Wayland with Electron 38+](https://github.com/electron-userland/electron-builder/issues/9452)
- [VS Code snap electron-launch wrapper](https://github.com/microsoft/vscode/blob/main/resources/linux/snap/electron-launch)
- [Element Desktop Flatpak wrapper](https://github.com/flathub/im.riot.Riot/blob/master/element.sh)
- [Obsidian Flatpak wrapper with GPU cache cleanup](https://github.com/flathub/md.obsidian.Obsidian/blob/master/obsidian.sh)
- [Electron 40 release notes](https://www.electronjs.org/blog/electron-40-0)
- [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
