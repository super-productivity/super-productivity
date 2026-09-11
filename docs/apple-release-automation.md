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
| iOS TestFlight (public testers, label-triggered)     | `build-ios-testflight.yml` → `publish-ios-testflight.yml`     | `.ipa` → TestFlight (external) |
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
`.github/workflows/build-ios-testflight.yml` builds an **unsigned** archive with
no Apple credentials. After it completes,
`.github/workflows/publish-ios-testflight.yml` runs trusted code from `master`,
validates and repacks the archive without credentials, waits for approval through
the protected `ios-testflight` environment, then signs and runs the
`fastlane ios testflight` lane. The lane verifies the external group and Public
Link, uploads the build, and submits it for Beta App Review. The publisher then
comments on the PR and removes the label so re-applying it starts a fresh build.

### Security boundary

- **Same-repo PRs targeting `master` only.** A fork PR must be pushed to a branch
  in this repo first. Labeling a fork PR is silently skipped (no comment, label
  stays on) — remove the label by hand in that case.
- **PR code never receives Apple credentials.** npm lifecycle scripts, CocoaPods,
  Xcode project files, and build phases run only in the unsigned build workflow.
- **Trusted publisher.** `workflow_run` loads the publisher from the default
  branch. Its credential-free validation job confirms the source workflow path,
  associated open PR, same-repo head, current head SHA, `master` base, label,
  metadata, app IDs, versions, build numbers, archive paths, and symlinks. It
  repacks the validated archive before the credentialed job downloads it.
- **Human signing gate.** The publish job is bound to the protected
  `ios-testflight` environment. Approve only when its job name shows the intended
  PR number and full head SHA. No Apple secret is available before this gate.
- **Upload only** — it never submits the app for App Store review.
- The signing setup is shared with `build-ios.yml` through
  `.github/actions/setup-ios-signing`. Both reuse the same App Distribution
  certificate and App Manager API key, so this workflow carries the same
  credential exposure as the release path.

### One-time Apple Developer setup

The share extension in [PR #10033](https://github.com/super-productivity/super-productivity/pull/10033)
has its own bundle ID and profile. In
[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/):

1. Register the App Group `group.com.super-productivity.app`.
2. Edit the existing App ID `com.super-productivity.app`, enable **App Groups**,
   and assign that group.
3. Register the explicit App ID `com.super-productivity.app.ShareExtension`,
   enable **App Groups**, and assign the same group.
4. Regenerate the main app's App Store distribution provisioning profile using
   the existing Apple Distribution certificate. The regenerated profile must
   contain the App Group entitlement.
5. Create an App Store distribution provisioning profile for
   `com.super-productivity.app.ShareExtension` using the same certificate.

Encode each downloaded profile as a single base64 line before adding it to
GitHub:

```bash
openssl base64 -A -in MainApp.mobileprovision
openssl base64 -A -in ShareExtension.mobileprovision
```

The shared signing action treats the extension profile as optional for branches
without the extension. If `ios/App/ShareExtension/Info.plist` exists, both the
release and TestFlight workflows fail before export unless the extension profile
is available, then map both bundle IDs into `ExportOptions.plist`.

### One-time App Store Connect setup

In **App Store Connect → Apps → Super Productivity → TestFlight**:

1. Complete the beta test information (description, feedback email, contact
   information, review notes, and demo credentials if sign-in is required).
2. Create an **External Testing** group named exactly `Public Testers`. To use a
   different name, set the `TESTFLIGHT_GROUP` repository variable to that exact
   value.
3. Enable the group's **Public Link** and initially use a conservative tester
   limit (for example, 100).
4. Copy the public join URL. The Fastlane lane fails closed unless exactly one
   matching external group exists and its Public Link is enabled.

The workflow submits each uploaded build for Beta App Review; Apple reviews the
first build and later builds usually approve faster. A successful workflow means
upload/distribution setup succeeded, not necessarily that Apple has already
approved the build for external testers.

### One-time GitHub setup

Before merging or applying the label, create the environment under
**Settings → Environments → New environment**:

1. Name it exactly `ios-testflight`.
2. Add only trusted release maintainers as **Required reviewers**. If more than
   one release maintainer is available, enable **Prevent self-review**.
3. Restrict deployment branches to `master`.
4. Add the environment secret `IOS_TESTFLIGHT_ENV_READY` with the exact value
   `configured`. This fail-closed marker is deliberately not a repository secret.
5. Save and verify the protection rules. A missing environment may be created
   automatically without protection, but without this environment-only marker
   the publish job stops before checkout or signing.

Under **Settings → Secrets and variables → Actions**, verify the existing iOS
release secrets and add the extension profile. They may remain repository
secrets because only the protected publisher job references them; the unsigned
PR workflow references none:

| Secret                        | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `APPLE_TEAM_ID`               | Team used in `ExportOptions.plist`                          |
| `mac_certs`                   | Base64-encoded Apple Distribution `.p12`                    |
| `mac_certs_password`          | Password for `mac_certs`                                    |
| `IOS_PROVISION_PROFILE`       | Regenerated main-app profile with the App Group entitlement |
| `IOS_SHARE_PROVISION_PROFILE` | Share-extension distribution profile                        |
| `mac_api_key`                 | Raw App Store Connect API `.p8` contents                    |
| `mac_api_key_id`              | App Store Connect API key ID                                |
| `mac_api_key_issuer_id`       | App Store Connect API issuer ID                             |
| `UNSPLASH_KEY`                | Existing frontend build-time Unsplash key                   |
| `UNSPLASH_CLIENT_ID`          | Existing frontend build-time Unsplash client ID             |

The API key needs the **App Manager** role to manage external TestFlight
distribution and Beta App Review. The automatic `GITHUB_TOKEN` is not a setup
secret; jobs receive only the explicit read/write permissions in their workflow.

Create these repository variables:

| Variable                 | Required | Value                                             |
| ------------------------ | -------- | ------------------------------------------------- |
| `TESTFLIGHT_PUBLIC_LINK` | Yes      | `https://testflight.apple.com/join/...`           |
| `TESTFLIGHT_GROUP`       | No       | External group name; defaults to `Public Testers` |

Finally, create the exact repository label `ios-test-flight`, for example with
the description “Build and distribute this PR through public iOS TestFlight.”

### Activate and operate

1. Create and protect the `ios-testflight` environment before merging the
   workflows.
2. Merge the workflows to `master`. Old feature branches do not need to contain
   them: the unsigned builder takes the version helper and version inputs from
   `master`, and the publisher always runs from the default branch.
3. Apply `ios-test-flight` to a same-repo PR targeting `master`.
4. Wait for **iOS TestFlight Build on Label** to produce the unsigned archive.
5. Open **iOS TestFlight Publish**. Its validation job recomputes the expected
   marketing version from the greater of `master`'s `package.json` version and
   stable tags merged into `master`, then increments the patch. The build number
   is the source workflow's `run_number.run_attempt` and is checked in both app
   targets. A newer `master` that changes this version train fails validation, so
   a stale build is never signed.
6. Review the PR and exact SHA shown in the protected publish job name, then
   approve the `ios-testflight` deployment.
7. Follow the build under App Store Connect → TestFlight. After upload, the
   publisher comments with the stable public link and removes the label. Remove
   and re-apply the label after new commits to request another build.

Testers only need an iPhone or iPad, the TestFlight app, and the public link.
They do not need a Mac, Xcode, or an Apple Developer account.

### Failure and rollback

- If fastlane times out after upload, inspect App Store Connect before retrying;
  Apple may still be processing or reviewing the build. A re-applied label uses
  a new build number, but an unnecessary upload creates noise and consumes a
  TestFlight slot.
- If export reports a missing or mismatched profile, check both App IDs, their
  App Group assignment, the profile certificate, and the two profile secrets.
- If validation reports a stale head or base, remove/re-apply the label to build
  the current PR state. Validation intentionally refuses to sign an archive after
  the PR head changes.
- Source build failures, validation failures, and normal publish failures are
  reported on the PR and remove the label. A hard cancellation of the publisher
  can prevent reporting; remove the label manually in that case.
- To stop distributing a bad build, use **Expire Build** in App Store Connect.
- To disable public PR builds, remove the `ios-test-flight` label and disable or
  remove `.github/workflows/build-ios-testflight.yml`. Installed builds are not
  remotely removed; expiring a build prevents new installs.

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
