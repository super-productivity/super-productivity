# Release and publishing runbook

> **Status:** Maintained
>
> **Last verified against workflows:** 2026-07-29

The GitHub Actions workflows are the executable source of truth. Update this
runbook in the same change whenever their triggers, channels, artifacts, or secret
names change.

## Release boundaries

Releasing has two distinct boundaries:

1. **Push a `v*` tag:** builds artifacts and creates a draft GitHub release. A
   final tag (`vX.Y.Z`, with no `-`) also uploads and submits the iOS and Mac App
   Store builds for review with automatic release after Apple approval. Treat a
   final tag as production-affecting even while the GitHub release remains a draft.
2. **Publish the GitHub release:** triggers the release-event workflows that
   deploy the web app and publish or promote other distribution channels.

Do not publish the draft merely to test a build. Use a pre-release tag or a
workflow's manual dispatch where supported.

## Prepare a version

Start from a clean, current release commit and choose the appropriate semantic
version:

```bash
npm version patch
```

Use `minor`, `major`, or an explicit pre-release version when appropriate.
The `version` lifecycle updates the Android version, generates
`build/release-notes.md`, writes the versioned Google Play changelog, stages the
changes, and creates the npm version commit and tag.

Before pushing anything:

1. Review the version commit and tag.
2. Read `build/release-notes.md` for accuracy and user-data/privacy leaks.
3. For a final release, confirm the generated Android changelog exists under
   `android/fastlane/metadata/android/en-US/changelogs/`.
4. Run the relevant release-note tests:

   ```bash
   npm run release-notes:test
   ```

5. Confirm the working tree is clean.

If generated files are wrong, stop and repair the local version commit and tag
before pushing. Never move a release tag that has reached the remote.

Push the reviewed version commit and exactly the intended tag together. Replace
the placeholder with the tag created by `npm version`; do not use
`--follow-tags`, which can include other reachable annotated tags.

```bash
git push --atomic origin HEAD "vX.Y.Z"
```

## What the tag triggers

| Output                                                      | Workflow                                                      | Final tag                                       | Tag containing `-` |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | ------------------ |
| Draft GitHub release and Linux/macOS/Windows desktop assets | `.github/workflows/build.yml`                                 | Build                                           | Build              |
| Android APK and GitHub release asset                        | `.github/workflows/build-android.yml`                         | Upload to Play `internal` and attach APK        | Build/attach only  |
| iOS App Store                                               | `.github/workflows/build-ios.yml`                             | Upload and submit for review                    | Upload only        |
| Mac App Store                                               | `.github/workflows/build-publish-to-mac-store-on-release.yml` | Upload and submit for review                    | Upload only        |
| Microsoft Store `.appx`                                     | `.github/workflows/build-create-windows-store-on-release.yml` | Build artifact for manual Partner Center upload | Build artifact     |

Apple's detailed submission behavior, API-key requirements, and recovery cases
are in [Apple release automation](apple-release-automation.md).

The desktop workflow's draft/prerelease flag detection does not use exactly the
same rule as the Apple workflows. Before publishing a pre-release, explicitly
confirm that GitHub marks the draft as a pre-release.

## Verify before publishing the draft

Wait for every tag workflow to reach a terminal state. At minimum verify:

- the draft release body contains the intended notes;
- the expected Linux, macOS, signed Windows, Android, and Snap assets are present;
- Windows signatures passed verification;
- the Android final build reached the Play `internal` track;
- Apple upload/submission has the expected final-versus-pre-release behavior; and
- the Microsoft Store artifact and `WinStoreReleaseNotes` artifact exist if that
  channel is being updated.

Do not publish around a red required workflow. Diagnose or deliberately remove the
affected channel from the release scope first.

## What publishing the GitHub release triggers

For a non-prerelease release, publishing the draft starts:

| Channel     | Workflow                                                    | Result                                          |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------- |
| Google Play | `.github/workflows/auto-publish-google-play-on-release.yml` | Promote `internal` to `production`              |
| Snap Store  | `.github/workflows/build-publish-to-snap-on-release.yml`    | Publish the release Snap to `edge` and `stable` |
| Web app     | `.github/workflows/build-update-web-app-on-release.yml`     | Build and deploy production web assets          |
| Docker Hub  | `.github/workflows/publish-to-hub-docker.yml`               | Build and publish the application image         |

The Docker Hub workflow runs for any published GitHub release and does not contain
the prerelease guard used by the web, Play, and Snap workflows. Account for
that before publishing a pre-release.

The Microsoft Store upload remains manual: download the `WinStoreRelease` artifact
and use the generated release notes from the workflow summary/artifact in Partner
Center.

## Continuous channels

- A plain `master` push builds desktop artifacts, uploads a development Android
  build to the Play `internal` track, and publishes the branch Snap to `edge`.
- A `master` push that changes SuperSync server inputs publishes
  `ghcr.io/super-productivity/supersync:latest`; this image is not release-tagged.
- Pre-release and manual Apple workflows upload builds without submitting them for
  App Review. See [the TestFlight plan](plans/2026-07-14-ios-testflight-master-builds.md)
  for proposed additional branch behavior; it is not current behavior.

## Reproducible Android builds

The Angular service-worker builder emits `ngsw.json` (stamped with `Date.now()`,
plus a `hashTable` of per-file content hashes) and its worker scripts, and
`npx cap sync` copies them into the APK at `assets/public/`. That made the
Android build unverifiable against
[F-Droid's reproducible-build checks](https://verification.f-droid.org/) (#4155).

None of it is used on Android. `src/main.ts` gates both service-worker
registration paths on `!IS_NATIVE_PLATFORM && !IS_ELECTRON` and actively
_unregisters_ any existing worker on those platforms, so the files are dead
weight. `sync:android` therefore deletes them after `cap sync`, via
`tools/strip-service-worker-assets.js`. That retires the service worker as a
source of difference rather than pinning one field of it, and drops the bytes
from the APK. The Lighthouse CI job uses the same script on `dist/browser`, so
the file list lives in one place.

The hook point matters: F-Droid's recipe runs `buildFrontend:prodWeb` and
`sync:android` directly and never invokes `dist:android:prod`, so a step added
to the latter would not reach their build.

Nothing in the strip is fatal. Finding no files is legitimate — the service
worker can simply be disabled for a build — and an unlink that fails is reported
and skipped, because breaking the Android build (and with it F-Droid's prebuild)
over a cleanup would be the worse trade. A warning is not a safety net, though,
so the outcome is asserted where it can be checked: `build-android.yml` verifies
on the packaged APK that no `assets/public/ngsw*` entry survived. That covers
build, `cap sync`, strip and package together rather than any single step. It
runs on master and tags only, since no other workflow produces a real APK, so it
gates the publish rather than the merge.

Two things this deliberately does not do:

- **The web PWA and iOS are untouched.** The web app genuinely uses the service
  worker. The iOS bundle carries the same dead files, but iOS is not a
  reproducibility target, so there is no benefit to buy by changing App Store
  bundle contents. If it is ever unified, `sync:ios` needs `ios/App/App/public`.
- **It does not prove the APK reproduces.** The Gradle/AAPT layer and toolchain
  pinning are untouched, so confirming byte-identity needs a diffoscope run
  against an F-Droid build. This removes the one _reported_ blocker — the
  diffoscope report in #4155 anchors on `assets-public-ngsw.json` — not
  necessarily the last.

## Credentials and signing

Never put secret values in documentation. The workflow reference is authoritative
for secret names. The main operational groups are:

- Android signing and Play:
  `DROID_KEYSTORE_PASSWORD`, `DROID_KEYSTORE_ALIAS`,
  `DROID_KEY_PASSWORD`, `DROID_KEYSTORE_BASE_64`, and
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- Apple signing and App Store Connect: see
  [Apple release automation](apple-release-automation.md),
  [Mac App Store signing](mac-app-store-code-signing-guide.md), and
  [certificate renewal](update-mac-certificates.md).
- Windows signing: `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID`; the
  project, signing-policy, and artifact-configuration slugs are fixed in
  `.github/workflows/build.yml`.
- Snap: `SNAPCRAFT_STORE_CREDENTIALS`; see
  [credential refresh](howto-refresh-snap-credentials.md).
- Web, Docker Hub, and Microsoft Store credentials are named at their exact
  use sites in the corresponding workflows.

## Store listing assets

Screenshots, descriptions, and other store-listing assets remain manual unless a
workflow explicitly says otherwise. Store requirements change; use the current
App Store Connect, Google Play Console, or Partner Center requirements rather than
copying old pixel dimensions from this repository. Scan release notes and assets
for development-only labels, secrets, and personal data before upload.

## Failure and rollback

- A failed Apple lane after upload may require a new build number or manual
  completion in App Store Connect. Follow
  [Apple release automation](apple-release-automation.md#caveats).
- The Play promotion workflow can be manually dispatched for an Android-only
  release after the intended build is already on `internal`.
- Snap publishing can be manually dispatched with an existing release tag.
- Publishing a GitHub release fans out quickly. If only one channel should move,
  use that channel's supported manual workflow instead of publishing a broad
  release.
- Record the release URL and any intentionally skipped or manually completed
  channel in the release discussion.
- A failing SignPath step prints only what the connector returns, which can be a
  bare `Invalid request to SignPath API.` with no detail (v18.20.0, run
  31883046355). The workflow log cannot say more: diagnose it in the SignPath
  web UI, where the signing request record carries the real reason. SignPath's
  byte allowance is an annual quota, not a per-request limit: splitting the same
  executables across requests does not save quota. The v18.20.0 request was
  rejected after the old pipeline submitted six executables (about 892 MB) and
  exhausted the allowance. The workflow now submits only the universal installer
  and portable (about 448 MB), after checking that both x64 and arm64 payloads are
  embedded. It creates the old architecture-specific download names only after
  signing, so those compatibility copies consume no signing quota.
- Reducing a new request does not restore quota already consumed. Check the
  SignPath organization page for the active quota period and remaining bytes;
  request an exception from SignPath or wait for the period reset if necessary.
  Also verify that `SIGNPATH_API_TOKEN` is valid, that the `super-productivity`
  project, `release-signing` policy, and `github-zip-pe` artifact configuration
  still exist under those exact slugs, and that the GitHub trusted build system
  is authorized for the organization. If those checks do not explain a rejection,
  report the run URL and submission timestamp to SignPath support so they can
  inspect the server-side request record.
- Windows signing runs only on a `v*` tag, so a signing fix can only be
  exercised by re-running `windows-bin` or by pushing a pre-release tag. Never
  move a released tag to retest.
