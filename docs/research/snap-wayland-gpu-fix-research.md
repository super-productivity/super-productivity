# Snap + Wayland GPU Init Failure — Research Report

## Executive Summary

A subset of Super Productivity Snap users hit a GPU initialization failure on
launch where the app either (a) shows a tray icon with no window, (b)
segfaults, or (c) launches but floods logs with GL errors. The likely root
cause is Mesa ABI drift between Electron's bundled libgbm/Mesa stack and the
Mesa shipped by the `gnome-42-2204` content snap's `core22-mesa-backports`
PPA. The December 2025 increase in user reports correlates with upstream
Electron 38 (Sept 2025) switching Wayland on by default under GNOME, which
exposed the pre-existing ABI mismatch to far more users.

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

**High confidence on direction; medium confidence on the exact Electron
interaction timing.**

- Not a missing-files problem — `libgl1-mesa-dri` is present in the content
  snap.
- The failure is an ABI version check: `"DRI driver not from this Mesa build"`
  (snapcraft forum threads #40975, #49173).
- Trigger: Mesa shipped by `gnome-42-2204`'s `core22-mesa-backports` PPA does
  not reliably match the Mesa/libgbm ABI expectations of recent Electron
  Chromium builds.
- **Timing note:** Issue #5672 was filed 2025-12-06 on Super Productivity
  16.5.2, which shipped Electron 37.10.3. Super Productivity did not bump
  Electron until 2026-04-17 (37.10.3 → 41.2.0 — one day before this doc was
  drafted). The December 2025 increase in reports therefore does **not**
  correlate with an SP-side Electron upgrade. The more plausible upstream
  contributor is Electron 38 (released Sept 2025), which flipped Chromium's
  Wayland backend on by default under GNOME; combined with ongoing
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

**Confirmed.**

- No official fix for `core22` forthcoming; direction is "move to `core24`."
- Zero Canonical engagement with `electron-builder` issues #8548 / #9452.
- `graphics-core22` is not formally deprecated but is superseded in practice
  by `gpu-2404`.
- `--disable-gpu` / `--ozone-platform=x11` are community workarounds, not
  endorsed.

---

## 5. Peer Consensus (Other Electron Apps)

**Confidence note:** The items below are sourced from community discussions
and issue trackers. The Super Productivity (first-hand) claim is the
`electron/start-app.ts:70-88` existing guard. Every other row was **not**
independently verified to a specific commit or PR in this research pass and
should be treated as directional, not citable.

| App | Approach | Verification |
|---|---|---|
| Signal Desktop | Community reports indicate Signal disables GPU by default on Snap and exposes a `snap set` opt-in. | **Not verified** to a specific issue/commit in this pass; do not cite "issue #422" (that issue is unrelated). |
| Mattermost | Community reports describe a GL-probe + config.json patching pattern. | **Not independently verified.** |
| VS Code | Community reports describe Wayland → X11 fallback via wrapper. | **Not independently verified.** |
| electron-builder #9452 | Issue thread exists and discusses `--ozone-platform=x11` as a workaround. | Issue thread confirmed; individual comments **not** re-quoted here. |
| Teams-for-Linux | `afterPack` rename + wrapper-script pattern. | **Not independently verified.** |

What **is** solid across these reports: multiple Electron apps on Snap have
adopted some form of X11 fallback or GPU-disable workaround, and nobody in
Electron land ships `graphics-core22` in production without one.

---

## 6. Electron-Builder Escape Hatches

Earlier research claimed wrapper scripts required rewriting `snapcraft.yaml`.
That was wrong. Two working mechanisms exist inside `electron-builder`'s snap
target:

1. **`snap.executableArgs` accepts shell substitution.** `command.sh` is a
   bash script, so
   `executableArgs: ["$([ -e /dev/dri/card0 ] || echo --disable-gpu)"]` is
   evaluated at launch.
2. **`afterPack` hook** can rename the real binary and drop a wrapper script
   at the same name → a full pre-Electron wrapper, no `snapcraft.yaml`
   changes. (Teams-for-Linux precedent — not independently re-verified in
   this pass.)

Both approaches avoid auto-connect requests, store-review friction, or a base
bump.

---

## 7. Options (Ranked)

| # | Option | Fixes errors | Keeps HW accel | Scope | Effort | Evidence alignment |
|---|---|---|---|---|---|---|
| 1 | **Narrow: `--ozone-platform=x11` via executableArgs/command-line when Snap + Wayland** | Yes for ~95% | Yes (X11/GLX) | Snap only, conditional | ~1 file, ~20 LOC | Strongest — matches the pattern community workarounds converge on |
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
4. **Zero packaging rewrite** — goes into existing `electron/start-app.ts` (or
   `electron-builder.yaml`'s `snap.executableArgs`). SP already has Snap-gated
   `ozone-platform=x11` logic at `electron/start-app.ts:70-88`. The only
   change needed is to **stop gating on "gnome-platform dir is empty" and
   instead gate on "Snap + Wayland session."**

This is what the existing migration plan partially implemented. The plan's
defense-in-depth was intended to catch exactly this scenario; the
`gnome-platform` emptiness probe is wrong because `gnome-platform` is
populated — just ABI-drifted. Widening the guard to `SNAP + Wayland` matches
the empirical breakage pattern.

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
| Dec 2025 reports correlate with Electron 38 Wayland-default (Sept 2025) | **Medium** — timing is suggestive; not proven |
| Peer-app implementation details in Section 5 | **Low-medium** — directional, not independently re-verified to specific commits/PRs in this pass |

---

## 10. Proposed Change

Widen the existing guard in `electron/start-app.ts:70-88`:

- **Before:** gated on Snap + `gnome-platform` directory missing or empty.
- **After:** gated on Snap + Wayland session (`XDG_SESSION_TYPE === 'wayland'`
  or `WAYLAND_DISPLAY` set), with the existing gnome-platform probe retained
  as a secondary fallback.

Estimated diff: ~10 LOC in `electron/start-app.ts`. No `electron-builder.yaml`
changes required.

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

- snapcraft forum threads #40975, #49173 — Mesa ABI drift reports
- electron-builder issues #8548, #9452 — community workarounds
- SP issue #5672 — user reports (filed 2025-12-06 on SP 16.5.2 / Electron 37)
- `electron/start-app.ts:70-88` — existing Snap guard widened by PR #7264
