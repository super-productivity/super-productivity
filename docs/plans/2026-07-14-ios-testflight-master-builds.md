# Implementation plan: Internal TestFlight builds from `master`

**Status:** Plan only · **Date:** 2026-07-14
**Difficulty:** Moderate. Allow about one engineering day split across two small
changes, plus Apple processing and tester verification time.

## Outcome and scope

Use the existing iOS signing/archive workflow to send the newest eligible `master`
state to an internal TestFlight group. Rapid pushes are coalesced: one beta may run
and only the newest superseding beta waits. This intentionally does not produce one
TestFlight build for every intermediate SHA.

Production behavior stays event-based: final `v*` tag pushes submit the existing iOS
release for review, prerelease tag pushes remain upload-only, and manual dispatch can
never submit to production. Master builds are marked **TestFlight Internal Only**, so
Apple cannot offer them to external testers or customers.

Out of scope: external TestFlight, app changes, new dependencies, and the existing
iOS/macOS App Store review-submission race. There is no new app-wide upload queue;
the internal-only beta path neither edits App Store metadata nor opens a review.

## Routing contract

| Event                                  | Export                   | Fastlane lane | Production submit |
| -------------------------------------- | ------------------------ | ------------- | ----------------- |
| Push to `master`                       | TestFlight Internal Only | `ios beta`    | Never             |
| Push of final `v*` tag                 | App Store Connect        | `ios release` | Yes               |
| Push of prerelease `v*` tag            | App Store Connect        | `ios release` | No                |
| Manual dispatch, default `beta` mode   | TestFlight Internal Only | `ios beta`    | Never             |
| Manual dispatch, `release-upload-only` | App Store Connect        | `ios release` | Never             |

The production guard must include the event type, not only the ref:

```yaml
SUBMIT_FOR_REVIEW: >-
  ${{ github.event_name == 'push'
      && startsWith(github.ref, 'refs/tags/v')
      && !contains(github.ref, '-') }}
```

Manual beta dispatch is allowed only from `master`. The explicit
`release-upload-only` mode preserves the workflow's current manual upload capability
without inheriting its final-tag submission footgun.

## Phase 0: Apple and version prerequisites

- Create one internal tester group, add the intended App Store Connect users, and
  enable automatic distribution. Accept that eligible tag uploads will also reach
  this group because automatic distribution is app/group configuration, not
  Git-ref-aware.
- Create a dedicated App Store Connect **team** API key with the Developer role for
  beta uploads. Store it as `ASC_*` secrets in an `internal-testflight` GitHub
  environment restricted to `master`, with no reviewer gate. A team key cannot be
  app-scoped; the separate lower-role key reduces privilege and credential reuse but
  still has team-wide upload access.
- Keep the existing App Manager key on the release route. Record secret names, roles,
  and certificate/profile expiry only—never key or tester content.
- On the pinned Xcode 26.2 runner, confirm `xcodebuild -help` supports the
  `testFlightInternalTestingOnly` export option and that the current provisioning
  profile can export that distribution type.
- Validate the build-number examples below with `agvtool`, the archived IPA, and
  Apple before enabling unattended builds.

## Increment A: Add a safe manual beta path

Do not add the `master` push trigger yet.

### Fastlane

Add `ios beta` to `fastlane/Fastfile`. It requires `IPA_PATH` and the existing
`ASC_*` contract, calls `upload_to_testflight`, and sets these options explicitly:

```ruby
skip_submission: true
skip_waiting_for_build_processing: false
distribute_external: false
submit_beta_review: false
wait_processing_timeout_duration: 1800
```

Do not pass tester groups, changelog, or notification options. App Store Connect's
automatic group owns internal distribution. A processing timeout means “upload
succeeded, processing unknown”; inspect App Store Connect before retrying. Never
re-upload the same IPA blindly.

### Workflow and versioning

Refactor `.github/workflows/build-ios.yml` into one build job and conditional beta
and release upload jobs:

- Add `workflow_dispatch.mode` with `beta` as the safe default and
  `release-upload-only` as the other choice.
- Set top-level `permissions: contents: read`.
- Export beta runs with `testFlightInternalTestingOnly: true`; tag and manual release
  uploads keep the current App Store Connect export.
- Preserve the exact stripped `package.json` marketing version on release routes.
- For betas, set `CFBundleShortVersionString` to
  `incrementPatch(max(stripPrerelease(package.version), highest stable vX.Y.Z tag))`.
  Fetch tags and implement the strict three-integer comparison without a dependency.
  This future train must be greater than the latest approved iOS version, including
  immediately after a release.
- Set `CFBundleVersion` exactly to
  `$(date -u +%Y%m%d%H%M).${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}` on every route.
  This remains above the old timestamp values and separates same-minute runs and
  reruns.
- Verify both values in every relevant target and in the exported IPA. Also confirm
  whether `VERSIONING_SYSTEM = apple-generic` must be added for reliable `agvtool`
  behavior.
- Move certificate/profile installation to immediately before export; the archive is
  already unsigned. Reuse of the shared Apple Distribution certificate remains an
  accepted residual risk on every master build.
- Pass exactly one IPA between jobs using pinned artifact actions, a run/attempt-
  specific name, `if-no-files-found: error`, a clean download directory, and one-day
  retention for beta artifacts. The upload jobs must fail unless exactly one regular
  `.ipa` exists.
- Bind only the beta upload job to `internal-testflight`; keep release credentials on
  the existing release path. Never enable verbose fastlane output.

Add workflow-level concurrency for the complete beta build/upload lifecycle: beta
runs share a fixed group with `cancel-in-progress: false` and `queue: single`, keeping
the running run and only the newest pending run. Tag and manual release runs use a
run/attempt-specific group, so a master push cannot coalesce them.

### Static verification

- `ruby -c fastlane/Fastfile`
- `bundle exec fastlane lanes` on the macOS runner
- `npx prettier --check .github/workflows/build-ios.yml`
- `git diff --check`
- Exercise the version calculation with an old timestamp build, two same-minute
  runs, a rerun, prerelease package versions, and a stable tag newer than the package.
- Review every routing-table case and confirm the `master` push trigger is absent.
- Confirm no dependency or secret content was added.

## Live gate between increments

Merge Increment A, then manually dispatch `beta` from `master` once. Do not proceed
until all of the following are true:

- Apple accepts and finishes processing the expected version/build pair.
- App Store Connect shows the **Internal** indicator and does not allow external or
  customer distribution.
- The automatic internal group receives it and one tester can install and launch it.
- No external Beta App Review, App Review submission, App Store version, or release
  metadata is created or changed.
- Logs and artifacts expose no signing or API-key material.

Record only the Actions URL, non-sensitive version/build pair, duration, and result.

## Increment B: Enable `master` and document operations

Add the branch trigger while retaining the existing tag trigger:

```yaml
push:
  branches: [master]
  tags: ['v*']
```

Update `docs/build-and-publish-notes.md`, `docs/apple-release-automation.md`, and
`.github/SECURITY-SETUP.md` with the routing table, internal-only boundary,
credentials, version/build formulas, coalescing, timeout recovery, and rollback.

After merge, confirm one normal `master` push uploads successfully. Start three beta
dispatches close together and verify the active run completes, the middle pending
run is superseded, and the newest pending run proceeds. A failed Apple
upload/processing result must leave Actions red.

The next tagged release is a follow-up observation, not an activation blocker:

- verify the release lane and submission behavior are unchanged;
- expect the automatic internal group to receive the eligible release build; and
- after it reaches Ready for Distribution, verify the next master beta advances to
  the following patch train and Apple accepts it.

## Cost, rollback, and risks

Each beta that survives coalescing consumes roughly 10–15 macOS runner minutes plus
one signed IPA upload. Track `accepted beta runs × duration` and artifact storage for
the first week. Keep one-day beta artifact retention; consider a proven-safe
docs-only path filter later only if cost/noise is material.

Rollback is to remove the `master` branch trigger while retaining manual beta mode.
If a distributed build must stop, use App Store Connect **Expire Build**; disabling
automatic group distribution affects future assignment but does not retract an
installed build. Keep the new version/build scheme after Apple has accepted it.

| Risk                                                  | Mitigation                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Beta reaches external testing or production           | Internal-only export plus fail-closed beta lane                                             |
| Post-release betas are rejected as an old version     | Future patch train based on package and stable tags; mandatory post-release check           |
| Rapid pushes create cost and TestFlight noise         | Workflow-wide beta coalescing and one-day artifacts                                         |
| Manual/tag routing submits the wrong build            | Explicit modes, event-type production guard, routing-table review                           |
| Production credentials gain exposure                  | Dedicated Developer beta key; release key stays on release job; protected master/CODEOWNERS |
| Signing identity gains exposure on every master build | Install only at export, restrict workflow changes, accept and document certificate reuse    |
| Apple processing times out after upload               | Inspect App Store Connect first; rebuild with a new number only when retry is required      |

## References to recheck when implementing

- [Apple: Distributing beta builds](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [Apple: Internal testers and internal-only builds](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
- [Apple: Build/version identifiers](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)
- [Apple: Marketing-version identifiers](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring)
- [fastlane: `upload_to_testflight`](https://docs.fastlane.tools/actions/upload_to_testflight/)
- [GitHub Actions: concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
