# PR #8950 — iOS Widget Finalization Checklist

**Created:** 2026-08-06 · **Last updated:** 2026-09-19

PR: <https://github.com/super-productivity/super-productivity/pull/8950>

Operational handoff for the remaining Apple-side signing work. It does not
replace the implementation documentation
([`ios/App/SupWidget/README.md`](../../ios/App/SupWidget/README.md),
[`2026-07-07-ios-home-screen-widget-port.md`](2026-07-07-ios-home-screen-widget-port.md)).

## Status (2026-09-19)

Code and CI side:

- [x] Branch rebased onto current `master`. The head SHA is deliberately not
      pinned here — it moves with every push; read it from the PR instead.
- [x] `SupWidgetTests/WidgetDataTests.swift` raw-string defect fixed (a
      one-pound `#"…"#` literal closed early on `"#ff0000"`), which is what
      made the `iOS PR` → `Build app and test widget` check red.
- [x] Widget signing reworked onto the shared composite action
      `.github/actions/setup-ios-signing` (new optional
      `ios_widget_provision_profile` input), replacing the earlier inline step
      in `build-ios.yml` that `master` has since refactored away.
- [x] `publish-ios-testflight.yml` accepts the widget: `SupWidget.appex` is
      allowlisted in archive validation, gets the same bundle-ID/version
      assertions as `ShareExtension.appex`, and gets a conditional
      `provisioningProfiles` entry. It previously rejected this PR's archive by
      name.
- [ ] Apple identifiers, App Group, and provisioning profiles configured
      (below) — **the only remaining blocker on the release path**.
- [ ] `IOS_WIDGET_PROVISION_PROFILE` secret set.
- [ ] Signed export verified end to end (release or TestFlight run).
- [ ] Review approval and merge.

Not verified from Linux: nothing here compiles Swift or runs `xcodebuild`. The
Swift fix and the workflow logic were checked by reading and by YAML parsing
only; the first real proof is a green `Build app and test widget` job.

## Overlap with the share-extension TestFlight setup

[`2026-09-18-ios-share-extension-testflight-setup.md`](2026-09-18-ios-share-extension-testflight-setup.md)
asks for most of the same Apple-side work for #10033. Do it once:

| Work                                                         | Shared with #10033 |
| ------------------------------------------------------------ | ------------------ |
| Register App Group `group.com.super-productivity.app`        | Yes                |
| Enable the group on App ID `com.super-productivity.app`      | Yes                |
| Regenerate the main-app distribution profile                 | Yes                |
| Update `IOS_PROVISION_PROFILE`                               | Yes                |
| App ID `com.super-productivity.app.ShareExtension` + profile | #10033 only        |
| App ID `com.super-productivity.app.widget` + profile         | **#8950 only**     |
| `IOS_WIDGET_PROVISION_PROFILE`                               | **#8950 only**     |

If #10033's setup already landed, only the last two rows remain.

## 1. Configure Apple identifiers

Requires Apple Developer **Account Holder or Admin** access. Open
[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).

1. **App Group** — create or verify `group.com.super-productivity.app`
   ([docs](https://developer.apple.com/help/account/identifiers/register-an-app-group)).
2. **Widget App ID** — explicit App ID, description "Super Productivity
   Widget", bundle ID `com.super-productivity.app.widget`
   ([docs](https://developer.apple.com/help/account/identifiers/register-an-app-id)).
3. **Assign the group** to both `com.super-productivity.app` and
   `com.super-productivity.app.widget`: enable **App Groups** → **Configure** →
   select the group → save
   ([docs](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/)).

Changing capabilities invalidates the affected provisioning profiles, which is
why the main-app profile must be regenerated below.

## 2. Create the provisioning profiles

Two **App Store Connect** distribution profiles, both signed with the Apple
Distribution certificate the repo's `mac_certs` secret already holds. If
several active certificates are offered, do not guess — check which one the
existing main-app profile uses.

- **Main app** `com.super-productivity.app`: regenerate so it carries the App
  Group entitlement. Keep the previous file until a release build has
  succeeded; this profile is also used by the App Store release path.
- **Widget** `com.super-productivity.app.widget`: new profile, same group.

Keep both `.mobileprovision` files outside the repository. Never commit a
profile or its base64 form.
([docs](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile))

## 3. Validate the downloaded profiles (macOS)

```bash
APP_PROFILE="$HOME/Downloads/super-productivity-app.mobileprovision"
WIDGET_PROFILE="$HOME/Downloads/super-productivity-widget.mobileprovision"

security cms -D -i "$APP_PROFILE" > /tmp/sp-app-profile.plist
security cms -D -i "$WIDGET_PROFILE" > /tmp/sp-widget-profile.plist

for f in /tmp/sp-app-profile.plist /tmp/sp-widget-profile.plist; do
  /usr/libexec/PlistBuddy -c 'Print :Name' "$f"
  /usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$f"
  /usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$f"
  /usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.security.application-groups' "$f"
done
```

Acceptance criteria:

- [ ] Main application identifier ends with `com.super-productivity.app`.
- [ ] Widget application identifier ends with `com.super-productivity.app.widget`.
- [ ] Both profiles list `group.com.super-productivity.app`.
- [ ] Both profiles are unexpired.
- [ ] Both profiles use the distribution certificate available to CI.

The workflow re-checks the `application-identifier` of each profile and fails
early with the expected bundle ID if it does not match.

## 4. Update GitHub Actions secrets

```bash
openssl base64 -A -in "$APP_PROFILE" |
  gh secret set IOS_PROVISION_PROFILE --repo super-productivity/super-productivity
openssl base64 -A -in "$WIDGET_PROFILE" |
  gh secret set IOS_WIDGET_PROVISION_PROFILE --repo super-productivity/super-productivity

gh secret list --repo super-productivity/super-productivity | grep PROVISION
```

Until `IOS_WIDGET_PROVISION_PROFILE` exists, the composite action skips the
widget step and the export-options step fails with a message naming the secret
and pointing at `ios/App/SupWidget/README.md`. That failure is expected and is
the only thing blocking a signed build.

## 5. Prove the signed path

Either path exercises the same export:

- **Release path:** `gh workflow run build-ios.yml --ref claude/mobile-platform-improvements-jhp6x2 --repo super-productivity/super-productivity`.
  A manual dispatch uploads to TestFlight but does not submit for review.
- **TestFlight path:** apply the `ios-test-flight` label to the PR. This is the
  first run that exercises the new `SupWidget.appex` branches in
  `publish-ios-testflight.yml`'s `validate` job against a real archive — a
  failure there is as likely to be the check as the PR.

Acceptance criteria:

- [ ] Both profile bundle-ID verifications pass.
- [ ] Xcode archive succeeds with the embedded `SupWidget.appex`.
- [ ] `xcodebuild -exportArchive` succeeds with all mapped profiles.
- [ ] Upload to App Store Connect / TestFlight succeeds.
- [ ] The widget appears and its checkbox works **on a real device** —
      interactive widgets are unreliable in the simulator.

## 6. Final PR gate

- [ ] All required PR checks green, including `Build app and test widget`.
- [ ] Signed export proven (section 5).
- [ ] Reviewer approval; no unresolved threads.
- [ ] Still mergeable against `master`.

Merging is a separate, explicit action. Do not merge merely because CI is green.

## Common failure meanings

| Failure                                                             | Likely cause                                      | Action                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cannot create/configure App Group                                   | Insufficient Apple role                           | Ask Account Holder/Admin                                                           |
| Main profile lacks App Group                                        | Old profile survived capability change            | Regenerate and replace `IOS_PROVISION_PROFILE`                                     |
| `SupWidget target requires the IOS_WIDGET_PROVISION_PROFILE secret` | Secret not set yet                                | Section 4                                                                          |
| Widget bundle-ID verification fails                                 | Wrong profile selected/uploaded                   | Recreate for `com.super-productivity.app.widget`                                   |
| `Unsupported app extension in archive`                              | A new `.appex` is not in the validation allowlist | Map a profile for it and allowlist it deliberately; do not widen the check blindly |
| Signing identity not found                                          | Profile uses a different distribution certificate | Recreate with CI's existing certificate or update certificate secrets deliberately |
| `security cms` cannot decode profile                                | Wrong file or malformed base64 secret             | Redownload, validate locally, then upload again                                    |
| Xcode app/widget compile or unit tests fail                         | Code/configuration issue, not portal setup        | Stop and diagnose before merging                                                   |

Delete this document once the widget has shipped.
