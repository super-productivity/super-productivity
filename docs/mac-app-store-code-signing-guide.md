# Mac App Store Code Signing Guide

This document explains the Mac App Store (MAS) code signing setup and troubleshooting for Super Productivity. It covers the complete solution to certificate/provisioning profile mismatches.

## Overview

The Mac App Store build requires precise matching between:

1. The **code signing certificate** used by electron-builder
2. The **certificate embedded in the provisioning profile**

Any mismatch will cause Apple's validation to fail with errors like:

```
Invalid Code Signing. The executable '...' must be signed with the certificate
that is contained in the provisioning profile.
```

## The Root Problem (and Solution)

### What Was Happening

We had **two distribution certificates** in the keychain:

1. `Apple Distribution: Johannes Millan (363FAFK383)` - fingerprint `968086...` (modern)
2. `3rd Party Mac Developer Application: Johannes Millan (363FAFK383)` - fingerprint `3731BEC0...` (legacy)

**Electron-builder always prefers "Apple Distribution" over "3rd Party Mac Developer Application"** when both are present, regardless of environment variables or config settings.

Our provisioning profile contained the legacy "3rd Party Mac Developer Application" certificate, but electron-builder was signing with "Apple Distribution" → **mismatch** → validation failure.

### The Solution

**Create a new provisioning profile that uses the modern "Apple Distribution" certificate** to match what electron-builder wants to use.

## Step-by-Step Setup

### 1. Verify Your Certificates

Check which certificates are in your keychain:

```bash
security find-identity -v -p codesigning | grep -E "Apple Distribution|3rd Party"
```

You should see:

- `Apple Distribution: Johannes Millan (363FAFK383)` - fingerprint `968086...`
- `3rd Party Mac Developer Application: Johannes Millan (363FAFK383)` - fingerprint `3731BEC0...`

### 2. Create New Provisioning Profile

Go to [Apple Developer Portal - Profiles](https://developer.apple.com/account/resources/profiles/list):

1. Click **➕** to create a new profile
2. Select: **Distribution** → **Mac App Store Connect**
3. **CRITICAL**: When selecting the certificate, choose:

   - ✅ **"Johannes Millan (Distribution)"** - Shows "For use in Xcode 11 or later"
   - ❌ NOT "Johannes Millan (Mac App Distribution)"

   **Why this matters:**

   - "Johannes Millan (Distribution)" = modern "Apple Distribution" certificate → What electron-builder will use ✅
   - "Johannes Millan (Mac App Distribution)" = legacy "3rd Party Mac Developer Application" → Will cause mismatch ❌

4. Select App ID: `com.super-productivity.app`
5. Download as `mas.provisionprofile`

### 3. Verify the Provisioning Profile

Check which certificate is in the provisioning profile:

```bash
python3 << 'EOF'
import plistlib
import subprocess
import hashlib

result = subprocess.run(['security', 'cms', '-D', '-i', 'tools/mac-profiles/mas.provisionprofile'],
                      capture_output=True)
plist_data = plistlib.loads(result.stdout)

cert_data = plist_data['DeveloperCertificates'][0]
fingerprint = hashlib.sha1(cert_data).hexdigest().upper()

with open('/tmp/cert.der', 'wb') as f:
    f.write(cert_data)

result = subprocess.run(['openssl', 'x509', '-in', '/tmp/cert.der', '-inform', 'DER',
                        '-noout', '-subject'],
                       capture_output=True, text=True)

print("Certificate in provisioning profile:")
print(result.stdout)
print(f"Fingerprint: {fingerprint}")
print(f"\nExpected: 968086560EC4643B4192E7755CBF7D6E009334F4 (Apple Distribution)")
EOF
```

**Expected output:**

```
Certificate in provisioning profile:
subject=UID=363FAFK383, CN=Apple Distribution: Johannes Millan (363FAFK383), ...
Fingerprint: 968086560EC4643B4192E7755CBF7D6E009334F4
```

### 4. Update Local Files

```bash
# Copy provisioning profile to the correct location
cp ~/Downloads/mas.provisionprofile tools/mac-profiles/mas.provisionprofile
```

### 5. Update GitHub Actions Secret

```bash
# Base64 encode the provisioning profile
base64 -i tools/mac-profiles/mas.provisionprofile -o /tmp/mas-profile.b64

# Copy to clipboard
cat /tmp/mas-profile.b64 | pbcopy
```

Then update the GitHub Actions secret:

1. Go to: https://github.com/super-productivity/super-productivity/settings/secrets/actions
2. Find `mas_provision_profile`
3. Click **Update**
4. Paste the base64-encoded content
5. Click **Save**

### 6. Test Locally

```bash
# Copy provisioning profile to root
cp tools/mac-profiles/mas.provisionprofile embedded.provisionprofile

# Build
npm run dist:mac:mas:buildOnly 2>&1 | grep -E "signing.*platform=mas"
```

**Expected output:**

```
• signing file=.tmp/app-builds/mas-universal/Super Productivity.app
  platform=mas type=distribution
  identityName=Apple Distribution: Johannes Millan (363FAFK383)
  identityHash=968086560EC4643B4192E7755CBF7D6E009334F4
  provisioningProfile=embedded.provisionprofile
```

✅ **identityHash should be `968086...`** (Apple Distribution)

### 7. Verify the Built Package

```bash
# Check package signature
pkgutil --check-signature .tmp/app-builds/mas-universal/superProductivity-universal.pkg
```

Should show: `Status: signed by a developer certificate issued by Apple`

## Configuration Files

### build/electron-builder.mas.yaml

```yaml
mas:
  type: distribution # Important: explicitly set type
  appId: com.super-productivity.app
  category: public.app-category.productivity
  icon: build/icon-mac.icns
  gatekeeperAssess: false
  darkModeSupport: true
  hardenedRuntime: false
  entitlements: build/entitlements.mas.plist
  entitlementsInherit: build/entitlements.mas.inherit.plist
  provisioningProfile: embedded.provisionprofile
```

**Do NOT add:**

- ❌ `identity: '...'` - Causes errors and doesn't work
- ❌ `notarize: true` - Only for Developer ID builds, not MAS

### GitHub Actions Workflow

```yaml
- name: Build Electron app
  run: npm run dist:mac:mas:buildOnly
```

**Do NOT add:**

- ❌ `CSC_NAME` environment variable - Causes errors with modern certificates
- ❌ `CSC_FINGERPRINT` environment variable - Ignored by electron-builder

## Troubleshooting

### Error: "Please remove prefix '3rd Party Mac Developer Application:' from the specified name"

**Cause:** You set `CSC_NAME` or `identity` with the full certificate type prefix.

**Solution:** Remove the `CSC_NAME` environment variable or `identity` config field entirely. Let electron-builder auto-discover the certificate.

### Error: "Invalid Code Signing. The executable '...' must be signed with the certificate that is contained in the provisioning profile"

**Cause:** Certificate mismatch between what electron-builder is using and what's in the provisioning profile.

**Diagnosis:**

```bash
# 1. Check which certificate electron-builder is using
npm run dist:mac:mas:buildOnly 2>&1 | grep "signing.*platform=mas"

# 2. Check which certificate is in the provisioning profile
python3 << 'EOF'
import plistlib, subprocess, hashlib
result = subprocess.run(['security', 'cms', '-D', '-i', 'tools/mac-profiles/mas.provisionprofile'], capture_output=True)
plist_data = plistlib.loads(result.stdout)
cert_data = plist_data['DeveloperCertificates'][0]
print(f"Profile certificate fingerprint: {hashlib.sha1(cert_data).hexdigest().upper()}")
EOF

# 3. Compare the fingerprints - they must match!
```

**Solution:** Create a new provisioning profile with the certificate that electron-builder is using (usually Apple Distribution).

### Build Uploads Successfully But Can't Select in App Store Connect

**Common causes:**

1. **Still processing** - Apple takes 5-30 minutes to process builds

   - Wait and refresh the page periodically

2. **Missing export compliance** - Required for apps with encryption

   - Go to App Store Connect → Your App → TestFlight
   - Click on the build, answer the export compliance questions

3. **Version/build number already used**

   - Check `package.json` version matches the built app
   - Increment version if needed: `npm version patch`

4. **Platform mismatch** - Build doesn't match the selected platform
   - Ensure you're selecting from the correct platform tab (macOS)

## Certificate Types Reference

| Apple Portal Name                        | Portal Description             | Internal Name                       | Electron-builder Preference | Use Case            |
| ---------------------------------------- | ------------------------------ | ----------------------------------- | --------------------------- | ------------------- |
| "Johannes Millan (Distribution)"         | "For use in Xcode 11 or later" | Apple Distribution                  | ✅ Preferred                | MAS builds (modern) |
| "Johannes Millan (Mac App Distribution)" | No special description         | 3rd Party Mac Developer Application | ❌ Legacy                   | MAS builds (old)    |
| "Developer ID Application"               | N/A                            | Developer ID Application            | N/A                         | Direct download DMG |

**Key Insight:** In the Apple Developer Portal, look for the certificate that says **"For use in Xcode 11 or later"** - this is the modern "Apple Distribution" certificate that electron-builder will use. The one without this description is the legacy certificate.

## Annual Certificate Renewal

When your certificates expire (annually), follow these steps:

1. **Create new certificates** in Apple Developer Portal

   - Apple Distribution (for MAS)
   - Mac Installer Distribution (for PKG signing)

2. **Create new provisioning profile** with the new certificates

   - Type: Mac App Store Connect
   - Certificate: "Johannes Millan (Distribution)" ← Use the new one

3. **Export all certificates** to PKCS#12

   ```bash
   # Export from Keychain Access or use security command
   security export -k ~/Library/Keychains/login.keychain-db \
     -t identities -f pkcs12 -P "$PASSWORD" \
     -o all-certs.p12
   ```

4. **Update GitHub Actions secrets**

   ```bash
   base64 -i all-certs.p12 -o all-certs.b64
   # Update MAC_CERTS secret with contents of all-certs.b64

   base64 -i tools/mac-profiles/mas.provisionprofile -o mas-profile.b64
   # Update mas_provision_profile secret with contents of mas-profile.b64
   ```

5. **Test locally** before pushing

## Quick Diagnostic Commands

```bash
# Check available certificates
security find-identity -v -p codesigning

# Check what electron-builder will use
npm run dist:mac:mas:buildOnly 2>&1 | grep "signing.*platform=mas"

# Check provisioning profile certificate
security cms -D -i tools/mac-profiles/mas.provisionprofile | \
  plutil -p - | grep -A 5 "DeveloperCertificates"

# Verify built package
pkgutil --check-signature .tmp/app-builds/mas-universal/*.pkg

# Check app version/build
plutil -p ".tmp/app-builds/mas-universal/Super Productivity.app/Contents/Info.plist" | \
  grep -E "CFBundleVersion|CFBundleShortVersionString"
```

## Related Documentation

- [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list)
- [Electron Builder MAS Config](https://www.electron.build/configuration/mas)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- Internal: `docs/update-mac-certificates.md` - Detailed certificate management guide

## Summary

✅ **The key to success:** Ensure your provisioning profile uses the **"Apple Distribution"** certificate (modern "Distribution" type), not the legacy "3rd Party Mac Developer Application" certificate, because electron-builder always prefers Apple Distribution when both are available.

❌ **What doesn't work:** Trying to force electron-builder to use the legacy certificate through environment variables or config options - it will ignore them and use Apple Distribution anyway.
