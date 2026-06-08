# Apple (iOS & macOS) release automation

Pushing a final version tag (`vX.Y.Z`) builds, signs, uploads **and submits**
the iOS and macOS App Store builds for review, set to release automatically once
Apple approves them. The only step that is not automated is Apple's human
review.

## Pipeline

| Target                                               | Workflow                                                      | Output                         |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| iOS App Store                                        | `.github/workflows/build-ios.yml`                             | `.ipa` → App Store Connect     |
| Mac App Store                                        | `.github/workflows/build-publish-to-mac-store-on-release.yml` | MAS `.pkg` → App Store Connect |
| Mac direct download (notarized DMG/zip, auto-update) | `.github/workflows/build.yml` (`mac-bin`)                     | GitHub release asset           |

On a tag push each workflow builds and signs the artifact, then runs a fastlane
lane (`fastlane/Fastfile`, `ios release` / `mac release`) that:

1. Uploads the artifact to App Store Connect. Apple's binary validation runs
   inline during the upload (this replaces the previous standalone
   `altool --validate-app` step).
2. Pushes only the "What's New" release notes (derived from
   `build/release-notes.md` by `tools/prepare-appstore-release-notes.js`). The
   lane points `metadata_path` at a dir containing **only**
   `<locale>/release_notes.txt`; deliver reads just that file and skips every
   other field (no remote read-back), so the description, keywords, screenshots,
   … curated by hand in App Store Connect are left untouched. (`skip_metadata`
   is intentionally **not** set — it would make deliver upload no notes at all.)
3. Waits for App Store Connect to finish processing the build.
4. Submits the version for review with **automatic release on approval**.

`build/release-notes.md` is a committed snapshot regenerated at release time
(see `tools/release-notes.js`). If a tag is pushed without that file refreshed
for the new version, stale notes upload silently — make sure the release-notes
commit lands before tagging.

### Submit vs. upload-only

`SUBMIT_FOR_REVIEW` is computed per run as
`startsWith(github.ref, 'refs/tags/v') && !contains(github.ref, '-')`:

- **Final tag** (`vX.Y.Z`, no hyphen) → upload **and** submit for review.
- **Pre-release tag** (any tag containing `-`, e.g. `v18.0.0-rc.0`,
  `v17.0.0-RC.13`, `-beta.1`, `-alpha.0`) or **manual `workflow_dispatch`** →
  upload only (build lands in App Store Connect / TestFlight, no store
  submission).

> The gate keys on the presence of `-` rather than denylisting `RC`/`beta`/
> `alpha`, because GitHub Actions `contains()` is case-sensitive and this repo's
> RC tags are predominantly **lowercase** `-rc.N`. Every pre-release tag in the
> repo's history contains `-`; no final tag does.

## Required secrets

Authentication uses an **App Store Connect API key** (reused from the
notarization secrets), which is more robust in CI than an Apple ID +
app-specific password:

| Secret                  | Used as           | Purpose                                                                                         |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `mac_api_key`           | `ASC_KEY_CONTENT` | Contents of the `.p8` key file (raw PEM, including the `-----BEGIN/END PRIVATE KEY-----` lines) |
| `mac_api_key_id`        | `ASC_KEY_ID`      | API key id                                                                                      |
| `mac_api_key_issuer_id` | `ASC_ISSUER_ID`   | API issuer id                                                                                   |

> **Important:** the API key must belong to a user with the **App Manager** role
> (or higher). A key with only the **Developer** role can upload/notarize but
> **cannot create a version or submit it for review**. If submission fails with
> a permissions error, mint a new key with the App Manager role and update the
> three secrets above.

## Caveats

- **Apple review is the only manual gate** — it is performed by humans (~1–2
  days) and can be rejected. Everything up to and including submission is
  automated.
- **`automatic_release: true`** ships the version to 100% of users the moment
  Apple approves it (no manual "Release this version" click, no staged
  rollout). If you'd prefer a human go-live or phased rollout, set
  `automatic_release: false` (and/or `phased_release: true` for iOS) in
  `fastlane/Fastfile`.
- **Build numbers are single-use.** If the lane fails _after_ the binary
  uploads but _before_ the submission completes (network drop, App-Manager-role
  error, export-compliance pause), simply re-running won't work — App Store
  Connect rejects a duplicate build number. Recovery means finishing the
  submission by hand in App Store Connect, or bumping the build number and
  re-tagging.
- **"What's New" locales:** only `en-US` notes are generated. If the App Store
  listing has additional active locales, Apple may require "What's New" text for
  them on submission. Add more `release_notes.txt` files (or extend
  `tools/prepare-appstore-release-notes.js`) as needed.
- **Export compliance:** if `ios/App/App/Info.plist` does not set
  `ITSAppUsesNonExemptEncryption`, App Store Connect will pause the submission
  to ask the encryption question. Set it once to keep submission fully hands-off.
- **Never enable fastlane verbose mode** (`--verbose` / `FASTLANE_VERBOSE`) in
  these lanes — verbose output can dump the deliver options hash, which carries
  the API key material.
