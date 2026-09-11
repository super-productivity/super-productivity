# Update macOS certificates for electron-builder

> **Related macOS docs:**
>
> - [Release and publishing](release-and-publishing.md)
> - [Mac App Store signing](mac-app-store-code-signing-guide.md)

This rotation updates the certificate bundle and provisioning profiles used by
the macOS GitHub Actions runners. Perform it on a Mac with access to the Apple
Developer team.

Keep the currently working identities valid until the replacement bundle has
passed local and CI signing checks. Revoking first creates an avoidable release
outage and can destroy the only usable private-key pairing.

## 1. Inventory and back up the working setup

1. Record which Apple Distribution, Mac Installer Distribution, and Developer
   ID identities the current workflows use:

   ```bash
   security find-identity -v -p codesigning
   ```

2. Export the working identities and private keys from **Keychain Access → My
   Certificates** to an encrypted PKCS#12 backup. Store it in the team's secure
   credential storage.
3. Record the active certificate expiration dates and the profile names used by
   `mas_provision_profile` and `dl_provision_profile`.

If Apple's certificate quota prevents creating a replacement alongside the
working certificate, confirm the backup can be imported and schedule a
maintenance window before revoking anything.

## 2. Create and install replacements

1. In Keychain Access, create a certificate signing request for the Apple
   Developer team.
2. In the
   [Apple Developer certificate portal](https://developer.apple.com/account/resources/certificates/list),
   issue the certificate types required by the current workflows:
   - Apple Distribution for Mac App Store application signing
   - Mac Installer Distribution for the uploaded Mac App Store package
   - Developer ID Application for direct-download builds
   - any additional identity still referenced by a current workflow
3. Download and install each certificate in the login keychain.
4. In **My Certificates**, expand every new identity and confirm that its private
   key is attached.

Do not remove or revoke the old identities yet.

## 3. Create replacement provisioning profiles

Create profiles only after the new certificates exist:

1. Create a Mac App Store profile for `com.super-productivity.app` using the new
   Apple Distribution certificate. Save it as
   `tools/mac-profiles/mas.provisionprofile`.
2. If the direct-download workflow still uses a Developer ID profile, create it
   with the new Developer ID Application certificate and save it as
   `tools/mac-profiles/dl.provisionprofile`.
3. Inspect each profile and confirm its embedded certificate is one of the new
   identities:

   ```bash
   security cms -D -i tools/mac-profiles/mas.provisionprofile
   security cms -D -i tools/mac-profiles/dl.provisionprofile
   ```

The profile certificate and the identity selected for signing must match. The
dynamic verification procedure is in
[Mac App Store signing](mac-app-store-code-signing-guide.md).

## 4. Export and update CI secrets

1. In Keychain Access, export the replacement identities and their private keys
   as one password-protected `all-certs.p12`. Use a newly generated password.
2. Verify that the bundle imports into a temporary keychain before uploading it.
3. Base64-encode the bundle and profiles:

   ```bash
   base64 -i all-certs.p12 -o all-certs.b64
   base64 -i tools/mac-profiles/mas.provisionprofile -o mas-profile.b64
   base64 -i tools/mac-profiles/dl.provisionprofile -o dmg-profile.b64
   ```

4. Update the GitHub Actions secrets referenced by the workflows:
   - `mac_certs` and `mac_certs_password`
   - `mas_provision_profile`
   - `dl_provision_profile`

The workflow files are authoritative for secret names and whether a profile is
still required. Never commit PKCS#12 files, encoded secret files, or passwords.

## 5. Validate before revoking anything

1. Build and verify the Mac App Store package:

   ```bash
   cp tools/mac-profiles/mas.provisionprofile embedded.provisionprofile
   npm run build
   npm run dist:mac:mas:buildOnly
   codesign -dv --verbose=4 \
     ".tmp/app-builds/mas-universal/Super Productivity.app"
   pkgutil --check-signature \
     .tmp/app-builds/mas-universal/super*.pkg
   ```

2. For a local direct-download notarization test, enter credentials through
   silent prompts so the app-specific password is not written to shell history.
   Run the following in Bash; the subshell limits the exported values to the
   build:

   ```bash
   (
     set -e
     read -r -p "Apple ID: " APPLE_ID
     read -r -s -p "App-specific password: " APPLE_APP_SPECIFIC_PASSWORD
     printf "\n"
     read -r -p "Apple team ID: " APPLE_TEAM_ID
     export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
     npm run build
     npm run dist:mac:dl
   )
   ```

3. Verify the DMG signature and notarization:

   ```bash
   codesign --verify --deep --strict --verbose=2 "<path-to-built-app>"
   spctl --assess --type open --context context:primary-signature -vv \
     "<path-to-dmg>"
   xcrun stapler validate "<path-to-dmg>"
   ```

4. Run the macOS signing workflow that exercises the updated secrets and confirm
   its certificate/profile diagnostics match.

## 6. Retire old material

Only after both replacement build paths pass:

1. Revoke the superseded certificates in the Apple Developer portal.
2. Remove the old identities from the local keychain.
3. Delete local unencrypted and base64 working files after confirming the secure
   backup and GitHub secrets are usable.
4. Record the rotation date and the new expiration dates in the team's
   credential inventory.
