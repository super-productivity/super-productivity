# Implementation plan: public TestFlight build for the share extension (#10033)

**Status:** Plan only · **Date:** 2026-09-18
**Difficulty:** Low engineering, moderate Apple-side setup. Allow about an hour of
console work, one ~10-minute pipeline run, plus Apple's Beta App Review latency.

## Outcome and scope

Give outside testers a TestFlight build of [#10033](https://github.com/super-productivity/super-productivity/pull/10033)
(share sheet → inbox capture), which is the one feature that cannot be exercised
in the web preview because it is native iOS code.

The label-triggered pipeline itself is already proven: PR #10072 built, signed,
uploaded and distributed as 19.0.2 (build 2.1) on 2026-09-18. Nothing in this
plan changes the pipeline's design. What is missing is purely Apple-side
identifier and profile setup, because #10033 introduces a **second signable
bundle** and a **shared container**.

Out of scope: #8950 (WidgetKit) needs a third bundle ID and profile plus a
workflow change, and is explicitly rejected by the archive validation today.
Also out of scope: internal `master` betas, covered by
[`2026-07-14-ios-testflight-master-builds.md`](2026-07-14-ios-testflight-master-builds.md).

## Why this setup is required

Verified against the PR's own source, not assumed:

| Fact                                                                      | Where                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| Extension bundle ID is `com.super-productivity.app.ShareExtension`        | `ios/App/App.xcodeproj/project.pbxproj`           |
| App Group `group.com.super-productivity.app` declared in **both** targets | `App.entitlements`, `ShareExtension.entitlements` |

1. An `.appex` is a separately signed bundle. `xcodebuild -exportArchive` runs
   with `signingStyle: manual`, so it needs one profile per bundle ID; the main
   app's profile cannot cover the extension.
2. The extension runs in its own sandbox and reaches the app only through the
   App Group container.
3. A profile embeds the entitlements its App ID is authorised for. The current
   main-app profile predates the App Group, so it must be **regenerated**, not
   merely reused.

## Prerequisite: land the publisher fix first

`publish-ios-testflight.yml` runs from the default branch via `workflow_run`, so
the reporting fix (`d5907f9863`) must be on `master` before this run, or the
build will succeed while silently failing to comment or clear the label again.

**Verify:** `git log origin/master --oneline -- .github/workflows/publish-ios-testflight.yml`
shows the fix commit.

## Phase 1 — Apple Developer identifiers

In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/):

1. Register App Group `group.com.super-productivity.app`.
   **Verify:** it appears under Identifiers → App Groups.
2. Edit App ID `com.super-productivity.app` → enable **App Groups** → assign it.
   **Verify:** the capability shows as enabled with the group assigned.
3. Register explicit App ID `com.super-productivity.app.ShareExtension` → enable
   **App Groups** → assign the same group.
   **Verify:** both App IDs list the identical group.

## Phase 2 — Provisioning profiles

Use the existing Apple Distribution certificate for both.

4. Regenerate the App Store distribution profile for `com.super-productivity.app`.
   **Verify:** download it and confirm the entitlement is present:
   `security cms -D -i MainApp.mobileprovision | grep -A2 application-groups`
5. Create an App Store distribution profile for the ShareExtension App ID.
   **Verify:** same grep, plus the app ID line matches the extension bundle ID.

> Step 4 replaces the profile the **App Store release** path also uses
> (`build-ios.yml`). The regenerated profile is a superset, so releases keep
> working — but this is the one change here with fate shared beyond TestFlight.
> Keep the previous profile file until a release build has succeeded.

## Phase 3 — GitHub secrets

6. Encode both as single-line base64 and upload:

```bash
openssl base64 -A -in MainApp.mobileprovision > mainapp.b64
openssl base64 -A -in ShareExtension.mobileprovision > shareext.b64
gh secret set IOS_PROVISION_PROFILE --repo super-productivity/super-productivity < mainapp.b64
gh secret set IOS_SHARE_PROVISION_PROFILE --repo super-productivity/super-productivity < shareext.b64
```

**Verify:** `gh secret list --repo super-productivity/super-productivity | grep PROVISION`
shows both with today's date. Delete the local `.b64` files afterwards.

## Phase 4 — Trigger and publish

7. Apply the `ios-test-flight` label to #10033.
   **Verify:** a run of _iOS TestFlight Build on Label_ appears within ~30s on
   the PR's head SHA. #10033 is a **draft**; if no run appears, mark it ready for
   review and re-apply the label, then note the draft behaviour here.
8. Wait for the unsigned build (~5-10 min).
   **Verify:** the _Set TestFlight version_ step logs a marketing version one
   patch above the newest stable tag, and `build <run_number>.<run_attempt>`.
9. Let _iOS TestFlight Publish_ run `discover` and `validate`.
   **Verify:** both pass. This is the **first time** the ShareExtension branches
   in validation execute against a real archive — see Known gaps.
10. Approve the `ios-testflight` deployment only after checking the job name
    shows `PR #10033` and the expected head SHA.
11. **Verify:** the publish job logs `** EXPORT SUCCEEDED **` and
    `Successfully distributed build to External testers`, and the publisher
    comments on #10033 and removes the label.

## Phase 5 — Apple and tester verification

12. Confirm the build reaches Beta App Review and is approved (first external
    build of a new extension may take a day or two).
13. Install via the public link and verify the share sheet writes into the inbox.
    **Verify:** share a URL and a text selection from Safari; both appear as tasks.

## Known gaps

- The ShareExtension branches in `validate` and the `.appex` allowlist have
  **never executed against a real archive** — `master` has no extension target,
  so `App.app/PlugIns` does not exist on any build shipping today. Phase 4 is
  their first real exercise; a failure there is as likely to be the check as the
  PR.
- The reporting permission fix cannot be confirmed by re-running #10072:
  `workflow_run` re-runs load the workflow from the original run's default-branch
  SHA. Phase 4 step 11 is its first real test.

## Risks and rollback

| Risk                                                   | Mitigation                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Regenerated main profile breaks App Store releases     | Profile is a superset; keep the old file and verify on the next release build                   |
| Export fails on a missing/mismatched extension profile | Check both App IDs, their group assignment, the signing certificate, and both secrets           |
| Validation rejects a legitimate archive                | Compare the archive's actual `PlugIns` contents against the allowlist before changing the check |
| Bad build reaches public testers                       | **Expire Build** in App Store Connect; installed copies are not retracted                       |
| Approval spent on the wrong commit                     | Approve only after matching PR number and full head SHA in the job name                         |

Rollback for the whole feature is to remove the label and disable
`.github/workflows/build-ios-testflight.yml`; nothing here changes the release path
except the regenerated profile in step 4.
