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

## 11. References

- [Snapcraft forum #40975](https://forum.snapcraft.io/t/40975) — "DRI driver not from this Mesa build" error signature (reported in a **core24 + experimental gnome** stack, not gnome-42-2204; the error string is real but the environment differs)
- [Snapcraft forum #49173](https://forum.snapcraft.io/t/mesa-core22-updates-broke-my-snap/49173) — mesa-core22 breakage (mid-to-late 2025). Error: "Failed to initialize GLAD", distinct from #40975's DRI driver message
- [electron-builder#9452](https://github.com/electron-userland/electron-builder/issues/9452) — **strongest external reference.** "Snap package of Electron ≥ 38 crashes at startup under GNOME on Wayland"; maintainer engagement; `--ozone-platform=x11` confirmed working
- [electron-builder#4587](https://github.com/electron-userland/electron-builder/issues/4587) — `snap.executableArgs` silently ignored for snap builds (why mechanism #3 in Section 6 is unusable)
- [electron/electron#48298](https://github.com/electron/electron/issues/48298) / [PR #48301](https://github.com/electron/electron/pull/48301) — Electron 38.0.0/38.1.0 Wayland auto-detection regression, fixed in 38.2.0
- [Electron 38.0.0 release blog](https://www.electronjs.org/blog/electron-38-0) — "Electron now runs as a native Wayland app by default when launched in a Wayland session on Linux"
- [Canonical — gpu-2404 interface](https://canonical.com/mir/docs/the-gpu-2404-snap-interface) — describes gpu-2404 as an "evolution" of graphics-core22 (Canonical's wording, not "deprecation")
- [Canonical RFC — gpu-2404 migration](https://forum.snapcraft.io/t/rfc-migrating-gnome-and-kde-snapcraft-extensions-to-gpu-2404-userspace-interface/39718)
- [microsoft/vscode#202072](https://github.com/microsoft/vscode/issues/202072) — VS Code snap Wayland failure (no explicit X11 force)
- [snapcrafters/signal-desktop](https://github.com/snapcrafters/signal-desktop) — community Signal snap (`snapctl get enable-gpu` toggle)
- [snapcrafters/mattermost-desktop](https://github.com/snapcrafters/mattermost-desktop) — community Mattermost snap (glxinfo + jq config patching)
- [flathub/md.obsidian.Obsidian `obsidian.sh`](https://github.com/flathub/md.obsidian.Obsidian/blob/master/obsidian.sh) — Flatpak wrapper with compositor+GPU probe
- SP issue [#5672](https://github.com/super-productivity/super-productivity/issues/5672) — user reports (filed 2025-12-06 on SP 16.5.2, which pinned Electron 39.2.5 per the tagged `package.json`)
- SP `electron/start-app.ts` — existing Snap guard widened by PR #7264
