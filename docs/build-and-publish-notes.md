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
