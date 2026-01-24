# Publish notes

Look for AppDataForScreenshots.json

## Mac Store Screenshots

- Set Resolution: 1280\*800 (use detached dev tools to check for size)
- Press Cmd+Shift+4
- Press Space
- Hold down Alt key and Click on window
- Scan results and remove all references to "demo," "trial," "beta," or "test" in your app description, app icon, screenshots, previews, release notes, and binary.

## Android Screenshots

- Open web version
- Adjust to desired size
- Press Ctrl + Shift + P
- Enter screenshot

## iOS App Store

### GitHub Actions Workflow

The iOS build is automated via `.github/workflows/build-ios.yml`. It triggers on:

- Release publish (including pre-releases during testing)
- Manual workflow dispatch

### Required GitHub Secrets

| Secret                        | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| `mac_certs`                   | Apple Distribution certificate (.p12, base64) - shared with Mac builds |
| `mac_certs_password`          | Certificate password - shared with Mac builds                          |
| `IOS_PROVISION_PROFILE`       | iOS App Store provisioning profile (base64)                            |
| `APPLE_ID`                    | Apple ID for App Store Connect                                         |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password                                                  |
| `APPLE_TEAM_ID`               | Apple Developer Team ID                                                |

### Creating the Provisioning Profile

1. Go to [Apple Developer Portal → Profiles](https://developer.apple.com/account/resources/profiles/list)
2. Click **+** → **App Store Connect** (under Distribution)
3. Select App ID: `com.super-productivity.app`
4. Select your **Apple Distribution** certificate
5. Download the `.mobileprovision` file
6. Base64 encode: `base64 -i profile.mobileprovision | pbcopy`
7. Add to GitHub Secrets as `IOS_PROVISION_PROFILE`

### iOS Screenshots

Required sizes (minimum 6.9" needed, others optional):
| Device | Size (pixels) |
|--------|---------------|
| 6.9" iPhone (Pro Max) | 1320 x 2868 |
| 6.5" iPhone (11 Pro Max) | 1284 x 2778 |
| 5.5" iPhone (8 Plus) | 1242 x 2208 |
| 12.9" iPad Pro | 2048 x 2732 |

To capture:

- Run app in iOS Simulator at desired device size
- Press Cmd+S to save screenshot
- Optionally add device frames using tools like [AppMockUp](https://app-mockup.com)

### App Store Connect Setup

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → My Apps → **+** → New App
2. Select **iOS** platform
3. Bundle ID: `com.super-productivity.app`
4. Fill in app name, SKU, etc.
5. Builds uploaded via workflow appear under **TestFlight** tab

## Windows Code Signing

### GitHub Actions Workflow

Windows executables (NSIS installers and portable .exe files) are automatically signed using SignPath during the build process in `.github/workflows/build.yml` (windows-bin job). Signing only occurs for release builds (tags starting with 'v').

### Required GitHub Secrets

| Secret                     | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `SIGNPATH_API_TOKEN`       | SignPath API token with signing permissions                                     |
| `SIGNPATH_ORGANIZATION_ID` | Your SignPath organization ID (found in dashboard URL or organization settings) |
| `SIGNPATH_PROJECT_SLUG`    | Your SignPath project slug (e.g., "super-productivity")                         |

### Required Workflow Configuration Updates

In `.github/workflows/build.yml` (windows-bin job), update these placeholder values with your actual SignPath configuration:

```yaml
signing-policy-slug: 'release-signing' # TODO: Replace with your actual SignPath policy slug
artifact-configuration-slug: 'windows-exe' # TODO: Replace with your actual SignPath artifact configuration slug
```

### SignPath Setup (One-Time Configuration)

#### 1. Create/Verify Project in SignPath

1. Log in to [SignPath.io](https://app.signpath.io)
2. Create a new project or use an existing one
3. Note the **project slug** (visible in the project URL)
4. Upload your code signing certificate to the project

#### 2. Create Signing Policy

1. In your SignPath project, go to **Signing Policies**
2. Click **Add Signing Policy**
3. Configure:
   - **Name**: `release-signing` (or your preference)
   - **Certificate**: Select your uploaded code signing certificate
   - **Approval**: Configure based on your needs:
     - Automatic approval for production releases (recommended)
     - Manual approval for testing (optional)
4. Note the **signing policy slug**

#### 3. Create Artifact Configuration

1. In your SignPath project, go to **Artifact Configurations**
2. Click **Add Artifact Configuration**
3. Configure:
   - **Name**: `windows-exe` (or your preference)
   - **Artifact Type**: Portable Executable (PE)
   - **Deep Signing**: Enable (recommended for installers with nested executables)
4. Note the **artifact configuration slug**

#### 4. Generate API Token

1. In SignPath, go to **Organization Settings** → **API Tokens**
2. Click **Create Token**
3. Configure:
   - **Name**: "GitHub Actions CI/CD"
   - **Permissions**: Enable "Submit signing requests"
4. **Copy the token immediately** - you won't see it again
5. Add to GitHub Secrets as `SIGNPATH_API_TOKEN`

#### 5. Add GitHub Secrets

In your GitHub repository (Settings → Secrets and variables → Actions), add:

1. **SIGNPATH_API_TOKEN**: The API token from step 4
2. **SIGNPATH_ORGANIZATION_ID**: Found in SignPath dashboard URL or organization settings
3. **SIGNPATH_PROJECT_SLUG**: The project slug from step 1

#### 6. Update Workflow Configuration

In `.github/workflows/build.yml`, update the placeholder values:

1. Replace `'release-signing'` with your actual signing policy slug from step 2
2. Replace `'windows-exe'` with your actual artifact configuration slug from step 3

### Verifying Signed Executables

After a release build completes:

1. **Download** the executable from GitHub Releases
2. **Verify signature** on Windows using PowerShell:

```powershell
Get-AuthenticodeSignature ".\Super Productivity Setup-x64.exe" | Format-List
```

3. **Check output** shows:
   - `Status`: "Valid"
   - `SignerCertificate`: Your certificate details
   - `TimeStamperCertificate`: Timestamp authority

4. **Test installation**: Windows should show your publisher name and not display SmartScreen warnings (after certificate gains reputation)

### Troubleshooting

- **Signing timeout**: Default timeout is 600 seconds (10 minutes). Increase if needed in workflow YAML
- **Invalid certificate**: Verify certificate is uploaded to SignPath and policy is configured correctly
- **API token expired**: Generate a new token in SignPath organization settings
- **Build fails during signing**: Check SignPath dashboard for signing request status and any error messages
