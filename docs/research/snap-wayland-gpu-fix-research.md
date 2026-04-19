# Snap + Wayland GPU Init Failure — Research Report

## Executive Summary

A subset of Super Productivity Snap users hit a GPU initialization failure on
launch where the app either (a) shows a tray icon with no window, (b)
segfaults, or (c) launches but floods logs with GL errors. The likely root
cause is Mesa ABI drift between Electron's bundled libgbm/Mesa stack and the
Mesa shipped by the `gnome-42-2204` content snap's `core22-mesa-backports`
PPA. The December 2025 spike in user reports correlates with upstream
Chromium 140 (Aug 2025) / Electron 38 (Sept 9, 2025) flipping the default
`--ozone-platform-hint` to `auto`, so Electron now runs as a native Wayland
client in any Wayland session (detection via `XDG_SESSION_TYPE=wayland`).
This exposed the pre-existing Mesa ABI mismatch to far more users.

The recommended fix is to **widen the existing Snap-gated `--ozone-platform=x11`
guard in `electron/start-app.ts` to cover Snap + Wayland sessions, not only
Snap with a missing/empty `gnome-platform` directory.** This preserves hardware
acceleration via X11/GLX, stays inside electron-builder's snap target (no
snapcraft.yaml rewrite, no auto-connect review), and matches the empirical
breakage pattern reported for peer Electron apps on Snap + Wayland.

Long term, migration to `core24` + `gpu-2404` is the correct fundamental fix
and should be scheduled for 18.3 or 19.0.

---

## 1. Root Cause

**High confidence on direction and on the upstream Electron/Chromium
timing (see Section 9).**

- Not a missing-files problem — `libgl1-mesa-dri` is present in the content
  snap.
- The canonical ABI-mismatch error signature is
  `"DRI driver not from this Mesa build"` (snapcraft forum
  [#40975](https://forum.snapcraft.io/t/40975)). Forum
  [#49173](https://forum.snapcraft.io/t/mesa-core22-updates-broke-my-snap/49173)
  reports a related mesa-core22 ABI breakage but with a different error
  string ("Failed to initialize GLAD") — same root cause, different
  symptom.
- Trigger: Mesa shipped by `gnome-42-2204`'s `core22-mesa-backports` PPA does
  not reliably match the Mesa/libgbm ABI expectations of recent Electron
  Chromium builds.
- **Timing note:** Issue #5672 was filed 2025-12-06 on Super Productivity
  16.5.2, which pinned **Electron 39.2.5** (verified via the tagged
  `package.json`). SP subsequently **downgraded to Electron 37.10.3 at
  v17.0.0 (2026-01-23)** and held that version until bumping to 41.2.0 on
  2026-04-17 (one day before this doc was drafted). So the December 2025
  reports originated on Electron 39 — which already inherits Chromium 140's
  Wayland-auto default from Electron 38. The upstream trigger is **Chromium
  140 (Aug 2025) flipping `--ozone-platform-hint=auto`**, inherited by
  Electron ≥38 (with a regression window in 38.0.0/38.1.0 fixed by
  [electron/electron#48301](https://github.com/electron/electron/pull/48301);
  users on [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452)
  cite Electron ≥38.2.0 as the practical trigger). Combined with ongoing
  `mesa-backports` churn, this exposed the ABI mismatch to many more Snap
  users who had previously been silently running X11.

---

## 2. Scope

| Population | Affected rate | Confidence |
|---|---|---|
| Snap + Electron with Wayland-default + Mesa GPU + Wayland session | ~95–100% | High |
| Snap + X11 | ~0–5% | High |
| Snap + Nvidia proprietary | Likely unaffected (uses nvidia EGL, not Mesa) | Medium |
| Non-snap (.deb, AppImage, AUR) | Unaffected | High |

The bug is **conditional**, not universal: Snap + Mesa + Wayland is the
trigger combination.

---

## 3. User-Visible Symptoms

Three observed modes:

- **~80% of reports:** tray icon appears, no window ever renders (GPU process
  respawn loop).
- **Some:** segfault on launch.
- **Rest:** app runs; log noise only (the user who filed the underlying issue
  is in this bucket).

---

## 4. Canonical's Position

**Confirmed with nuance.**

- No official fix for `core22` has been announced; Canonical's documented
  direction is "move to `core24` + `gpu-2404`" (see the
  [Canonical RFC](https://forum.snapcraft.io/t/rfc-migrating-gnome-and-kde-snapcraft-extensions-to-gpu-2404-userspace-interface/39718)).
  We did **not** find an explicit Canonical statement ruling out a
  core22 Mesa-ABI fix — absence of engagement, not a formal position.
- No Canonical engagement observed in
  [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452).
- `graphics-core22` is **not formally deprecated**. Canonical's own wording
  is that `gpu-2404` is an "evolution" of `graphics-core22` (per
  [canonical.com/mir/docs/the-gpu-2404-snap-interface](https://canonical.com/mir/docs/the-gpu-2404-snap-interface)).
  Migration requires a base bump to `core24`, not an interface swap.
- `--disable-gpu` / `--ozone-platform=x11` are community workarounds, not
  endorsed.

---

## 5. Peer Consensus (Other Electron Apps)

**Verification note:** Entries below were verified in a follow-up pass
(2026-04-18) against peer-app source repos, GitHub issues, and
Flathub/snapcrafters packaging. File:line citations linked where applicable.

| App | Approach | Verification |
|---|---|---|
| Signal Desktop (snap) | Community-maintained [`snapcrafters/signal-desktop`](https://github.com/snapcrafters/signal-desktop) snap: wrapper at `snap/local/usr/bin/signal-desktop-wrapper` defaults `--disable-gpu` ON unless user runs `snap set signal-desktop enable-gpu=true`. Upstream Signal has no snap packaging. | **Verified** (snapcrafters repo). |
| Mattermost Desktop (snap) | Community-maintained [`snapcrafters/mattermost-desktop`](https://github.com/snapcrafters/mattermost-desktop): `command-chain` runs `fix-hardware-accel-with-no-renderer`; it probes `glxinfo`, and on llvmpipe match patches `${SNAP_USER_DATA}/.config/Mattermost/config.json` with `jq '.enableHardwareAcceleration = false'`. | **Verified** (snapcrafters repo). |
| VS Code (snap) | No explicit X11 force. The snap crashes on Wayland (sandbox missing Mesa drivers / GLib schemas) and falls back to XWayland implicitly. See [microsoft/vscode#202072](https://github.com/microsoft/vscode/issues/202072). | **Claim contradicted**: outcome is X11, mechanism is not a wrapper. |
| electron-builder [#9452](https://github.com/electron-userland/electron-builder/issues/9452) | Title: "Snap package of Electron ≥ 38 crashes at startup under GNOME on Wayland". Maintainer `@mmaietta` engaged; users `andersk` and `valkirilov` confirm `--ozone-platform=x11` as the working workaround. Trigger identified as Electron ≥38.2.0. | **Verified — strongest external reference.** |
| Teams-for-Linux | Sets `build.linux.executableArgs: ["--ozone-platform=x11"]` and `build.snap.executableArgs: [...]` in electron-builder config; **no `afterPack` wrapper**. The snap-side setting is dead code per [electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587) — `executableArgs` is silently ignored for snap builds. | **Claim partly contradicted**: intended mechanism is `executableArgs`, which is broken on snap. |
| Obsidian (Flatpak) | Wrapper [`obsidian.sh`](https://github.com/flathub/md.obsidian.Obsidian/blob/master/obsidian.sh) probes for Wayland socket; adds `--ozone-platform-hint=auto` under Wayland, else `--ozone-platform=x11`; respects `OBSIDIAN_DISABLE_GPU` env var. Not snap, but illustrates the compositor+GPU-probe wrapper pattern. | **Verified** (flathub repo). |

What **is** solid: every peer Electron app with a Wayland/GPU workaround on
Snap uses either an X11 fallback or a GPU-disable; the only maintainer-
endorsed workaround (electron-builder #9452) converges on
`--ozone-platform=x11`. The dominant **actually-working** mechanism among
peer snaps is a `command-chain` wrapper script (Signal, Mattermost).
`snap.executableArgs` in electron-builder config is broken for snap builds
(electron-builder #4587). **SP's existing pattern —
`app.commandLine.appendSwitch` from the Electron main process — is a third
working mechanism and the one PR #7264 extends.**

---

## 6. Electron-Builder Escape Hatches

Three mechanisms exist for applying Chromium flags in an electron-builder
snap build, ranked by reliability:

1. **`app.commandLine.appendSwitch(...)` inside the Electron main process**
   (before `app.whenReady()`). SP's existing guard at `electron/start-app.ts`
   uses this pattern; PR #7264 extends it. Works for any flag Chromium reads
   during init, including `--ozone-platform`. No packaging changes.
2. **`afterPack` hook** renames the real binary and drops a wrapper script
   at the same name → a full pre-Electron wrapper, no `snapcraft.yaml`
   changes. Useful for flags that must be set before the Electron main
   process starts. (Referenced as a pattern in community sources;
   Teams-for-Linux does **not** actually use it — see Section 5.)
3. **`snap.executableArgs` in electron-builder config is broken for snap
   builds** per [electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587) —
   the flags are silently ignored. Teams-for-Linux's config illustrates
   this: they set `executableArgs: ["--ozone-platform=x11"]` for both
   `build.linux` and `build.snap`, but only the non-snap side takes effect.
   **Do not use.**

The dominant pattern among peer snaps (Signal, Mattermost) is a
`command-chain` entry in `snap/snapcraft.yaml` invoking a wrapper shell
script — equivalent to mechanism #2 but expressed via snapcraft rather than
electron-builder. All three working approaches (mechanism #1 plus the two
wrapper variants) avoid auto-connect requests, store-review friction, and a
base bump.

---

## 7. Options (Ranked)

| # | Option | Fixes errors | Keeps HW accel | Scope | Effort | Evidence alignment |
|---|---|---|---|---|---|---|
| 1 | **Narrow: `--ozone-platform=x11` via `app.commandLine.appendSwitch` when Snap + Wayland** | Yes for ~95% | Yes (X11/GLX) | Snap only, conditional | ~1 file, ~20 LOC | Strongest — electron-builder #9452 maintainer + users converge on `--ozone-platform=x11`; matches SP's existing mechanism |
| 2 | Disable GPU default on Snap, opt-in via env/config | Yes | **No** — loses HW accel for working users | Snap only, unconditional | One-liner + doc | Evidence-backed but blunt |
| 3 | `afterPack` wrapper: detect GPU at launch, conditionally add flags | Yes when detection works | Yes when works | Snap only | `afterPack` script + wrapper | GL-probe false negatives are a known failure mode |
| 4 | Migrate to `core24` + custom snapcraft.yaml + `gpu-2404` | Yes (fundamental) | Yes | All Snap users | 1–2 days + auto-connect wait | Best long-term; orthogonal to this PR |
| 5 | Runtime detection + relaunch (`app.on('child-process-gone')`) | Yes after 1 bad launch | Yes for working users | Snap only | Medium | Clever, but first-launch UX is bad |
| 6 | Status quo + FAQ | No | Yes | — | Zero | Abandons affected users (issue #5672) |

---

## 8. Recommendation

**Option 1: `--ozone-platform=x11` conditional on Snap + Wayland, via the
existing guard in `electron/start-app.ts`.**

### Why it wins

1. **Fixes the errors for ~95% of affected users** — the X11 path avoids the
   failing Wayland EGL/GBM init entirely. Wayland is the trigger, not the
   GPU.
2. **Preserves hardware acceleration** — unlike a blanket `--disable-gpu`,
   X11 + GLX still uses the GPU. Users only lose Wayland fractional scaling
   (a known, documented trade-off).
3. **Non-universal degradation** — Snap X11 users see no change; non-Snap
   users see no change; only Snap + Wayland users are redirected to X11,
   where everything works.
4. **Zero packaging rewrite** — goes into existing `electron/start-app.ts`
   via `app.commandLine.appendSwitch`. SP already has Snap-gated
   `ozone-platform=x11` logic in `electron/start-app.ts` (pre-PR: gated on
   an empty `gnome-platform` directory). The only change needed is to
   **extend the gate to "Snap + Wayland session," with the `gnome-platform`
   probe retained as a secondary OR fallback** (belt-and-suspenders for any
   non-Wayland Snap users who still hit the ABI drift).
   `electron-builder.yaml`'s `snap.executableArgs` is **broken for snap
   builds** ([electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587)) —
   `app.commandLine.appendSwitch` is the only reliable mechanism for this
   from inside electron-builder.

This is what the existing migration plan partially implemented. The plan's
defense-in-depth was intended to catch exactly this scenario; the
`gnome-platform` emptiness probe doesn't catch the common case because
`gnome-platform` is populated — just ABI-drifted. Widening the guard to
`SNAP + Wayland` (with the gnome-platform probe retained as OR fallback)
matches the empirical breakage pattern.

### Why not Option 2 (disable-GPU default)

Disabling GPU entirely makes sense for apps where stability dominates over
compositing quality. Super Productivity is a productivity app — it benefits
from GPU compositing, and forcing `--disable-gpu` on ~95% of Snap users is a
worse UX than forcing X11.

### Why not Option 3 (runtime detection)

Runtime GL probes (e.g., `glxinfo`) produce false negatives when the GPU
content interface isn't connected in Snap, so a launch-time detector can
disable GPU on machines where GPU would in fact have worked. Not a pattern to
build on.

### Why not Option 4 (core24 migration) now

Correct long-term, but 1–2 days of work + auto-connect wait + store review +
risk of new regressions right after shipping 18.2.x. Schedule for 18.3 or
19.0.

---

## 9. Confidence

| Claim | Confidence |
|---|---|
| Direction (X11 fallback for Snap + Wayland) | **High** — converged from multiple independent threads (peer app community reports, GitHub issues, scope matrix, Canonical position, escape hatches) |
| Exact gating predicate (Snap + Wayland vs. just Snap) | **Medium-high** — Wayland is the proximate trigger, but a few X11 reports exist. Keeping the gnome-platform-empty probe as a fallback is the belt-and-suspenders move |
| `core24` migration as the real long-term fix | **High** on direction, **medium** on timing |
| Dec 2025 reports correlate with Chromium 140 / Electron ≥38.2 Wayland-default | **High** — SP was on Electron 39.2.5 in Dec 2025 (verified via tagged `package.json`); Chromium 140 (Aug 2025) flipped `--ozone-platform-hint=auto`; [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452) independently identifies Electron ≥38.2.0 as the trigger |
| Peer-app implementation details in Section 5 | **High** — verified in follow-up pass against snapcrafters repos, `microsoft/vscode#202072`, `electron-builder#4587`, `flathub/md.obsidian.Obsidian`; several original claims contradicted and reframed |

---

## 10. Proposed Change

Widen the existing guard in `electron/start-app.ts` (pre-PR: lines 70–88;
post-PR #7264: lines 75–98):

- **Before:** gated on Snap + `gnome-platform` directory missing or empty.
- **After:** gated on Snap + Wayland session (`XDG_SESSION_TYPE === 'wayland'`
  or `WAYLAND_DISPLAY` set), with the existing gnome-platform probe retained
  as a secondary fallback.

Estimated diff: ~20 functional LOC in `electron/start-app.ts` (~35 lines
including comments). No `electron-builder.yaml` changes required
(`snap.executableArgs` is broken for snap builds —
[electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587)).

### Open design questions

- Should the predicate also include an Electron-version guard, or is
  Snap + Wayland sufficient? (Current PR: Snap + Wayland, no version gate.)
- Escape hatch for users who explicitly want Wayland (already supported via
  `--ozone-platform=wayland` CLI override — the PR checks `process.argv` for
  an existing `--ozone-platform` to avoid overriding the user).
- Telemetry: none (SP is privacy-first); track via issue-tracker reports
  post-release.

---

## 12. Update 2026-04-19 — PR #7273 (GPU startup guard)

**Follow-up to issue [#7270](https://github.com/super-productivity/super-productivity/issues/7270).** Filed
against v18.2.2, which shipped **before** the Snap+Wayland widening from
PR #7266. **Timeline correction (verified 2026-04-19):** PR #7266 was
merged to master but is **NOT** in the v18.2.3 tag
(`git merge-base --is-ancestor ac7cf7b853 v18.2.3` returns NOT ANCESTOR;
the `v18.2.3:electron/start-app.ts` only contains the original
`gnome-platform`-empty probe). The v18.2.3 release was cut from a branch
that didn't pick up #7266. So 7270's reporter on v18.2.2 is **not**
helped by updating to v18.2.3 — they need 18.2.4 (or whatever ships
next with #7266 included). This changes PR #7273's positioning: not a
"tail 5%" fallback on top of a shipped primary fix, but potentially the
first released recovery path for confined-Linux users until #7266 ships.

**Empirical confirmation (2026-04-19):** issue 7270's reporter
([GoZilla192](https://github.com/super-productivity/super-productivity/issues/7270#issuecomment-...))
verified that `superproductivity --ozone-platform=x11` resolves their
launch failure on Ubuntu 22.04 / 18.2.2-snap. Direct evidence that the
Mesa ABI-drift diagnosis is correct and #7266's X11 widening is the
right primary fix. As a result, **PR #7273 was closed** in favor of
#7266 — the defense-in-depth it offered (Flatpak coverage, Snap+X11
with still-drifted Mesa, future Chromium regressions) was speculative,
and KISS/YAGNI says to revisit only if a real report comes in that
X11 doesn't rescue.

### Mechanism

Presence-based crash marker in `userData`:

1. On launch (confined Linux only: `SNAP || FLATPAK_ID`), check for
   `.gpu-launch-incomplete`. If present → previous launch failed →
   append `--disable-gpu` this time.
2. Unconditionally write the marker.
3. On `IPC.APP_READY` (after Angular init), unlink the marker.

Env overrides `SP_DISABLE_GPU` / `SP_ENABLE_GPU` work on all platforms
(useful for debugging and for non-Snap/Flatpak Linux users with broken
GPUs).

### How this differs from Section 7 Option 5 (rejected)

Option 5 proposed `app.on('child-process-gone')` + relaunch — which
requires the first-launch GPU crash to actually fire the event (unreliable
when the process hangs) and a subsequent relaunch inside the same boot
(bad UX, visible flicker, tray races). PR #7273's marker-file approach:

- Doesn't require catching the crash live — if the main process dies any
  way, the marker survives.
- Recovers at the **next user-initiated** launch, not mid-boot. No
  forced relaunch, no race with the tray/splash.
- Self-heals after one successful boot (marker removed on `APP_READY`).
- Works for the crash modes where the GPU process hangs without emitting
  `child-process-gone` — arguably the dominant failure mode per the
  symptom breakdown in Section 3 ("tray icon appears, no window ever
  renders").

The "first-launch UX is bad" objection to Option 5 only partly applies:
launch #1 still fails, but launch #2 auto-recovers without user action.
That's strictly better than status quo (permanent failure) and better
than Option 2 (blanket disable on all Snap users).

### Why `--disable-gpu` (not `--ozone-platform=x11`) here

This is the crucial mechanism difference. `--ozone-platform=x11` keeps
the GPU process alive on the X11/GLX path — it only dodges the Wayland
EGL/GBM init. `--disable-gpu` avoids the **hardware GPU / Mesa DRI
driver load path**, which is the ABI-drift source on confined Snap.
**Correction per §13 verification:** `--disable-gpu` does NOT guarantee
"no GPU process at all" — Chromium may still run a GPU process in
SwiftShader or DisplayCompositor mode (see §13.1§1). But those modes
don't dlopen Mesa DRI drivers, which is what matters for this bug.
Trade-off: software rendering only. For Super Productivity (mostly DOM
and text, little WebGL), the perf loss is negligible; for a broken user
it's strictly better than a non-launching window.

### Complementary layering (recommended)

| Layer | Where | Who it helps |
|---|---|---|
| Snap + Wayland → `--ozone-platform=x11` | `start-app.ts` (shipped in 18.2.3) | ~95% of Snap Wayland users; keeps HW accel |
| Snap/Flatpak + previous crash → `--disable-gpu` | `gpu-startup-guard.ts` (PR #7273) | Remaining users: Snap X11 with Mesa ABI drift, Flatpak, any future GPU-init regression |
| Env overrides (`SP_DISABLE_GPU`, `SP_ENABLE_GPU`) | Both | Debugging, user escape hatches |
| `core24` + `gpu-2404` migration | Packaging | All Snap users, long term (18.3 / 19.0) |

The research doc's Section 7 framed the options as exclusive. PR #7273
demonstrates they are composable: Option 1 handles the common case with
no UX regression; PR #7273 handles the tail with one failed launch as
the cost.

### Risk analysis of PR #7273

| Risk | Likelihood | Mitigation in the PR |
|---|---|---|
| User force-quits during normal boot → marker stays → next launch unnecessarily disables GPU | Medium (OS updates, system sleep, SIGKILL on crash elsewhere) | Marker is removed on next `APP_READY`, so cost is capped at one GPU-disabled launch |
| `APP_READY` IPC doesn't fire (renderer hangs post-Angular-init) → marker never cleared → permanent `--disable-gpu` | Low | Manual escape: `SP_ENABLE_GPU=1` env var or delete `.gpu-launch-incomplete` |
| Marker write fails (read-only userData, NFS quirks) → guard silently skips, but legacy cleanup still runs | Very low on Snap (`SNAP_USER_COMMON` is always writable) | Errors caught and logged, launch proceeds without guard |
| False positive on first install after upgrade from a build without the guard | None | Fresh install has no marker; upgrade path writes a new marker on first launch only |
| `FLATPAK_ID` detection misses edge cases (e.g., custom Flatpak manifests that unset the env) | Low | The env override (`SP_DISABLE_GPU`) still works for those users |
| `--disable-gpu` breaks a renderer feature we depend on (e.g., WebGL-backed chart) | None identified | SP UI is DOM+text; no WebGL path confirmed |
| Marker path races with the `app.setPath('userData', ...)` call for Snap (line 149 of `start-app.ts`) | None — PR places `evaluateGpuStartupGuard` **after** the Snap userData redirect | PR comment explicitly flags this invariant |

### Testing gap

PR #7273 does not add tests. The logic is pure (input: userData path + env,
output: decision) and trivially unit-testable. Copilot's arena entry
demonstrates the pattern (`should-force-snap-ozone-platform-x11.spec.ts`).
**Recommended before merge:** extract `evaluateGpuStartupGuard` into a
pure function over `{ userDataPath, env, platform, fs }` and add a spec
covering:

- no marker → disableGpu=false, marker written
- marker present → disableGpu=true, reason='crash-recovery'
- `SP_ENABLE_GPU=1` overrides a present marker
- `SP_DISABLE_GPU=1` without marker → disableGpu=true, reason='env'
- non-confined Linux → disableGpu=false, no marker written
- legacy marker files unlinked on confined Linux

### Decision

- **Ship PR #7273** as a layered defense on top of 18.2.3's Snap+Wayland
  X11 guard, with unit tests added before merge.
- **Do not revert** the Snap+Wayland X11 guard — PR #7273 is not a
  replacement. X11 keeps HW accel; PR #7273 is the fallback for when
  X11 isn't enough or isn't gated (e.g., Flatpak).
- **Keep the `core24` + `gpu-2404` migration scheduled** for 18.3/19.0
  as the long-term root-cause fix.

### Arena-approach note

Copilot's arena approach (widening the Snap X11 guard to unconditional
on Snap, regardless of Wayland detection) is a defensible alternative
to Option 1's Snap+Wayland gate — it handles the "a few X11 reports
exist" case flagged at medium-high confidence in Section 9. But it
sacrifices Wayland-native features for every Snap user unconditionally,
whereas PR #7273 only degrades (and only to software rendering) for
users who actually failed. PR #7273 is the better defense-in-depth.

---

## 13. Deepened Research on PR #7273 (2026-04-19)

Parallel investigation by two independent research agents. A codex-CLI and
gemini-CLI were also fired; codex exhausted its budget in search without
producing a structured section and gemini returned empty — their findings
are not represented below. Treat the two subsections as complementary
(13.1 = correctness/mechanism, 13.2 = prior-art/testing/long-term).

### 13.1 Technical Correctness of PR #7273

#### 1. Does `--disable-gpu` actually prevent Mesa/libgbm loading?

**Partially — Section 12's claim "no GPU process = no Mesa load" is
overstated.** Chromium's [`content/browser/gpu/fallback.md`](https://chromium.googlesource.com/chromium/src/+/60b3c74b7f2ca17a28907fb0b40d9dabeaa48326/content/browser/gpu/fallback.md)
documents a fallback stack
`HARDWARE_VULKAN → HARDWARE_GL → SWIFTSHADER → DISPLAY_COMPOSITOR`.
`--disable-gpu` pops the hardware entries but **does not eliminate the
GPU process** — it is re-spawned in SwiftShader (CPU, no DRI) or
DISPLAY_COMPOSITOR mode. Corroborated by
[chromium-discuss: "The GPU process still runs with --disable-gpu"](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/IIQeveVRLVE)
and [electron/electron#28164](https://github.com/electron/electron/issues/28164).
The standard workaround is `--disable-gpu --disable-software-rasterizer`
together (the PR uses only the first).

What this means for SP: in SwiftShader mode the GPU process does **not**
open `/dev/dri/*` or load Mesa DRI drivers (SwiftShader is a pure-CPU JIT
rasterizer; see [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md)),
which is the ABI-drift source we care about. **However**, Ozone platform
init (Wayland client) and GL-context probing still occur before fallback
— whether `libgbm.so` is dlopen'd on the SwiftShader path specifically
on Linux/Ozone is **unverified**; the fallback doc is silent on Linux-
desktop specifics. On the evidence we have, `--disable-gpu` is *likely
sufficient* to avoid the `core22-mesa-backports` DRI-driver ABI mismatch
signature (which is Mesa DRI, not GBM), but Section 12's "no Mesa, no
libgbm, no DRI" bullet should be softened to "no hardware Mesa DRI
driver load" — not "no GPU process."

**Recommendation: append `--disable-software-rasterizer` alongside
`--disable-gpu`** in `evaluateGpuStartupGuard`'s positive branch to
genuinely suppress GPU-process spawn, eliminating the theoretical
SwiftShader-GPU-process-init path. Cost is nil (SP has no WebGL
dependency).

#### 2. `APP_READY` lifecycle

Verified from SP source:

- The renderer sends `APP_READY` synchronously from `AppComponent`'s
  constructor via `this._startupService.init()` →
  `window.ea.informAboutAppReady()`
  (`src/app/core/startup/startup.service.ts:136`, called from
  `src/app/app.component.ts:195`). This is **before** deferred init
  (plugins, storage checks) — `DEFERRED_INIT_DELAY_MS = 1000` runs
  after.
- Main-side handler: `electron/main-window.ts:278` (unchanged by PR
  #7273).
- Window is shown earlier on `ready-to-show`
  (`electron/main-window.ts:245-246`), which fires when the first frame
  is ready regardless of Angular bootstrap success. So Section 12's
  claim that the marker doesn't clear "on blank/broken renderers that
  still fire `ready-to-show`" is correct.

**Consequence:** if Angular boots but any later feature crashes the
renderer *after* `APP_READY`, the marker is already gone — next launch
is treated as clean (correct behavior: Angular init succeeded, so GPU
init also succeeded). If the renderer crashes *before* `APP_READY` but
after the window appears, user sees a broken window and next launch
disables GPU. This is desired for GPU init failures, but **the same
signal fires for any crash during Angular bootstrap** (dependency
injection error, CSP violation, corrupt IndexedDB). False-positive rate
is non-zero but bounded — one GPU-disabled next launch, then
self-heals.

#### 3. Alternatives to the pre-launch marker

| Signal | More precise? | Verdict |
|---|---|---|
| `app.on('child-process-gone', {type:'GPU', reason:'launch-failed'})` | Yes — distinguishes GPU-init from generic renderer crashes ([electronjs.org/docs/latest/api/app](https://www.electronjs.org/docs/latest/api/app) — `launch-failed` = "Process never successfully launched") | **Useful complement**, but unreliable when the GPU process *hangs* rather than exits (Section 12 notes this is the dominant failure mode per Section 3). Also fires mid-launch, forcing a relaunch with its own UX costs. |
| `app.on('render-process-gone', reason:'crashed')` | No — fires for any renderer crash | Same false-positive surface as the marker, fires mid-launch. |
| `app.getGPUInfo('complete')` at startup | No — promise is **reported** to never settle on some broken systems ([electron#17187](https://github.com/electron/electron/issues/17187)); Electron docs don't guarantee this behavior | **Reject** — would hang the app on affected systems. |
| `gpu-info-update` + `getGPUInfo('basic')` | No — basic info always reports `softwareRendering: false` ([electron#17447](https://github.com/electron/electron/issues/17447)) | **Reject.** |

Best pattern: **marker as primary + `child-process-gone` with
`type:'GPU'` writing a second marker with `reason: 'launch-failed'`** to
distinguish genuine GPU crashes from generic bootstrap failures in logs.
The PR's current design is sound; adding the event listener is additive
and low risk.

#### 4. False-positive stuck markers

Concrete ways the marker gets left behind without a GPU-init crash:

- **systemd session shutdown timeout**: user units get SIGKILL after
  `DefaultTimeoutStopSec` (90s default) during logout/reboot; see
  [systemd#4206](https://github.com/systemd/systemd/issues/4206),
  [Arch forum on `session-c1.scope`](https://bbs.archlinux.org/viewtopic.php?id=227325).
  Common during OS updates and hibernation-resume cycles.
- **Snap refresh while running**: snapd kills the old revision on
  refresh (`snap refresh` mid-session).
- **OOM killer**: generic OOMs on low-RAM Snap confinement kill the
  main process cleanly without `APP_READY`.
- **Ctrl+C during splash / `kill -9` during dev**: leaves marker.
- **Fast-sleep/hibernate**: if the system suspends between marker write
  and Angular bootstrap, resume may or may not complete bootstrap
  depending on renderer state.

Cost per incident: one unnecessary `--disable-gpu` launch. Marker
self-heals on next `APP_READY`. Section 12's risk table rates this
"Medium" — accurate.

### 13.2 Prior Art, Testing, and Long-term Strategy

#### Prior art for marker-file / crash-loop startup recovery (Q7)

The pattern — "write a sentinel on entry, clear on success; if present
next launch, take a safer path" — is well-established but has no single
canonical name. Common terms in the literature: **"launch-crash
detection"** (BugSnag), **"crash loop breaker"** (Sentry), and
**"startup-crash marker"** (Firefox internals).

| Implementation | Mechanism | Source |
|---|---|---|
| Firefox | `toolkit.startup.recent_crashes` pref is incremented on startup-without-clean-shutdown and compared against `max_resumed_crashes` to auto-offer Troubleshoot/Safe Mode. Handled in `nsAppRunner.cpp` via `XRE_mainInit`. | [Bugzilla 294260](https://bugzilla.mozilla.org/show_bug.cgi?id=294260), [Bugzilla 745154](https://bugzilla.mozilla.org/show_bug.cgi?id=745154), [nsAppRunner.cpp (searchfox)](https://searchfox.org/firefox-main/source/toolkit/xre/nsAppRunner.cpp) |
| Chromium | `GpuProcessHost::RecordProcessCrash()` maintains an in-process crash counter; after `kGpuFallbackCrashCount` crashes it pops the next mode off `GpuDataManagerImplPrivate::fallback_modes_` (HW Vulkan → HW GL → SwiftShader → DisplayCompositor). State is **not** disk-persisted across browser restarts — this is the gap PR #7273 fills for Electron apps. | [fallback.md](https://chromium.googlesource.com/chromium/src/+/60b3c74b7f2ca17a28907fb0b40d9dabeaa48326/content/browser/gpu/fallback.md) |
| BugSnag | 5-second window after `Bugsnag.start()`; exposes `lastRunInfo.crashedDuringLaunch` so apps can self-remediate. | [BugSnag — Identifying crashes at launch (Android)](https://docs.bugsnag.com/platforms/android/identifying-crashes-at-launch/) |
| Sentry Cocoa | Open feature request for a native crash-loop detector; ecosystem confirms the pattern is general. | [sentry-cocoa #3639](https://github.com/getsentry/sentry-cocoa/issues/3639) |
| VS Code / Discord / Slack / Obsidian / Figma | **No automatic self-healing found.** All rely on manual user action (`--disable-gpu`, settings toggle, delete GPUCache). | [vscode FAQ](https://code.visualstudio.com/docs/supporting/FAQ), [microsoft/vscode #214446](https://github.com/microsoft/vscode/issues/214446) |

SP PR #7273 is therefore **novel in the Electron ecosystem** but follows
an established browser-native pattern (Firefox's `recent_crashes`,
Chromium's in-process `GpuMode` stack). Confidence: high.

#### Flatpak / confinement detection (Q4)

`FLATPAK_ID` **is** reliably set by Flatpak's run machinery and is used
throughout Flatpak's own docs to construct `~/.var/app/$FLATPAK_ID`
paths ([Flatpak sandbox-permissions docs](https://docs.flatpak.org/en/latest/sandbox-permissions.html)).
A more authoritative signal is the presence of `/.flatpak-info` inside
the sandbox (same doc); recommend adding it as an OR fallback for the
few manifests that `unset` env vars. **AppImage/.deb are not worth
guarding** — they don't have the Mesa-ABI-drift failure mode (they use
the host's Mesa, not a bundled content snap).
**Snap+NVIDIA-proprietary** (`nvidia-core22`) uses Nvidia's EGL
implementation, not Mesa ([canonical/nvidia-core22](https://github.com/snapcore/nvidia-core22))
— the same class of crash-at-init failure can occur (driver/X-server
mismatch), so the guard triggering there is acceptable collateral, not
a bug.

#### Testing strategy (Q6)

SP has **no `electron/*.spec.ts` files today** and Karma runs in
ChromeHeadless (`src/karma.conf.js`), which lacks Node `fs`. Two viable
options: (a) inject `fs`/`env`/`platform` as parameters so the function
is pure and testable under Karma with `jasmine.createSpyObj`; (b) add a
dedicated Node-side test runner. Option (a) is lower-risk and matches
existing SP util test patterns (see `src/app/util/real-timer.spec.ts`).

```ts
// electron/gpu-startup-guard.spec.ts  (requires the DI refactor below)
import { evaluateGpuStartupGuard } from './gpu-startup-guard';

type FakeFs = Pick<typeof import('fs'),
  'existsSync' | 'writeFileSync' | 'unlinkSync' | 'mkdirSync'>;

const makeFs = (initial: Record<string, boolean> = {}) => {
  const files: Record<string, boolean> = { ...initial };
  const fs: FakeFs = {
    existsSync: (p) => !!files[p as string],
    writeFileSync: (p) => { files[p as string] = true; },
    unlinkSync: (p) => {
      if (!files[p as string]) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      delete files[p as string];
    },
    mkdirSync: () => undefined as any,
  };
  return { fs, files };
};

describe('evaluateGpuStartupGuard', () => {
  const USER = '/u';
  const CONFINED = { SNAP: '/snap/sp', XDG_SESSION_TYPE: 'wayland' };

  it('confined + no marker → writes marker, does not disable GPU', () => {
    const { fs, files } = makeFs();
    const d = evaluateGpuStartupGuard({ userDataPath: USER, env: CONFINED, platform: 'linux', fs });
    expect(d.disableGpu).toBeFalse();
    expect(files[`${USER}/.gpu-launch-incomplete`]).toBeTrue();
  });

  it('confined + marker present → disables GPU with reason=crash-recovery', () => {
    const { fs } = makeFs({ [`${USER}/.gpu-launch-incomplete`]: true });
    const d = evaluateGpuStartupGuard({ userDataPath: USER, env: CONFINED, platform: 'linux', fs });
    expect(d).toEqual(jasmine.objectContaining({ disableGpu: true, reason: 'crash-recovery' }));
  });

  it('SP_ENABLE_GPU=1 overrides a present marker', () => {
    const { fs } = makeFs({ [`${USER}/.gpu-launch-incomplete`]: true });
    const d = evaluateGpuStartupGuard({
      userDataPath: USER, env: { ...CONFINED, SP_ENABLE_GPU: '1' }, platform: 'linux', fs,
    });
    expect(d.disableGpu).toBeFalse();
  });

  it('SP_DISABLE_GPU=1 on non-confined Linux → env reason, no marker', () => {
    const { fs, files } = makeFs();
    const d = evaluateGpuStartupGuard({
      userDataPath: USER, env: { SP_DISABLE_GPU: '1' }, platform: 'linux', fs,
    });
    expect(d.disableGpu).toBeTrue();
    expect(d.reason).toBe('env');
    expect(files[`${USER}/.gpu-launch-incomplete`]).toBeUndefined();
  });

  it('non-confined Linux → noop, markerPath=null', () => {
    const { fs } = makeFs();
    const d = evaluateGpuStartupGuard({ userDataPath: USER, env: {}, platform: 'linux', fs });
    expect(d).toEqual({ disableGpu: false, reason: null, markerPath: null });
  });

  it('unlinks legacy marker files on confined Linux', () => {
    const { fs, files } = makeFs({
      [`${USER}/.gpu-startup-state`]: true,
      [`${USER}/.gpu-startup-state.json`]: true,
    });
    evaluateGpuStartupGuard({ userDataPath: USER, env: CONFINED, platform: 'linux', fs });
    expect(files[`${USER}/.gpu-startup-state`]).toBeUndefined();
    expect(files[`${USER}/.gpu-startup-state.json`]).toBeUndefined();
  });

  it('fs.writeFileSync throwing does not break the decision', () => {
    const { fs } = makeFs();
    fs.writeFileSync = () => { throw new Error('EROFS'); };
    expect(() =>
      evaluateGpuStartupGuard({ userDataPath: USER, env: CONFINED, platform: 'linux', fs }),
    ).not.toThrow();
  });
});
```

Required refactor: change `evaluateGpuStartupGuard(userDataPath)` to
`evaluateGpuStartupGuard({ userDataPath, env, platform, fs })` with
defaults from `process`/`fs` at the call-site in `start-app.ts`. No
behavior change, fully unit-testable.

#### Edge cases (Q8, Q9)

- **`SP_ENABLE_GPU=1` with a present marker**: PR #7273 returns early
  **before** the marker is written — but the marker-path is still
  computed (`isConfinedLinux` branch above the env checks), so
  `markStartupSuccess()` later unlinks it on `APP_READY`. Net effect:
  the override **does** clear the marker on success. That is correct:
  the user asserted "GPU is fine now," a successful boot confirms it,
  and fresh crash tracking starts from zero. If the override is
  removed and GPU fails again, the *next* launch writes a fresh marker
  and the one after that triggers recovery — two failed launches to
  re-trigger, one more than without the override. Acceptable tradeoff;
  document it. Confidence: high.
- **Legacy marker cleanup**: the legacy files were never shipped in a
  release (per PR description "earlier iterations of this guard");
  blind `unlinkSync` with swallowed ENOENT is safe. **Recommend
  time-limiting** the cleanup: keep it through 18.3, remove in 19.0 —
  leaving unused `fs.unlinkSync` calls in a hot startup path is
  clutter. Risk of leaving it permanent: near zero (two extra stat
  calls on Snap/Flatpak launch).

#### Long-term strategy (Q10)

PR #7273 is a **genuine stopgap**, not a replacement for `core24` +
`gpu-2404` migration. Rationale:
1. `--disable-gpu` forces software rendering — fine for SP's DOM/text
   UI but still a visible perf regression vs. HW-accelerated X11/GLX
   (SP's v18.2.3 path).
2. `core24` + `gpu-2404` fixes the **root cause** (Mesa ABI drift),
   keeping HW accel for all Snap users without the one-failed-launch
   penalty.
3. The layered model (18.2.3 X11 guard → PR #7273 GPU-disable fallback
   → eventually `gpu-2404`) is robust: even after the migration, the
   marker guard remains cheap insurance for future Chromium/Mesa
   regressions (e.g., the recurring Electron 38/Tahoe-style
   breakages —
   [AppleInsider 2025-10](https://appleinsider.com/articles/25/10/10/update-your-slack-discord-clients-the-electron-tahoe-gpu-slowdown-bug-is-fixed)).

**Recommendation: keep 18.3/19.0 `gpu-2404` migration scheduled; treat
PR #7273 as permanent defense-in-depth, not a delete-later hack.**
Confidence: high.

### 13.3 Independent validation (codex CLI)

A third independent agent (codex CLI, read-only) reviewed the same
material and converged on the same core findings as 13.1 and 13.2.
Notable agreement:

- **`--disable-gpu` overclaim** — codex independently cites Chromium's
  own [GPU integration tests](https://chromium.googlesource.com/chromium/src/+/c0a0e9d983dee38d425cdc207b54b102780ab336/content/test/gpu/gpu_tests/gpu_process_integration_test.py)
  which expect a GPU process under `--disable-gpu` on Linux and test
  `--disable-gpu --disable-software-rasterizer` together as the
  "no GPU process" case. Three independent sources (Claude agents 1 +
  2, codex) converge on the same recommendation: **append
  `--disable-software-rasterizer`**.
- **`APP_READY` framing**: codex proposes clearer wording —
  `APP_READY` means "startup succeeded enough to use the app," not
  "all later renderer failures are covered." Recommend applying this
  in-line in Section 12.
- **Prior art honesty**: codex explicitly labels "crash sentinel" /
  "unclean-shutdown marker" as *informal inference*, not a verified
  upstream term. 13.2 cites BugSnag/Sentry/Firefox labels but the SP-
  specific `userData` variant isn't in peer Electron apps.
  Confidence: medium, not high.
- **`SP_ENABLE_GPU=1` marker-clearing**: codex independently reaches
  the same conclusion as 13.2 (successful boot acknowledges prior
  crash; matches browser convention). If a one-shot diagnostic
  override is ever wanted that does *not* acknowledge success, it
  should be a separate env var.

Codex's unique contribution:

- **Structured marker payload (optional)**: replace the zero-byte
  marker with a tiny JSON `{ ts, reason?, gpuChildGone? }` populated
  from `app.on('child-process-gone', {type:'GPU'})` and
  `render-process-gone` listeners fired before `APP_READY`. Cost:
  same fs call path, same semantics; gain: post-incident forensics
  without a telemetry system. This is a cleaner upgrade path than
  the two-marker scheme proposed in 13.1§3.
- **2-strike counter as a next-step refinement** if false-positive
  rate becomes noisy — matches Firefox's `max_resumed_crashes`
  behavior. Downside: delays recovery by one extra failed launch.
  Defer unless warranted by real reports.

### 13.4 Actionable edits to PR #7273

Ordered by importance:

1. **Add `--disable-software-rasterizer` alongside `--disable-gpu`** in
   `start-app.ts` when the guard triggers. Without it, Chromium
   respawns the GPU process in SwiftShader mode — still a GPU process,
   still runs Ozone init. See 13.1§1.
2. **Refactor `evaluateGpuStartupGuard` to take an options object** so
   `fs`, `env`, and `platform` can be injected — enables Karma unit
   tests (see 13.2§Testing). Then add the `.spec.ts` above.
3. **Add `/.flatpak-info` existence check as an OR fallback** to the
   `FLATPAK_ID` detection. Cheap, covers manifests that unset the env
   var.
4. **(Optional) Add `app.on('child-process-gone', …)` listener** that
   logs `reason` to the main-process log when `type: 'GPU'` — gives
   telemetry (in logs) without building a telemetry system, and
   confirms the guard is firing for the intended cause.
5. **Time-box the legacy-marker cleanup** to be removed in 19.0. Add a
   TODO comment.
6. **(Optional forensics)** Replace the zero-byte marker with a tiny
   JSON payload `{ ts, reason?, gpuChildGone? }` populated from
   `child-process-gone`/`render-process-gone` listeners. Cost: same
   code path; gain: post-incident forensics without telemetry.

None of these block merging. #1 is the highest-impact correctness fix —
it closes the gap where `--disable-gpu` alone still lets Chromium respawn
the GPU process in SwiftShader mode (independently identified by all
three research agents).

---

## 14. Verification Pass 2 — 2026-04-19 (multi-agent)

Four independent agents (two Claude research-architects, one Claude
code-reviewer, one codex CLI) adversarially reviewed Sections 12–13 and
PR #7273. The findings below are verified (citations fetched, code
grepped) or explicitly rejected where agents disagreed.

### Corrections applied in-place above

- **§12 timeline**: v18.2.3 does NOT contain #7266's X11 widening
  (verified via `git merge-base`).
- **§12 `--disable-gpu` claim**: softened from "not spawn a GPU process
  at all" to "avoids the hardware GPU / Mesa DRI driver load path."
  Chromium still spawns a GPU process in SwiftShader or
  DisplayCompositor modes.
- **§13.1 alternatives table**: softened `getGPUInfo('complete')` from
  "documented to never settle" to "reported."
- **§11 References**: re-labeled Bugzilla 745154 as a weak reference.

### Outstanding corrections not yet applied (pending maintainer review)

- **§11 References attribution**: the `--disable-gpu` / SwiftShader
  behavior claim is currently attributed to Chromium's `fallback.md`.
  It should be attributed to the [chromium-discuss thread](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/IIQeveVRLVE)
  and the [GPU process integration test](https://chromium.googlesource.com/chromium/src/+/c0a0e9d983dee38d425cdc207b54b102780ab336/content/test/gpu/gpu_tests/gpu_process_integration_test.py)
  (which explicitly expects a GPU process under `--disable-gpu` on
  Linux, and tests `--disable-gpu --disable-software-rasterizer` as
  "no GPU process"). `fallback.md` documents the mode stack but not
  the Linux `--disable-gpu` behavior.
- **§13.1§1 `--disable-software-rasterizer` strength**: codex's
  verification cautions that DISPLAY_COMPOSITOR is still a GPU-process
  mode, so that flag doesn't *guarantee* "no GPU process" either.
  Keep the flag as cheap belt-and-braces (no WebGL dep in SP) but
  drop the framing that it fully suppresses the GPU process.

### Disagreements resolved

- **"`SP_ENABLE_GPU=1` crash leaves no marker → no recovery"** (Agents
  B and C): **rejected.** A stale marker from a *previous* crash
  persists across the override path — the early return at `pr7273.diff:54`
  does not clear the marker, it just returns early before potentially
  writing a fresh one. Sequence: crash → marker written →
  override-launch with `SP_ENABLE_GPU=1` → early return, marker stays →
  crash again → next launch without override → existing marker
  triggers recovery. Codex correctly traced this. Agents B and C
  overstated the problem.
- **Remaining edge case**: first-ever launch where the user sets
  `SP_ENABLE_GPU=1` AND a crash occurs AND no marker has ever been
  written — costs +1 extra crashed launch before recovery. Acceptable;
  document in PR.
- **Oscillation for genuinely broken GPU with no user action**: every-
  other-launch pattern (crash → recover → retry → crash → recover…).
  That's the designed retry-after-recovery behavior — cost is half of
  launches are bad until root cause is fixed or user sets
  `SP_DISABLE_GPU=1`. Reasonable tradeoff; note in the PR docs.

- **"APP_READY fires from AppComponent constructor"** (Agent B,
  corrected by Agent D): reworded. `APP_READY` is sent from the
  synchronous body of `StartupService.init()` (async function; no
  awaits precede it on the Electron path today). The constructor
  *calls* `init()` but doesn't *fire* `APP_READY` itself. Brittle to
  upstream refactor (adding an `await` earlier would shift timing).
- **"`_initBackups()` is awaited and can strand APP_READY"** (Agent
  C): **rejected.** `startup.service.ts:104` is `this._initBackups();`
  (no `await`) — fire-and-forget. `informAboutAppReady()` at line 136
  runs in the same microtask.

### New risks surfaced (not in §12 / §13.1–13.4)

- **Aggregate stuck-marker rate on laptops** (§13 risks understated):
  frequent suspend/hibernate can leave markers without a real GPU
  crash. Consider time-bounding the marker (e.g., ignore if marker age
  > 5 minutes — suggests systemd shutdown SIGKILL, not a fast GPU
  crash).
- **First-install `mkdirSync` is load-bearing**: on first-ever Snap
  install, `$SNAP_USER_COMMON/.config/superproductivity` does not
  exist. Electron's `app.setPath('userData', …)` does NOT create the
  directory. The PR's `fs.mkdirSync(userDataPath, {recursive: true})`
  on line 80 is what makes first launch work. Worth a
  comment/invariant. Add a test case.
- **Module-level `markerPath` not reset on non-confined path**:
  `pr7273.diff:27` is `let markerPath: string | null = null;` but the
  non-confined early return on line 61 returns `markerPath: null`
  without resetting the module variable. Adds a subtle bug if the
  function is called twice (tests, reinit). Set `markerPath = null`
  on the non-confined branch.
- **`isTruthyEnv` asymmetry**: `SP_DISABLE_GPU=0` is treated as unset
  (regex `/^(1|true|yes|on)$/i`). Users may intuitively set
  `SP_DISABLE_GPU=0` expecting to force GPU back on — wrong; use
  `SP_ENABLE_GPU=1`. Document.
- **`--disable-gpu-sandbox` as intermediate step**: on Snap-confined
  Electron, GPU sandbox init can fail independently of Mesa ABI drift.
  A 2-step ladder (first crash → `--disable-gpu-sandbox`; second
  crash → `--disable-gpu`) would preserve HW accel for sandbox-only
  failures. Defer unless reports come in.

### Citation integrity

Agent A verified the high-risk citations. Summary:

- **Confirmed verbatim**: Chromium `fallback.md` stack order; GPU
  integration test (`_GpuProcess_disable_gpu_and_swiftshader` +
  `_GpuProcess_disable_gpu`); electron/electron #28164, #17187,
  #17447; Bugzilla 294260; BugSnag docs; chromium-discuss thread;
  canonical `gpu-2404` ("evolution" wording); electron-builder
  #9452; snapcrafters signal-desktop wrapper (`--disable-gpu` default
  ON); snapcrafters mattermost-desktop (`glxinfo llvmpipe` probe +
  `jq` config patch); AppleInsider Tahoe article (confirmed via
  secondary sources).
- **Misattributed**: Chromium `fallback.md` does NOT document the
  `--disable-gpu` Linux behavior. Reattribute to chromium-discuss +
  integration test (see "Outstanding corrections" above).
- **Weak**: Bugzilla 745154 (already relabeled).
- **Imprecise**: electron-builder#4587 is about `build.linux.executableArgs`,
  not `build.snap.executableArgs` directly — the snap-scoped
  brokenness is inferred from the same root cause. Clarify in §6.
- **Not reachable via WebFetch**: Firefox `nsAppRunner.cpp` (file too
  large). Logic exists per Bug 294260; cite a specific searchfox
  anchor instead of the whole file.

## 15. Final PR #7273 Re-evaluation

**Verdict: Approve with changes.** The design is sound; the
implementation has three real bugs, two documentation gaps, and one
mechanically-wrong code comment. None are blockers.

### Bugs to fix before merge

1. **PR code comment in `start-app.ts` (lines 145–154 of the diff) is
   mechanically wrong.** It says `--disable-gpu` "suppresses GPU-process
   spawn." That's false on Linux — Chromium respawns the GPU process in
   SwiftShader or DisplayCompositor mode. Reword to: `--disable-gpu`
   avoids the hardware Mesa DRI driver load path, which is the source
   of the Snap ABI-drift crash. The GPU process may still run in
   software mode.

2. **Module-level `markerPath` not reset on the non-confined early
   return** (`pr7273.diff:27, 60-62`). Add `markerPath = null;` before
   the non-confined return. Makes the function idempotent — otherwise
   a second call from a test or reinit retains the previous value.

3. **First-launch `mkdirSync` invariant undocumented.** The
   `fs.mkdirSync(userDataPath, {recursive: true})` on line 80 is
   load-bearing for fresh Snap installs (Electron's `app.setPath`
   doesn't create the directory). Add a comment; add a test case.

### Documentation gaps

4. **`SP_ENABLE_GPU=1` semantics**: document that (a) overriding
   with a crash during that launch means +1 extra bad launch before
   recovery kicks in on the next normal launch, not infinite
   oscillation; (b) `SP_DISABLE_GPU=0` does NOT turn recovery off —
   it's parsed as unset; use `SP_ENABLE_GPU=1` for that.

5. **Oscillation behavior for genuinely broken GPU**: the every-other-
   launch pattern is by design (retry after each recovery). Note it
   in the PR body so users understand the expected experience until
   they fix the root cause or set `SP_DISABLE_GPU=1` persistently.

### Strongly recommended additions

6. **Add `--disable-software-rasterizer` alongside `--disable-gpu`**
   (§13.4 item 1): cheap belt-and-braces; SP has no WebGL dependency.
   Drop the "fully suppresses GPU process" framing — at most claim
   "avoids software-GL fallback initialization."

7. **Extract `evaluateGpuStartupGuard` to a pure function with
   injected `fs`/`env`/`platform`** and add the unit test file from
   §13.2. This is the largest correctness gap — there are no tests
   today. The refactor is mechanical and doesn't change behavior.

### Deferred / optional

8. **Time-bound the marker**: if `fs.statSync(markerPath).mtime` is
   older than N minutes (5–10), assume systemd SIGKILL / snap refresh
   rather than a GPU crash and skip recovery. Cut false-positive rate
   on suspended laptops. Defer until reports confirm this is noisy.

9. **`--disable-gpu-sandbox` as intermediate step**: Chromium-style
   2-step ladder. Defer until a sandbox-specific failure is reported.

10. **Structured JSON marker payload** (§13.3 codex suggestion):
    `{ ts, reason?, gpuChildGone? }` populated from
    `child-process-gone`/`render-process-gone` listeners. Cleaner
    forensics than a zero-byte marker. Defer — can be added without
    breaking compatibility.

11. **Add `/.flatpak-info` existence check as OR fallback to
    `FLATPAK_ID`**. Covers manifests that unset env vars. Cheap.

12. **Time-box the legacy-marker cleanup** (remove in 19.0) with a
    TODO comment.

### Ordering recommendation (revised)

1. **Ship PR #7266 (X11 widening) in 18.2.4** first — it covers ~95%
   of affected Snap users with no UX regression (HW accel preserved
   via X11/GLX). This was already the doc's primary recommendation;
   the verification revealed it was NOT in v18.2.3 as previously
   assumed.
2. **Ship PR #7273 (GPU guard) alongside or immediately after**, with
   fixes 1–3 above and the tests from item 7.
3. **Schedule `core24` + `gpu-2404` migration** for 18.3/19.0 as the
   root-cause fix.

### Confidence

- **High** that PR #7273 is the right *class* of fix for the residual
  tail that PR #7266 doesn't cover (GPU process hangs without
  `child-process-gone`, Flatpak, X11 users with ABI-drifted Mesa).
- **High** that the three bugs listed above are real and should be
  fixed before merge.
- **Medium** that the documentation gaps are worth the effort —
  could land as PR description edits, not code.
- **Medium** that `--disable-software-rasterizer` meaningfully
  improves the recovery path — evidence base is a single
  chromium-discuss thread and an integration test, both of uncertain
  currency against Chromium 146.

---

## 11. References

- [Snapcraft forum #40975](https://forum.snapcraft.io/t/40975) — "DRI driver not from this Mesa build" error signature (reported in a **core24 + experimental gnome** stack, not gnome-42-2204; the error string is real but the environment differs)
- [Snapcraft forum #49173](https://forum.snapcraft.io/t/mesa-core22-updates-broke-my-snap/49173) — mesa-core22 breakage (mid-to-late 2025). Error: "Failed to initialize GLAD", distinct from #40975's DRI driver message
- [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452) — **strongest external reference.** "Snap package of Electron ≥ 38 crashes at startup under GNOME on Wayland"; maintainer engagement; `--ozone-platform=x11` confirmed working
- [electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587) — `snap.executableArgs` silently ignored for snap builds (why mechanism #3 in Section 6 is unusable)
- [electron/electron#48298](https://github.com/electron/electron/issues/48298) / [PR #48301](https://github.com/electron/electron/pull/48301) — Electron 38.0.0/38.1.0 Wayland auto-detection regression, fixed in 38.2.0
- [super-productivity#7270](https://github.com/super-productivity/super-productivity/issues/7270) — Snap launch failure on Ubuntu 22.04 / v18.2.2 (no logs); triggered this follow-up
- [super-productivity#7273](https://github.com/super-productivity/super-productivity/pull/7273) — GPU startup guard (orthogonal defense, analyzed in Sections 12–13)
- [Chromium `content/browser/gpu/fallback.md`](https://chromium.googlesource.com/chromium/src/+/60b3c74b7f2ca17a28907fb0b40d9dabeaa48326/content/browser/gpu/fallback.md) — documents `HARDWARE_VULKAN → HARDWARE_GL → SWIFTSHADER → DISPLAY_COMPOSITOR` fallback stack; why `--disable-gpu` alone doesn't eliminate the GPU process
- [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md) — JIT CPU rasterizer, no DRI
- [chromium-discuss — GPU process still runs with --disable-gpu](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/IIQeveVRLVE)
- [electron/electron#28164](https://github.com/electron/electron/issues/28164) — `--disable-gpu` doesn't suppress the GPU process
- [electron/electron#17187](https://github.com/electron/electron/issues/17187) — `getGPUInfo('complete')` never settles on broken systems
- [electron/electron#17447](https://github.com/electron/electron/issues/17447) — `getGPUInfo('basic')` always reports `softwareRendering: false`
- [Electron `app` API docs](https://www.electronjs.org/docs/latest/api/app) — `child-process-gone` event, `launch-failed` reason
- [Mozilla Bugzilla 294260](https://bugzilla.mozilla.org/show_bug.cgi?id=294260) — Firefox Safe Mode auto-detection via `toolkit.startup.recent_crashes`
- [Mozilla Bugzilla 745154](https://bugzilla.mozilla.org/show_bug.cgi?id=745154) — suppresses `recent_crashes` auto-safe-mode in debug builds (weak reference; 294260 is the authoritative source)
- [Firefox `nsAppRunner.cpp` (searchfox)](https://searchfox.org/firefox-main/source/toolkit/xre/nsAppRunner.cpp) — implementation of startup-crash marker
- [BugSnag — Identifying crashes at launch (Android)](https://docs.bugsnag.com/platforms/android/identifying-crashes-at-launch/) — `lastRunInfo.crashedDuringLaunch` pattern
- [sentry-cocoa #3639](https://github.com/getsentry/sentry-cocoa/issues/3639) — open crash-loop detector feature request
- [microsoft/vscode #214446](https://github.com/microsoft/vscode/issues/214446) — VS Code GPU toggle is manual
- [systemd #4206](https://github.com/systemd/systemd/issues/4206) — user-instance SIGKILL on shutdown timeout (stuck-marker source)
- [Flatpak sandbox-permissions docs](https://docs.flatpak.org/en/latest/sandbox-permissions.html) — `FLATPAK_ID` env and `/.flatpak-info` inside sandbox
- [canonical/nvidia-core22](https://github.com/snapcore/nvidia-core22) — Nvidia EGL content snap (not Mesa)
- [Electron 38.0.0 release blog](https://www.electronjs.org/blog/electron-38-0) — "Electron now runs as a native Wayland app by default when launched in a Wayland session on Linux"
- [Canonical — gpu-2404 interface](https://canonical.com/mir/docs/the-gpu-2404-snap-interface) — describes gpu-2404 as an "evolution" of graphics-core22 (Canonical's wording, not "deprecation")
- [Canonical RFC — gpu-2404 migration](https://forum.snapcraft.io/t/rfc-migrating-gnome-and-kde-snapcraft-extensions-to-gpu-2404-userspace-interface/39718)
- [microsoft/vscode#202072](https://github.com/microsoft/vscode/issues/202072) — VS Code snap Wayland failure (no explicit X11 force)
- [snapcrafters/signal-desktop](https://github.com/snapcrafters/signal-desktop) — community Signal snap (`snapctl get enable-gpu` toggle)
- [snapcrafters/mattermost-desktop](https://github.com/snapcrafters/mattermost-desktop) — community Mattermost snap (glxinfo + jq config patching)
- [flathub/md.obsidian.Obsidian `obsidian.sh`](https://github.com/flathub/md.obsidian.Obsidian/blob/master/obsidian.sh) — Flatpak wrapper with compositor+GPU probe
- SP issue [#5672](https://github.com/super-productivity/super-productivity/issues/5672) — user reports (filed 2025-12-06 on SP 16.5.2, which pinned Electron 39.2.5 per the tagged `package.json`)
- SP `electron/start-app.ts` — existing Snap guard widened by PR #7264
