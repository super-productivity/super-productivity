# Snap exits 1 when an XDG user dir is a symlink to an empty dir (#10576)

Research, 2026-10-09. electron-builder / app-builder-lib 26.16.1, `snap.base: core22`, template build path.

## Summary

- **Confirmed:** the shipped launcher has the bug. The snap template (`snap-template-4.0-2`, published 2019-07-10) is still the newest one, so there is no newer template to switch to.
- electron-builder already maintains a fixed copy of the same script, `node_modules/app-builder-lib/templates/snap/desktop-common.sh`. It only ships on the no-template path. That copy adds an `is_subpath` guard that skips this branch for the reporter's setup.
- The core24 gnome extension still does the XDG migration, but its launcher has no `-e` and has the same guard. The reporter's claim that it "no longer does this" is wrong, though core24 would still avoid the crash.
- **Recommendation:** use patch-package on `app-builder-lib` so that template builds pack the maintained `desktop-common.sh` in place of the 2019 one. Also add a CI assertion and send the same change upstream. Confidence: 80%. See [Recommendation](#recommendation).

## 1. Shipped template

I downloaded `snap-template-electron-4.0-2-amd64.tar.7z` from the `electron-userland/electron-builder-binaries` release `snap-template-4.0-2` and extracted it into an isolated temp dir without executing anything. Its sha256 `5e3ab4e0…e6f` matches `SNAP_TEMPLATES.amd64` in `coreLegacy.js:20-24`.

`desktop-common.sh` (shebang `#!/bin/bash -e`):

```bash
# line 218 ff. — runs only when needs_xdg_links=false, i.e. every launch after the first
old="${XDG_SPECIAL_DIRS_INITIAL_PATHS[$i]}"
new="${XDG_SPECIAL_DIRS_PATHS[$i]}"
if [ -L "$old" ] && [ -d "$new" ] && [ "$(readlink "$old")" != "$new" ]; then
  mv -vn "$old"/* "$new"/ 2>/dev/null
```

Why this fails:

- **First launch:** `$SNAP_USER_DATA/.config/user-dirs.dirs` does not exist yet, so `INITIAL_PATHS` is empty and the branch is a no-op. The snap starts.
- **Every later launch:** `old` and `new` are both `/home/u/Public`. `readlink` returns the target path, which is not the same string, so `mv` runs with the literal glob `/home/u/Public/*`. `mv` exits 1, and `bash -e` aborts the launcher.
- **Not self-healing:** `command.sh` → `desktop-init.sh` → `desktop-common.sh` each `exec` the next script, and the branch is evaluated again on every launch.

Reproduced with a minimal copy of that branch (my own script, not the template), run with `bash -e`:

| userland                                       | symlink → empty dir | symlink → non-empty dir                                                 |
| ---------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `ubuntu:22.04`, coreutils 8.32 (core22 rootfs) | exit 1              | exit 0, file untouched (this is the reporter's workaround)              |
| host coreutils 9.4                             | exit 1              | exit 1 (`mv -n` skip is non-zero since 9.2; not relevant inside core22) |
| guarded variant (below), 22.04                 | exit 0              | —                                                                       |

**Newer templates:** none. The `electron-builder-binaries` releases matching `snap-template-*` end at `4.0-2` (2019-07-10). `armhf` still uses `4.0-1`.

**electron-builder's own scripts:** `templates/snap/*.sh` in app-builder-lib are copied into the no-template build (`coreLegacy.js:278-285`). `diff` against the template shows only three hunks:

1. `desktop-common.sh:222` adds `&& (is_subpath "$old" "$SNAP_USER_DATA" || is_subpath "$old" "$SNAP_USER_COMMON")`. `realpath(~/Public)` resolves outside `$SNAP_USER_DATA`, so the branch is skipped. This is the fix.
2. `desktop-common.sh:89` changes `LIBVA_DRIVERS_PATH` from `$ARCH` to `$SNAP_DESKTOP_ARCH_TRIPLET`. `ARCH` is not exported by `desktop-init.sh`, so the template currently sets a broken VA-API path. This is a side benefit.
3. `desktop-common.sh:243` adds a `WAYLAND_DISPLAY` path-traversal guard. `desktop-init.sh` also has an `LD_PRELOAD` leading-`:` fix, which is a different file and not needed for this issue.

There is no upstream electron-builder issue about this. Search for `desktop-common.sh` / `is_subpath` found #9996, #10002 and #9704, which are related launcher breakage but a different bug.

## 2. core24 gnome extension

- snapcraft 8.11.1 (`ghcr.io/canonical/snapcraft:8_core24`) sets the core24 command chain to `gpu-2404-wrapper` → `desktop-launch` (`snapcraft/extensions/gnome.py:90-94`). `extensions/desktop/command-chain/desktop-launch` only sources `$SNAP/gnome-platform/command-chain/desktop-launch` from the content snap.
- `ubuntu/gnome-sdk` branch `gnome-46-2404`, `snap/snapcraft.yaml:297-305`, builds that launcher from `snapcore/snapcraft-desktop-integration` `gnome/`.
- `canonical/snapcraft-desktop-integration` `gnome/desktop-exports:250-262` keeps the same "move content from old locations" loop, with the `is_subpath` guard. Its `init` / `desktop-exports` / `launcher-specific` / `mark-and-exec` files are all `#!/bin/bash` with no `set -e`; only `fonts`, the configure hook, uses `set -e`.

So core24 still runs the XDG migration. It cannot abort on this case: the guard skips it, and even an `mv` failure would not be fatal.

## 3. Options

| Option                                                                                                                                                                                                       | Size                                                                         | Risk                                                                                                                                                                                                                                                                                                                                                                                            | Verdict                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Newer template**                                                                                                                                                                                       | —                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                               | Not available (§1). The upstream fix should overlay electron-builder's maintained scripts in `buildWithTemplate`, not re-roll a 2019 binary bundle. |
| **(b1) patch-package `coreLegacy.js`** — in `buildWithTemplate`, drop `desktop-common.sh` from `readDirPaths(templateDir)` and stage `getTemplatePath("snap")/desktop-common.sh` (chmod 755) into `stageDir` | ~8 lines in an existing mechanism (`postinstall: patch-package`, `patches/`) | Low. The overlaid script is the one electron-builder already ships on its no-template path, and it differs from the template by three hunks. Single mksquashfs pass, no new tools. Breaks loudly on install if an electron-builder bump moves the code.                                                                                                                                         | **Recommended**                                                                                                                                     |
| (b2) `artifactBuildCompleted` hook: unsquashfs → replace script → mksquashfs                                                                                                                                 | ~40 lines plus a tool dependency                                             | Medium. The hook is awaited before `artifactCreated` and publish (`packager.js:233-235`), so it covers the tag/release asset too. But `unsquashfs` is not bundled (electron-builder only ships `mksquashfs`), so CI and local `npm run dist` need `squashfs-tools`. It also adds a second xz pass and must mirror e-b's flags (`-noappend -comp xz -no-xattrs -no-fragments -all-root`).        | Fallback if patch-package is unwanted                                                                                                               |
| (b3) `MKSQUASHFS_PATH` wrapper that swaps the script arg                                                                                                                                                     | small                                                                        | Medium-high: depends on internal argv layout and an env var that must be set wherever we build                                                                                                                                                                                                                                                                                                  | No                                                                                                                                                  |
| (b4) Patch the cached extracted template in `beforePack`/`afterPack`                                                                                                                                         | small                                                                        | High: mutates the shared `~/.cache/electron-builder` and depends on e-b's cache-dir hashing                                                                                                                                                                                                                                                                                                     | No                                                                                                                                                  |
| (c) `useTemplateApp: false` + snapcraft                                                                                                                                                                      | medium-large                                                                 | Medium-high. It runs `snapcraft snap` on the host (`coreLegacy.js:289-295`), which needs a core22-matching environment (destructive mode in a 22.04 container or LXD). The existing container is `8_core24`, i.e. 24.04, so it does not match. It also switches the snap payload from the curated template to apt `stage-packages`. Fixes this issue as a side effect (same maintained script). | No; too much change for a one-line bug                                                                                                              |
| (d) core24                                                                                                                                                                                                   | large                                                                        | High: see below                                                                                                                                                                                                                                                                                                                                                                                 | Separate project                                                                                                                                    |

Notes on (d), core24:

- **Build environment.** e-b refuses the `gnome` extension in destructive mode (`core24.js:154-167`) and asks for LXD or Multipass. That brings back the runner `snap install` we removed for reliability (`build.yml:203-207`), or needs a new containerised build.
- **gnome-42-2204 plug override.** The `gnome-3-28-1804` → `gnome-42-2204` override in `electron-builder.yaml:175-185` becomes obsolete, because the extension wires `gnome-46-2404`. It must be removed, not carried over.
- **`snap-wrapper.sh` / afterPack.** These keep working: the command launcher still execs our wrapper, and the `$SNAP_NAME` gate is unchanged. Per `docs/research/snap-wayland-gpu-fix-research.md` "Removal conditions", core24 + `gpu-2404` (which the extension now inserts) permits retiring the forced-X11 path, but that needs its own Wayland/GPU field verification.
- **#7264** (closed 2026-04-18) only widened the `start-app.ts` X11 guard. It is not a core24 attempt, and the afterPack argv wrapper superseded it. It sets no constraint on core24.
- **Maturity.** core24 support in e-b landed as "beta" (electron-builder#9517).

## Recommendation

1. **(b1) patch-package.** Overlay `app-builder-lib/templates/snap/desktop-common.sh` onto template builds in `SnapCoreLegacy.buildWithTemplate`. Keep it to that one file to stay minimal; `desktop-init.sh` could follow the same way later. Add a comment naming the ceiling: "drop when electron-builder overlays its scripts on template builds".
2. **CI guard.** Extend the "Verify snap template was unpacked" step in `.github/workflows/build.yml` with `unsquashfs -cat "$SNAP_FILE" desktop-common.sh | grep -q 'is_subpath "\$old" "\$SNAP_USER_DATA"'`. Check that the guard fails against an unpatched build before trusting it.
3. **Upstream.** File an issue/PR on electron-builder to overlay `templates/snap/*.sh` in `buildWithTemplate`. Its no-template users already get the fixes; template users (the default for x64) do not.
4. Leave core24 to its own effort. Do not tie this fix to it.

Users who are currently stuck recover on the first launch of a fixed revision, because nothing bad is persisted. Until then, the reporter's workaround (put a file in the empty dir) works.

## Verification plan

1. **Unit-level, no snap needed.** Run the guarded and unguarded branch under `bash -e` in `ubuntu:22.04` with `~/Public -> <empty dir outside $SNAP_USER_DATA>`. Done above: unguarded exits 1, guarded exits 0.
2. **Payload.** Run `npm run dist` on Linux, then `unsquashfs -cat <snap> desktop-common.sh`. Confirm the guard is present, `desktop-init.sh` / `desktop-gnome-specific.sh` are still at the root, and there is no `desktop-common.sh_1` duplicate.
3. **Real snap repro** on a Linux VM, e.g. Ubuntu 24.04 or 26.04 GNOME:
   ```sh
   mkdir -p ~/elsewhere/Public-empty && rmdir ~/Public 2>/dev/null; ln -s ~/elsewhere/Public-empty ~/Public
   # ensure ~/.config/user-dirs.dirs has XDG_PUBLICSHARE_DIR="$HOME/Public"
   snap remove --purge superproductivity
   snap install superproductivity --channel=stable    # baseline
   superproductivity & sleep 10; pkill -f superproductivity-bin
   superproductivity; echo "exit=$?"                  # expect exit=1 immediately (bug)
   snap install --dangerous ./superProductivity-*.snap  # patched build
   superproductivity & sleep 10; pkill -f superproductivity-bin
   superproductivity & sleep 10; pgrep -f superproductivity-bin && echo running  # expect running on launch 2 and 3
   ```
   Also run once with `~/Public` as a regular dir and once as a symlink to a non-empty dir, to confirm no regression.
4. **Edge.** After merge, the master build uploads to `edge`; ask the reporter to confirm on rev ≥ that revision.

## Sources

- `node_modules/app-builder-lib/out/targets/snap/coreLegacy.js`:
  - `20-30`: template pins
  - `59`: template-path condition
  - `243-273`: `buildWithTemplate`
  - `274-300`: no-template path
  - `371-378`: `MKSQUASHFS_PATH`
  - `397-406`: `command.sh`
- `node_modules/app-builder-lib/out/targets/snap/core24.js:154-167`
- `node_modules/app-builder-lib/out/packager.js:233-235`
- `node_modules/app-builder-lib/templates/snap/desktop-common.sh:218-228`
- electron-builder-binaries release `snap-template-4.0-2`: https://github.com/electron-userland/electron-builder-binaries/releases/tag/snap-template-4.0-2
- snapcraft 8.11.1 (container `ghcr.io/canonical/snapcraft:8_core24`), files under `site-packages/`:
  - `snapcraft/extensions/gnome.py:28,90-94,330-352`
  - `extensions/desktop/command-chain/{desktop-launch,run,Makefile}`
- https://github.com/ubuntu/gnome-sdk/blob/gnome-46-2404/snap/snapcraft.yaml (part `command-chain`)
- https://github.com/canonical/snapcraft-desktop-integration/blob/main/gnome/desktop-exports (lines 250-262)
- Repo:
  - `electron-builder.yaml:146,175-185`
  - `.github/workflows/build.yml:153-176,203-207`
  - `build/linux/snap-wrapper.sh`
  - `docs/research/snap-wayland-gpu-fix-research.md`
  - `package.json` (`postinstall: patch-package`)
