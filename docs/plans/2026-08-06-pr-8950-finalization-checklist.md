# PR #8950 — iOS Widget Finalization Checklist

Last updated: 2026-08-06

PR: <https://github.com/super-productivity/super-productivity/pull/8950>

This document is the operational handoff for the remaining signing and merge
work; it does not replace the widget implementation documentation.

## Current status

- [x] PR branch rebased onto current `master`.
- [x] Rebased head pushed to the PR branch: `91c3def999a8943c7f5ef6f19550d04cd2eae313`.
- [x] `dayStr` / `validUntil` widget-data conflict resolved across TypeScript,
      Kotlin, and Swift.
- [x] Cross-platform writer/reader fixture aligned.
- [x] Full JavaScript/TypeScript suite, production frontend build, required
      per-file checks, and Android widget contract test passed locally.
- [ ] All GitHub PR checks complete successfully.
- [ ] Apple App Group and widget App ID configured.
- [ ] Main-app and widget provisioning profiles installed as GitHub secrets.
- [ ] Signed iOS workflow exports and uploads the app successfully.
- [ ] Required review approval received and PR merged.

At the time this document was written, GitHub reported the PR as mergeable but
blocked pending checks/review. CodeQL, lint, frontend build, dependency review,
Lighthouse, package-lock validation, and documentation-link checks were green.
The iOS widget build, Android native tests, main tests, Electron build, preview,
and E2E jobs were still running.

## Estimate

| Work                                           | Hands-on time | Typical elapsed time |
| ---------------------------------------------- | ------------: | -------------------: |
| Monitor and assess current PR CI               |       2–5 min |            10–30 min |
| Configure Apple identifiers and App Group      |     10–15 min |            10–20 min |
| Regenerate/create two provisioning profiles    |     10–15 min |            10–20 min |
| Validate profiles and update GitHub secrets    |      5–10 min |             5–10 min |
| Run and monitor signed iOS/TestFlight workflow |       3–5 min |            20–40 min |
| Final PR review and merge                      |       2–5 min |   Reviewer-dependent |

**Expected total:** about **30–50 minutes of hands-on work** and **45–90
minutes elapsed**, excluding reviewer availability.

If the Apple account lacks Account Holder/Admin access, the correct Apple
Distribution certificate is unclear, or a profile must be repaired, allow
additional coordination time—potentially one business day or more.

## 1. Wait for the ordinary PR checks

Monitor the checks:

```bash
gh pr checks 8950 --repo super-productivity/super-productivity --watch
```

Pay particular attention to:

- `Build app and test widget`
- `Android Native Tests (JVM + Emulator)`
- `Tests`
- SuperSync and WebDAV E2E jobs

Do not proceed to merge if any required check fails. A failed signed iOS build
caused only by missing profiles is expected until the Apple setup below is
complete; a compile or unit-test failure is not.

## 2. Configure Apple identifiers

This requires Apple Developer **Account Holder or Admin** access.

Open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).

### 2.1 Create or verify the App Group

Under **Identifiers**, click **+**, choose **App Groups**, and create or verify:

```text
group.com.super-productivity.app
```

Reference: [Apple — Register an app group](https://developer.apple.com/help/account/identifiers/register-an-app-group)

### 2.2 Register the widget App ID

Under **Identifiers**, click **+**, choose **App IDs**, then create an explicit
App ID:

```text
Description: Super Productivity Widget
Bundle ID:   com.super-productivity.app.widget
```

Reference: [Apple — Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)

### 2.3 Assign the App Group to both App IDs

Edit each identifier:

```text
com.super-productivity.app
com.super-productivity.app.widget
```

For both identifiers:

1. Enable **App Groups**.
2. Click **Configure**.
3. Select `group.com.super-productivity.app`.
4. Save/confirm the change.

Changing capabilities invalidates affected provisioning profiles, which is why
the main-app profile must be regenerated in the next step.

Reference: [Apple — Enable app capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/)

## 3. Create the provisioning profiles

Under **Profiles**, prepare two **App Store Connect** distribution profiles.

### Main app

- App ID: `com.super-productivity.app`
- Regenerate the existing distribution profile, or create a replacement.
- Confirm it contains the App Group entitlement.

### Widget extension

- App ID: `com.super-productivity.app.widget`
- Create a new App Store Connect distribution profile.
- Confirm it contains the same App Group entitlement.

Select the Apple Distribution certificate already represented by the
repository's `mac_certs` secret. If multiple active certificates are offered,
do not guess: determine which certificate the existing main-app profile/CI uses.

Download both `.mobileprovision` files and keep them outside the repository.
Never commit a provisioning profile or its Base64 representation.

Reference: [Apple — Create an App Store Connect provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile)

## 4. Validate the downloaded profiles on macOS

Set paths to the downloaded files:

```bash
APP_PROFILE="$HOME/Downloads/super-productivity-app.mobileprovision"
WIDGET_PROFILE="$HOME/Downloads/super-productivity-widget.mobileprovision"

security cms -D -i "$APP_PROFILE" > /tmp/sp-app-profile.plist
security cms -D -i "$WIDGET_PROFILE" > /tmp/sp-widget-profile.plist
```

Inspect bundle IDs, App Groups, profile names, and expiration dates:

```bash
/usr/libexec/PlistBuddy -c 'Print :Name' /tmp/sp-app-profile.plist
/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /tmp/sp-app-profile.plist
/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' /tmp/sp-app-profile.plist
/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.security.application-groups' /tmp/sp-app-profile.plist

/usr/libexec/PlistBuddy -c 'Print :Name' /tmp/sp-widget-profile.plist
/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /tmp/sp-widget-profile.plist
/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' /tmp/sp-widget-profile.plist
/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.security.application-groups' /tmp/sp-widget-profile.plist
```

Acceptance criteria:

- [ ] Main application identifier ends with `com.super-productivity.app`.
- [ ] Widget application identifier ends with `com.super-productivity.app.widget`.
- [ ] Both profiles list `group.com.super-productivity.app`.
- [ ] Both profiles are unexpired.
- [ ] Both profiles use the distribution certificate available to CI.

## 5. Update GitHub Actions secrets

First inspect the existing secret names:

```bash
gh secret list --repo super-productivity/super-productivity | grep IOS
```

Replace the main-app profile and add/replace the widget profile:

```bash
base64 < "$APP_PROFILE" | tr -d '\n' |
  gh secret set IOS_PROVISION_PROFILE --repo super-productivity/super-productivity

base64 < "$WIDGET_PROFILE" | tr -d '\n' |
  gh secret set IOS_WIDGET_PROVISION_PROFILE --repo super-productivity/super-productivity
```

Verify that both names are present. GitHub does not reveal secret values:

```bash
gh secret list --repo super-productivity/super-productivity |
  grep -E '^IOS_(WIDGET_)?PROVISION_PROFILE'
```

Reference: [GitHub — Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

## 6. Run the signed iOS workflow

The ordinary PR workflow tests the app/widget without signing. The release
workflow is the proof that both profiles, entitlements, certificate, archive,
and App Store export work together.

Trigger it on the PR branch:

```bash
gh workflow run build-ios.yml \
  --ref claude/mobile-platform-improvements-jhp6x2 \
  --repo super-productivity/super-productivity
```

Find and watch the run:

```bash
gh run list \
  --workflow build-ios.yml \
  --branch claude/mobile-platform-improvements-jhp6x2 \
  --limit 1 \
  --repo super-productivity/super-productivity
```

Then run `gh run watch <run-id> --repo super-productivity/super-productivity`.

A manual run uploads the resulting IPA to TestFlight but does **not** submit it
for App Store review.

Acceptance criteria:

- [ ] Main profile bundle-ID verification passes.
- [ ] Widget profile bundle-ID verification passes.
- [ ] Xcode archive succeeds.
- [ ] IPA export succeeds with both provisioning profiles.
- [ ] Upload to App Store Connect/TestFlight succeeds.

## 7. Final PR gate

Before merging:

- [ ] All required PR checks are green.
- [ ] Signed iOS/TestFlight workflow is green.
- [ ] Required reviewer approval is present.
- [ ] No unresolved review threads remain.
- [ ] PR still reports as mergeable against `master`.

Merging is a separate, explicit action. Do not merge merely because CI is green.

## Common failure meanings

| Failure                                     | Likely cause                                      | Action                                                                             |
| ------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cannot create/configure App Group           | Insufficient Apple role                           | Ask Account Holder/Admin                                                           |
| Main profile lacks App Group                | Old profile survived capability change            | Regenerate and replace `IOS_PROVISION_PROFILE`                                     |
| Widget bundle-ID verification fails         | Wrong profile selected/uploaded                   | Recreate for `com.super-productivity.app.widget`                                   |
| Signing identity not found                  | Profile uses a different distribution certificate | Recreate with CI's existing certificate or update certificate secrets deliberately |
| `security cms` cannot decode profile        | Wrong file or malformed Base64 secret             | Redownload, validate locally, then upload again                                    |
| Xcode app/widget compile or unit tests fail | Code/configuration issue, not portal setup        | Stop and diagnose before merging                                                   |
