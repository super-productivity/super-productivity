# Apple (iOS & macOS) release automation

See the [release and publishing runbook](release-and-publishing.md) for version
preparation, the draft-release gate, and non-Apple distribution channels.

Pushing a final version tag (`vX.Y.Z`) builds, signs, uploads **and submits**
the iOS and macOS App Store builds for review, set to release automatically once
Apple approves them. The only step that is not automated is Apple's human
review.

## Pipeline

| Target                                               | Workflow                                                      | Output                         |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| iOS App Store                                        | `.github/workflows/build-ios.yml`                             | `.ipa` → App Store Connect     |
| iOS TestFlight (public testers, label-triggered)     | `.github/workflows/build-ios-testflight.yml`                  | `.ipa` → TestFlight (external) |
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

## Public TestFlight builds (label-triggered)

A maintainer who wants outside testers to try a feature branch — e.g. one that
touches native iOS code and so cannot be exercised in the web preview — applies
the `ios-test-flight` label to a same-repo PR.
`.github/workflows/build-ios-testflight.yml` then builds the PR head, exports an
App Store Connect IPA, and runs the `fastlane ios testflight` lane, which uploads
to the external TestFlight group (default name `Public Testers`, override with
the `TESTFLIGHT_GROUP` variable) and submits it for Beta App Review. The workflow
posts the group's Public Link back on the PR and removes the label so re-applying
it starts a fresh build.

Guards:

- **Same-repo PRs only** (`head.repo.full_name == github.repository`). The job
  handles Apple signing secrets, so a fork PR must be pushed to a branch in this
  repo first. This is why the workflow uses `pull_request` (the PR head is built)
  rather than `pull_request_target`. Labeling a fork PR is silently skipped (no
  comment, label stays on) — remove the label by hand in that case.
- **Upload only** — it never submits the app for App Store review.
- The signing setup is shared with `build-ios.yml` through
  `.github/actions/setup-ios-signing`. Both reuse the same App Distribution
  certificate and App Manager API key, so this workflow carries the same
  credential exposure as the release path.

One-time setup (Apple's side cannot be automated):

1. Create the `ios-test-flight` label.
2. Merge this workflow to the default branch before labeling older branches —
   for a branch that predates the shared signing action, the workflow falls back
   to the base branch for that action.
3. In App Store Connect create an External Testing group named exactly
   `Public Testers` (or set the repository variable `TESTFLIGHT_GROUP` to match
   a different name), enable its Public Link, and let the first build clear
   Beta App Review. Later builds usually auto-approve.
4. Add the group's Public Link as the repository variable
   `TESTFLIGHT_PUBLIC_LINK` (a variable, not a secret — it is meant to be shared).
   Without it the PR comment still reports success/failure but prints no link.

The internal-`master` beta path proposed in
[`docs/plans/2026-07-14-ios-testflight-master-builds.md`](plans/2026-07-14-ios-testflight-master-builds.md)
is separate and not implemented here.

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
