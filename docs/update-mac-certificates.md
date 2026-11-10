# Update macOS certificates for electron-builder

> **Related macOS docs:**
>
> - [Release and publishing](release-and-publishing.md)
> - [Mac App Store signing](mac-app-store-code-signing-guide.md)

This rotation updates the signing identities and provisioning profiles used by
the macOS GitHub Actions runners. The Keychain Access steps below use a Mac;
certificate requests and PKCS#12 exports can also be prepared with OpenSSL on
Linux, then tested on the existing macOS runners.

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
   `MAC_APP_STORE_PROFILE` and `dl_provision_profile`.

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

1. Export each replacement identity and its private key as a separate,
   password-protected PKCS#12 bundle. Include the Apple WWDR G3 intermediate in
   the Apple Distribution bundle. Preserve the existing direct-download bundle.
2. Verify that the bundle imports into a temporary keychain before uploading it.
3. Base64-encode the bundle and profiles:

   ```bash
   base64 -i apple-distribution.p12 -o apple-distribution.b64
   base64 -i mac-installer.p12 -o mac-installer.b64
   base64 -i tools/mac-profiles/mas.provisionprofile -o mas-profile.b64
   base64 -i tools/mac-profiles/dl.provisionprofile -o dmg-profile.b64
   ```

4. Update the GitHub Actions secrets referenced by the workflows:
   - `APPLE_DISTRIBUTION_CERT` and `APPLE_DISTRIBUTION_CERT_PASSWORD`: Apple
     Distribution identity shared by Mac App Store and iOS builds.
   - `MAC_INSTALLER_CERT` and `MAC_INSTALLER_CERT_PASSWORD`: Mac Installer
     Distribution identity used only by Mac App Store packaging.
   - `MAC_APP_STORE_PROFILE`: matching Mac App Store profile.
   - `IOS_APP_STORE_PROFILE`, `IOS_SHARE_APP_STORE_PROFILE`, and
     `IOS_WIDGET_APP_STORE_PROFILE`: matching iOS app and extension profiles.
   - `mac_certs`, `mac_certs_password`, and `dl_provision_profile`: existing
     Developer ID signing material for direct downloads; rotate separately.

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

4. Run the Mac Store and iOS release workflows with `build_only=true` to check
   signing without uploading to App Store Connect. Confirm the package
   fingerprint and exported app profiles match the replacements.

## 6. Retire old material

Only after both replacement build paths pass:

1. Keep old certificates available until every consumer has migrated. Do not
   automatically revoke Developer ID certificates: revocation can affect
   previously distributed software.
2. Remove the old identities from the local keychain.
3. Delete local unencrypted and base64 working files after confirming the secure
   backup and GitHub secrets are usable.
4. Record the rotation date and the new expiration dates in the team's
   credential inventory.
