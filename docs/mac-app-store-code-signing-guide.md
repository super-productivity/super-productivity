# Mac App Store code signing

> **Related macOS docs:**
>
> - [Release and publishing](release-and-publishing.md)
> - [Certificate rotation](update-mac-certificates.md)

Mac App Store validation requires the application signing identity to match a
certificate embedded in its provisioning profile. Certificate names,
fingerprints, and owners change at every rotation, so derive them from the
current keychain and profile rather than copying maintainer-specific values into
configuration or documentation.

## Sources of truth

- [`build/electron-builder.mas.yaml`](../build/electron-builder.mas.yaml) owns the
  MAS target, entitlements, application ID, and profile path.
- [The Mac App Store workflow](../.github/workflows/build-publish-to-mac-store-on-release.yml)
  owns certificate import, secret names, profile installation, diagnostics, and
  upload.
- The Apple Developer portal owns the active certificates and provisioning
  profiles.

Keep identity selection automatic unless the executable configuration changes.
Do not add a copied certificate name or fingerprint to electron-builder config.

## Create the provisioning profile

1. Confirm that the intended current **Apple Distribution** identity and private
   key are installed:

   ```bash
   security find-identity -v -p codesigning
   ```

2. In the
   [Apple Developer profile portal](https://developer.apple.com/account/resources/profiles/list),
   create a **Mac App Store Connect** distribution profile for
   `com.super-productivity.app`.
3. Select the current Apple Distribution certificate shown by the portal. Do
   not select a superseded legacy Mac App Distribution certificate merely
   because it has a familiar owner name.
4. Save the profile as `tools/mac-profiles/mas.provisionprofile`.

## Verify the profile dynamically

List every certificate embedded in the profile. The script prints its subject
and SHA-1 fingerprint; SHA-1 is used here only because macOS identity listings
use that identifier.

```bash
PROFILE_PATH="tools/mac-profiles/mas.provisionprofile" python3 - <<'PY'
import hashlib
import os
import plistlib
import subprocess
import tempfile

profile = subprocess.run(
    ["security", "cms", "-D", "-i", os.environ["PROFILE_PATH"]],
    check=True,
    capture_output=True,
).stdout
certificates = plistlib.loads(profile)["DeveloperCertificates"]

with tempfile.TemporaryDirectory() as directory:
    for index, certificate in enumerate(certificates):
        path = os.path.join(directory, f"profile-cert-{index}.der")
        with open(path, "wb") as output:
            output.write(certificate)
        subject = subprocess.run(
            [
                "openssl",
                "x509",
                "-inform",
                "DER",
                "-in",
                path,
                "-noout",
                "-subject",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        fingerprint = hashlib.sha1(certificate).hexdigest().upper()
        print(f"{fingerprint}  {subject}")
PY
```

Confirm that at least one fingerprint exactly matches the intended Apple
Distribution identity from `security find-identity`.

## Update CI and test

1. Encode the verified profile:

   ```bash
   base64 -i tools/mac-profiles/mas.provisionprofile -o mas-profile.b64
   ```

2. Update the `mas_provision_profile` GitHub Actions secret. Do not commit the
   encoded profile.
3. Build locally with the same profile:

   ```bash
   cp tools/mac-profiles/mas.provisionprofile embedded.provisionprofile
   npm run build
   npm run dist:mac:mas:buildOnly
   ```

4. Inspect the actual app signature and package:

   ```bash
   codesign -dv --verbose=4 \
     ".tmp/app-builds/mas-universal/Super Productivity.app"
   pkgutil --check-signature \
     .tmp/app-builds/mas-universal/super*.pkg
   ```

5. Run the Mac App Store workflow and compare its profile-certificate diagnostic
   with the identity reported during signing. They must refer to the same
   current certificate before upload.

## Troubleshooting

### Provisioning-profile certificate mismatch

If Apple reports that the executable was not signed by a certificate contained
in the profile:

1. Re-run the profile inspection above.
2. Check the build log for the identity electron-builder selected.
3. Confirm that the CI PKCS#12 bundle contains that identity and its private key.
4. Recreate the profile with the selected current Apple Distribution
   certificate, or replace the CI bundle if the selected identity is
   unintended.

Do not fix a mismatch by pasting a maintainer name or old fingerprint into
configuration.

### Package is signed but unavailable in App Store Connect

- Wait for Apple's processing to finish.
- Complete the build's export-compliance questions.
- Confirm the version and build number have not already been used.
- Confirm the build appears under the macOS platform.

## Rotation

Create and test replacement certificates, profiles, and CI secrets before
revoking the working identities. Follow
[the rotation runbook](update-mac-certificates.md); it keeps the current release
path available until both replacement build paths pass.
