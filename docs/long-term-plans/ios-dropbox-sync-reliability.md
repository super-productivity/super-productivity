# iOS Dropbox Sync Reliability

**Status:** Investigation complete, fixes pending
**Issue:** [#6333](https://github.com/super-productivity/super-productivity/issues/6333)
**Severity:** High — Dropbox sync is completely broken for some iOS users

## Problem

Dropbox sync consistently fails on iOS with `-1005 "The network connection was lost"`, while the web app works fine on the same device. Multiple users have confirmed the issue across different iOS versions and SP releases.

## Root Cause Analysis (confidence: 60-65%)

### Primary suspect: Capacitor uses `URLSession.shared`

Capacitor's iOS HTTP handler (`CapacitorUrlRequest.swift`) routes all requests through `URLSession.shared` — a singleton that:

- Cannot be invalidated or reconfigured
- Holds persistent HTTP/2 connections that can go stale
- Does not auto-retry POST requests (Dropbox uses POST for all API calls)

When connections go stale (from app backgrounding, server-side connection resets, or HTTP/2 lifecycle), `URLSession.shared` tries to reuse the dead connections, causing -1005.

**Evidence from logs:** First download succeeds, second download 19 seconds later fails with -1005 — classic stale connection reuse pattern.

**Why web works:** Browser `fetch()` runs through WKWebView's own networking stack, which handles reconnection more gracefully.

### Known triggers

1. **App backgrounding** (most common): User goes to Safari to get Dropbox auth code, iOS reclaims sockets while app is suspended ([Apple TN2277](https://developer.apple.com/library/archive/technotes/tn2277/_index.html))
2. **HTTP/2 connection lifecycle**: Server closes connection between requests, `URLSession.shared` reuses it
3. **Retry delays too short**: Current 1s/2s delays don't give the connection pool time to flush

### What we haven't confirmed

- No network-level packet capture during the failure
- Haven't reproduced on a test device
- Haven't verified that ephemeral sessions fix it
- Could be a different/additional cause

## Sources

### Apple official

- [TN2277: Networking and Multitasking](https://developer.apple.com/library/archive/technotes/tn2277/_index.html) — socket reclamation during suspension
- [QA1941: Handling "The network connection was lost"](https://developer.apple.com/library/archive/qa/qa1941/_index.html) — official -1005 guidance

### Apple Developer Forums

- [Thread 777999](https://developer.apple.com/forums/thread/777999): "URLSession.shared fails with -1005... things do work with an ephemeral session"
- [Thread 84656](https://developer.apple.com/forums/thread/84656): Quinn (Apple DTS) recommends retry as primary strategy

### Capacitor issues (same bug)

- [#6733](https://github.com/ionic-team/capacitor/issues/6733): "iOS app switching causes network lost error"
- [#7974](https://github.com/ionic-team/capacitor/issues/7974): Recommends ephemeral session workaround
- [#6789](https://github.com/ionic-team/capacitor/issues/6789): `[NSURLSession sharedSession] may not be invalidated`

### Other frameworks

- [Alamofire #872](https://github.com/Alamofire/Alamofire/issues/872): Same -1005 after device lock — fix was recreating sessions
- [AWS SDK iOS #4281](https://github.com/aws-amplify/aws-sdk-ios/issues/4281): Same -1005 with S3 uploads

### Dropbox-specific

- [SwiftyDropbox SDK](https://github.com/dropbox/SwiftyDropbox) uses custom URLSession instances, never `URLSession.shared`
- [Dropbox Forum](https://www.dropboxforum.com/discussions/101000014/nsurlerrordomaincode-1005-with-authorizedclient-in-ios-app/646904): Same error reported with official SDK

## Proposed Fixes

### Fix 1: Patch Capacitor to use ephemeral sessions (highest impact)

Use `patch-package` to modify `CapacitorUrlRequest.swift`:

```swift
// Before (Capacitor 7.4.3+)
open func getUrlSession(_ call: CAPPluginCall) -> URLSession {
    let disableRedirects = call.getBool("disableRedirects") ?? false
    if !disableRedirects {
        return URLSession.shared
    }
    return URLSession(configuration: URLSessionConfiguration.default, delegate: self, delegateQueue: nil)
}

// After
open func getUrlSession(_ call: CAPPluginCall) -> URLSession {
    let disableRedirects = call.getBool("disableRedirects") ?? false
    let config = URLSessionConfiguration.ephemeral
    if !disableRedirects {
        return URLSession(configuration: config)
    }
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
}
```

**Tradeoffs:**

- Cookies won't persist between sessions (not relevant for Dropbox — we manage tokens ourselves)
- Must re-apply patch on Capacitor upgrades
- Recommended by Capacitor community for [#7974](https://github.com/ionic-team/capacitor/issues/7974)

**Note:** Capacitor 8 does NOT fix this — `URLSession.shared` usage is identical in v8.

### Fix 2: Fix timeout bug (quick win)

Capacitor's Swift code: `let timeout = (connectTimeout ?? readTimeout ?? 600000.0) / 1000.0`

Our code passes both `connectTimeout: 30000` and `readTimeout: 120000`. Since `connectTimeout` is set, `readTimeout` is silently ignored. All data transfers get a 30s timeout instead of the intended 120s.

**Fix:** Stop passing `connectTimeout` from `native-http-retry.ts`, or pass a single combined timeout.

### Fix 3: Increase retry delays (quick win)

Current delays: 1s, 2s. Stale connections need more time to flush.

**Fix:** Increase to 3s, 6s (or similar). Consider whether `MAX_RETRIES` should also increase.

### Fix 4: Add foreground-resume delay (medium effort)

Use Capacitor's `App.addListener('appStateChange')` to detect foreground resume and add a brief delay (500ms-1s) before allowing sync requests.

### Fix 5: Background task assertion (medium effort, iOS-specific)

Use `@capawesome/capacitor-background-task` to request ~30s of background execution time during sync, preventing iOS from suspending the app mid-operation.

## Implementation Order

1. **Fixes 2 + 3** — Quick wins, low risk, can ship immediately
2. **Fix 1** — Highest impact but requires `patch-package` setup for iOS native code
3. **Fix 4** — Good defense-in-depth
4. **Fix 5** — Nice-to-have, prevents a different failure mode (suspension during active sync)

## Validation

- [ ] Reproduce the issue on a physical iOS device
- [ ] Apply fixes and verify sync works after app backgrounding
- [ ] Test the full Dropbox setup flow (Safari auth → paste code → sync)
- [ ] Verify no regressions on Android or web
- [ ] Ask issue reporters to test a beta build
