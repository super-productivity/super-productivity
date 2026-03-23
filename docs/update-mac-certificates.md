# Update macOS certificates for electron-builder

> **Related macOS docs:**
> - [build-and-publish-notes.md](./build-and-publish-notes.md) -- Build/publish workflow (screenshots, iOS, Windows signing)
> - [mac-app-store-code-signing-guide.md](./mac-app-store-code-signing-guide.md) -- Code signing setup and troubleshooting

Mac access required! The instructions below refresh every asset used by the GitHub Actions/macOS runners for Mac App Store (MAS) and direct-download (DMG) builds.

## Certificates

### 1. Clean up old material

⚠️ Note: Deleting old certificates also removes their private keys. If you don’t have the private key backed up, generate a new CSR before creating new certificates (so maybe we should not delete the certificates too early?).

- In <https://developer.apple.com/account/resources/certificates/list>, revoke the expiring certificates so they cannot be downloaded again by accident.
- Remove the matching identities from your local keychain (`Keychain Access → My Certificates` - `open -a "Keychain Access"` ) so you do not export the wrong private key later.

### 2. Create a fresh CSR (once)

1. Open Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…
2. Enter the Apple ID email tied to the team, select “Saved to disk”, and pick a location for `mac-dev-team.csr`.
3. Repeat only if you need a CSR for a different Apple ID/team.

### 3. Generate the required certificates

Create the following certificates in the developer portal, using the CSR from step 2:

- **Apple Development** – used for local development/debug builds.
- **Apple Distribution** (Apple renamed “Mac App Distribution”) – used to sign the MAS app.
- **Mac Installer Distribution** – used to sign the MAS `.pkg` that is uploaded via Transporter.
- **Developer ID Application** – used to sign the notarized DMG build.
- **Developer ID Installer** – used if you ship a signed installer `.pkg` for DMG distribution (still required by electron-builder when `dist:mac:dl` runs).
  Download each resulting `.cer` file and note the exact label Apple shows so you can cross-check in CI logs later.

### 4. Install and export as PKCS#12

1. Double-click every downloaded `.cer` so it lands inside the login keychain under “My Certificates”. You should now see each certificate with a disclosure triangle that reveals the paired private key—if the triangle is missing, delete the cert and regenerate it so the private key attaches properly.
2. Multi-select the identities listed above (adjust if you only target MAS or only Developer ID), right-click → **Export Items…**, save as `all-certs.p12`, and choose a strong password (this password becomes the `MAC_CERTS_PASSWORD`). Confirm the repeated macOS password prompts.
   - Alternatively, run:
     ```bash
     security export -k ~/Library/Keychains/login.keychain-db \
       -t identities -f pkcs12 -P "$MAC_CERTS_PASSWORD" \
       -o all-certs.p12
     ```
3. Verify you can re-import `all-certs.p12` onto another Mac before proceeding.

### 5. Prepare CI secrets

1. Base64 the exported file: `base64 -i all-certs.p12 -o all-certs.b64`.
2. Update the GitHub Actions secret `MAC_CERTS` with the contents of `all-certs.b64` and the secret `MAC_CERTS_PASSWORD` with the password chosen above.
3. Map those secrets to electron-builder’s expectations inside your workflow, for example:
   ```yaml
   CSC_LINK: ${{ secrets.MAC_CERTS }}
   CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
   CSC_IDENTITY_AUTO_DISCOVERY: true
   ```
   Use `CSC_INSTALLER_LINK`/`CSC_INSTALLER_KEY_PASSWORD` if you decide to store installer identities separately.
4. If you prefer keeping separate secrets, repeat the export step per certificate and upload them with names such as `MAC_DISTRIBUTION_CERT`, but the current workflow expects a single bundle. Whatever approach you choose, ensure the CI job imports the PKCS#12 into an unlocked keychain before invoking electron-builder.

## Provisioning profiles

> Important: create/refresh profiles **after** the new certificates exist, otherwise downloading the profile will still pull the revoked certs.

1. Go to <https://developer.apple.com/account/resources/profiles/list>.
2. Create two new profiles:
   - **Type “Mac App Store”** → select the `Apple Distribution` certificate → choose the MAS App ID → download as `mas.provisionprofile`.
   - **Type “Developer ID Application”** → select the `Developer ID Application` certificate → choose the same App ID → download as `dl.provisionprofile` (optional for most Developer ID apps, but we keep it to satisfy older tooling and entitlements checks).
3. Move the files into `tools/mac-profiles/mas.provisionprofile` and `tools/mac-profiles/dl.provisionprofile` (keep the exact filenames so the build scripts pick them up). If you skip the Developer ID profile, remove `tools/mac-profiles/dl.provisionprofile` and clear the `DL_PROVISION_PROFILE` secret so CI doesn’t look for it.
4. Base64-encode them for CI:
   ```bash
   base64 -i tools/mac-profiles/dl.provisionprofile -o dmg-profile.b64
   base64 -i tools/mac-profiles/mas.provisionprofile -o mas-profile.b64
   ```
5. Update the GitHub secrets `DL_PROVISION_PROFILE` (dmg) and `MAS_PROVISION_PROFILE` (store) with the encoded strings and ensure the workflows pass them to electron-builder (e.g., `build.mac.provisioningProfile`). Remember to keep hardened runtime enabled (`build.mac.hardenedRuntime=true`) and entitlements aligned for notarization.

See also:

- <https://www.electron.build/code-signing.html>
- <https://www.electronjs.org/docs/tutorial/mac-app-store-submission-guide>

## Build the DMG locally

1. Create or refresh an app-specific password at <https://appleid.apple.com/account/manage> (use the same Apple ID as notarization).
2. Confirm your scripts use `xcrun notarytool` (Apple blocked `altool` uploads as of 2023‑11‑01). electron-builder defaults to `notarytool` when it detects Xcode 14+, so avoid overriding that behavior.
3. Run:
   ```bash
   APPLEID="you@example.com" \
   APPLEIDPASS="app-specific-password" \
   rm -Rf app-builds && npm run build && npm run dist:mac:dl
   ```
4. The script signs, notarizes (via `notarytool`), and staples the DMG using the new certificates and provisioning profiles. Validate with `spctl --assess -vv --type install path/to/app`.

