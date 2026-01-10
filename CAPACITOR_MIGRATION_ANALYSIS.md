# Capacitor.js Plugin Migration Analysis

## Executive Summary

This document analyzes the feasibility and complexity of migrating all Android-native code in Super Productivity to Capacitor.js plugins. The current implementation consists of **~2,337 lines of Kotlin** across multiple native Android components.

**Migration Complexity: MEDIUM-HIGH** ⚠️

While technically feasible, the migration presents moderate challenges due to custom foreground services, complex notification interactions, and widget implementation. However, significant benefits include simplified maintenance, improved cross-platform consistency, and reduced platform-specific bugs.

---

## Current State Analysis

### 1. Existing Capacitor Usage

Super Productivity already uses Capacitor with the following official plugins:

| Plugin | Current Usage | Location |
|--------|---------------|----------|
| `@capacitor/core` | v7.4.3 | Core framework |
| `@capacitor/android` | v7.4.4 | Android platform |
| `@capacitor/app` | v7.1.0 | App lifecycle events |
| `@capacitor/filesystem` | v7.1.1 | File operations |
| `@capacitor/local-notifications` | v7.0.1 | Basic notifications |
| `@capacitor/share` | v7.0.2 | Share functionality |
| `@capawesome/capacitor-background-task` | v7.0.1 | Background task handling |
| `@capawesome/capacitor-android-dark-mode-support` | v7.0.0 | Dark mode |

**Key Finding**: The app is already heavily invested in Capacitor infrastructure. The migration would consolidate native code rather than introduce a new paradigm.

---

## 2. Current Native Android Components

### Component Inventory

| Component | Lines of Code | Complexity | Purpose |
|-----------|--------------|------------|---------|
| **TrackingForegroundService** | ~300 | High | Persistent time tracking notification |
| **FocusModeForegroundService** | ~250 | High | Focus mode timer notification |
| **SafBridgePlugin** | ~200 | Medium | Scoped storage file access |
| **WebDavHttpPlugin** | ~200 | Medium | HTTP/WebDAV client |
| **JavaScriptInterface** | ~300 | Medium | JS↔Native bridge (22 methods) |
| **ReminderAlarmReceiver** | ~100 | Low | Alarm broadcasts |
| **ReminderActionReceiver** | ~50 | Low | Snooze actions |
| **QuickAddWidgetProvider** | ~150 | Medium | Home screen widget |
| **KeyValStore** | ~100 | Low | SQLite key-value storage |
| **CapacitorMainActivity** | ~400 | High | Main activity + intent handling |
| **FullscreenActivity** | ~200 | Medium | Legacy online-mode activity |
| **Notification Helpers** | ~300 | Medium | Notification creation/management |
| **Build/Config Files** | ~200 | Low | Gradle, manifest, resources |

**Total: ~2,337 lines** across 15+ files

---

## 3. Migration Pathways

### A. Can Use Official Capacitor Plugins (Low Complexity)

| Current Component | Replacement Plugin | Migration Effort | Notes |
|-------------------|-------------------|------------------|-------|
| **LocalNotifications** (partial) | `@capacitor/local-notifications` | ✅ Already using | Extend for advanced features |
| **Share Intent** | `@capacitor/share` | ✅ Already using | May need receiving intent support |
| **App Lifecycle** | `@capacitor/app` | ✅ Already using | Already handles resume/pause |
| **File Access** (basic) | `@capacitor/filesystem` | ✅ Already using | May need scoped storage extensions |

**Effort: 2-5 hours** - Already implemented, may need minor enhancements.

---

### B. Community Plugins Available (Medium Complexity)

| Current Component | Community Plugin | Status | Migration Effort |
|-------------------|------------------|--------|------------------|
| **Background Tasks** | `@capawesome/capacitor-background-task` | ✅ Installed | Already using |
| **File Picker** | `@capawesome-team/capacitor-file-picker` | Available | 4-8 hours |
| **Keep Screen On** | `capacitor-keep-screen-on` | Available | 1-2 hours |
| **Foreground Service** | `@capawesome-team/capacitor-android-foreground-service` | **Available** ⭐ | 15-25 hours |
| **Local Storage** | IndexedDB via web APIs | Built-in | 2-4 hours |

**Effort: 22-39 hours** - Install and configure existing plugins.

---

### C. Requires Custom Plugin Development (High Complexity)

These components have **no direct Capacitor equivalent** and require custom plugin development:

#### 1. **Foreground Services with Interactive Notifications** 🔴

**Current Implementation:**
- `TrackingForegroundService.kt` (~300 lines)
- `FocusModeForegroundService.kt` (~250 lines)
- Real-time notification updates (1-second intervals)
- Action buttons with intent callbacks to main activity
- Static state tracking (`currentTaskId`, `isTracking`, `elapsedMs`)
- Survives app termination via `onTaskRemoved()`

**Custom Plugin Requirements:**
```typescript
// Proposed: @super-productivity/capacitor-foreground-tracking
interface ForegroundTrackingPlugin {
  start(options: {
    taskId: string;
    taskTitle: string;
    initialTimeMs: number;
  }): Promise<void>;

  update(options: { timeSpentMs: number }): Promise<void>;

  stop(): Promise<void>;

  getElapsed(): Promise<{ taskId: string; elapsedMs: number }>;

  addListener(
    eventName: 'onPause' | 'onDone',
    listener: () => void
  ): Promise<PluginListenerHandle>;
}

// Proposed: @super-productivity/capacitor-focus-mode
interface FocusModePlugin {
  start(options: {
    title: string;
    durationMs: number;  // 0 = flowtime mode
    remainingMs: number;
    isBreak: boolean;
    isPaused: boolean;
    taskTitle?: string;
  }): Promise<void>;

  update(options: {...}): Promise<void>;

  addListener(
    eventName: 'onPause' | 'onResume' | 'onSkip' | 'onComplete',
    listener: () => void
  ): Promise<PluginListenerHandle>;
}
```

**Development Effort:**
- Plugin setup + TypeScript definitions: 4 hours
- Android foreground service implementation: 15-20 hours
- Notification UI + action handling: 8-12 hours
- Event listener plumbing: 4-6 hours
- Testing + edge cases: 8-10 hours

**Total: 39-52 hours** (5-6.5 days)

**Complexity Factors:**
- ⚠️ Foreground service lifecycle management
- ⚠️ Notification action intents → event dispatching
- ⚠️ State persistence across app restarts
- ⚠️ Android 12+ foreground service restrictions
- ⚠️ Real-time timer updates without draining battery

---

#### 2. **Native Reminder Scheduling with AlarmManager** 🔴

**Current Implementation:**
- `ReminderAlarmReceiver.kt` + `ReminderActionReceiver.kt` (~150 lines)
- Uses `AlarmManager.setExactAndAllowWhileIdle()` for precise scheduling
- Snooze functionality without opening app
- Persists across reboots
- High-priority notifications with sound/vibration

**Custom Plugin Requirements:**
```typescript
// Proposed: @super-productivity/capacitor-exact-alarms
interface ExactAlarmsPlugin {
  schedule(options: {
    id: number;
    reminderId: string;
    relatedId: string;
    title: string;
    type: string;
    triggerAtMs: number;
  }): Promise<void>;

  cancel(options: { id: number }): Promise<void>;

  checkPermissions(): Promise<{ exactAlarm: 'granted' | 'denied' }>;

  requestPermissions(): Promise<void>;

  addListener(
    eventName: 'onSnooze' | 'onDismiss',
    listener: (data: { reminderId: string }) => void
  ): Promise<PluginListenerHandle>;
}
```

**Development Effort:**
- Plugin setup: 3 hours
- AlarmManager integration: 6-8 hours
- BroadcastReceiver + intent handling: 4-6 hours
- Permission handling (Android 12+): 3-4 hours
- Notification with actions: 5-7 hours
- Boot persistence: 2-3 hours
- Testing: 6-8 hours

**Total: 29-39 hours** (3.5-5 days)

**Complexity Factors:**
- ⚠️ Android 12+ exact alarm permissions (`SCHEDULE_EXACT_ALARM`)
- ⚠️ BroadcastReceivers operating independently of app lifecycle
- ⚠️ Notification actions triggering without app context
- ⚠️ Boot completed receiver for alarm restoration

**Alternative**: Could potentially extend `@capacitor/local-notifications` with a fork, but this adds maintenance burden.

---

#### 3. **Home Screen Widget** 🔴

**Current Implementation:**
- `QuickAddWidgetProvider.kt` + `QuickAddActivity.kt` (~150 lines)
- Widget opens dialog activity for quick task entry
- `WidgetTaskQueue` stores tasks in memory until app reads them
- Frontend polls via `getWidgetTaskQueue()` to retrieve queued tasks

**Custom Plugin Requirements:**
```typescript
// Proposed: @super-productivity/capacitor-widget
interface WidgetPlugin {
  getQueuedTasks(): Promise<{ tasks: Array<{ title: string }> }>;

  clearQueue(): Promise<void>;

  // Widget configuration is handled via XML + native code
}
```

**Development Effort:**
- Plugin setup: 2 hours
- Widget provider + layout: 8-10 hours
- Queue management + persistence: 4-6 hours
- Activity dialog integration: 6-8 hours
- Testing across launchers: 6-8 hours

**Total: 26-34 hours** (3-4 days)

**Complexity Factors:**
- ⚠️ Widgets are Android-specific (no iOS equivalent)
- ⚠️ Launcher compatibility issues (Samsung, Pixel, etc.)
- ⚠️ Limited UI customization in AppWidget framework
- ⚠️ Widget updates require PendingIntent → Activity → Queue pattern

**Note**: Widgets have limited value on iOS, so this is Android-only work. Consider deprecating if cross-platform parity is a priority.

---

#### 4. **Scoped Storage Access (SAF Bridge)** 🟡

**Current Implementation:**
- `SafBridgePlugin.kt` (~200 lines)
- Uses Android Storage Access Framework (SAF) for scoped storage
- Persistent URI permissions for folder access
- Methods: `selectFolder`, `readFile`, `writeFile`, `deleteFile`, `checkFileExists`

**Custom Plugin Requirements:**
```typescript
// Proposed: @super-productivity/capacitor-saf
interface SafPlugin {
  selectFolder(): Promise<{ uri: string }>;

  readFile(options: { folderUri: string; fileName: string }): Promise<{ data: string }>;

  writeFile(options: { folderUri: string; fileName: string; data: string }): Promise<void>;

  deleteFile(options: { folderUri: string; fileName: string }): Promise<void>;

  checkFileExists(options: { folderUri: string; fileName: string }): Promise<{ exists: boolean }>;

  checkUriPermission(options: { uri: string }): Promise<{ granted: boolean }>;
}
```

**Development Effort:**
- Plugin setup: 2 hours
- SAF DocumentFile integration: 6-8 hours
- URI permission management: 4-6 hours
- File operations implementation: 6-8 hours
- Error handling + edge cases: 4-6 hours
- Testing: 4-6 hours

**Total: 26-36 hours** (3-4.5 days)

**Complexity Factors:**
- ⚠️ Android 10+ scoped storage restrictions
- ⚠️ Persistent URI permissions require careful handling
- ⚠️ DocumentFile API is verbose and error-prone
- ⚠️ Cross-device compatibility (Samsung, OnePlus, etc.)

**Alternative**: Check if `@capawesome-team/capacitor-file-picker` + `@capacitor/filesystem` can handle this use case. If not, custom plugin is required.

---

#### 5. **WebDAV HTTP Client** 🟡

**Current Implementation:**
- `WebDavHttpPlugin.kt` (~200 lines)
- OkHttp-based HTTP client with WebDAV method support
- Methods: GET, POST, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE, etc.
- Retry logic (max 2 retries)
- 30-second timeouts
- Returns: `{ data, status, headers, url }`

**Custom Plugin Requirements:**
```typescript
// Proposed: @super-productivity/capacitor-webdav
interface WebDavPlugin {
  request(options: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'COPY' | 'MOVE' | ...;
    headers?: Record<string, string>;
    data?: string;
  }): Promise<{
    data: string;
    status: number;
    headers: Record<string, string>;
    url: string;
  }>;
}
```

**Development Effort:**
- Plugin setup: 2 hours
- OkHttp integration: 4-6 hours
- WebDAV method support: 6-8 hours
- Retry logic + error handling: 3-4 hours
- Testing with real WebDAV servers: 6-8 hours

**Total: 21-28 hours** (2.5-3.5 days)

**Complexity Factors:**
- ⚠️ WebDAV method support (PROPFIND, MKCOL, etc.)
- ⚠️ Custom headers + authentication
- ⚠️ SSL/TLS certificate handling
- ⚠️ Redirect following

**Alternative**: The existing `@capacitor/http` plugin **may already support this**. Check if `CapacitorHttp.request()` supports custom HTTP methods. If yes, migration effort drops to **2-4 hours**.

**Action Item**: Test `@capacitor/http` with PROPFIND requests before building custom plugin.

---

#### 6. **JavaScript Bridge Interface** 🟡

**Current Implementation:**
- `JavaScriptInterface.kt` (~300 lines)
- Exposes 22 methods to WebView via `window.SUPAndroid` or `window.SUPFDroid`
- Methods include database ops, tracking, focus mode, reminders, widget queue
- Async callback pattern using `requestId` + `window.handleResponse()`

**Migration Strategy:**
This is **not a separate plugin** but rather the **aggregation of all other plugins**. Once individual plugins are created, the JavaScript bridge is automatically handled by Capacitor's plugin system.

**Current Methods → Plugin Mapping:**

| Current Method | Maps To Plugin |
|----------------|----------------|
| `saveToDb`, `loadFromDb`, `removeFromDb` | Web Storage API or `@capacitor/preferences` |
| `startTrackingService`, `updateTrackingService`, `stopTrackingService`, `getTrackingElapsed` | `@super-productivity/capacitor-foreground-tracking` |
| `startFocusModeService`, `updateFocusModeService`, `stopFocusModeService` | `@super-productivity/capacitor-focus-mode` |
| `scheduleNativeReminder`, `cancelNativeReminder` | `@super-productivity/capacitor-exact-alarms` |
| `getWidgetTaskQueue` | `@super-productivity/capacitor-widget` |
| `triggerGetShareData` | `@capacitor/share` (with receive intent extension) |

**Development Effort:**
- Migrate frontend to use Capacitor plugin APIs: 15-20 hours
- Remove legacy `androidInterface` abstraction: 4-6 hours
- Update tests: 6-8 hours

**Total: 25-34 hours** (3-4 days)

---

### D. Components to Remove/Simplify (Low Complexity)

| Component | Action | Effort |
|-----------|--------|--------|
| **KeyValStore (SQLite)** | Replace with `@capacitor/preferences` or IndexedDB | 3-5 hours |
| **FullscreenActivity** | Remove legacy online-mode activity | 2-3 hours |
| **LaunchDecider** | Simplify to single Capacitor activity | 1-2 hours |
| **AppLifecycleObserver** | Use `@capacitor/app` events | 2-4 hours |

**Total: 8-14 hours**

---

## 4. Migration Effort Summary

### Total Effort Breakdown

| Category | Components | Effort (Hours) | Complexity |
|----------|-----------|----------------|------------|
| **Already Using Capacitor** | LocalNotifications, Share, App, Filesystem | 2-5 | ✅ Low |
| **Use Community Plugins** | Foreground Service, File Picker | 22-39 | 🟡 Medium |
| **Custom Plugins (High Priority)** | Foreground Tracking, Focus Mode, Exact Alarms | 94-127 | 🔴 High |
| **Custom Plugins (Medium Priority)** | SAF Bridge, WebDAV HTTP | 47-64 | 🟡 Medium |
| **Custom Plugins (Low Priority)** | Widget | 26-34 | 🟡 Medium |
| **Frontend Migration** | Update TypeScript integration | 25-34 | 🟡 Medium |
| **Cleanup & Removal** | Remove legacy code | 8-14 | ✅ Low |
| **Testing & Documentation** | E2E tests, docs, bug fixes | 30-50 | 🟡 Medium |

### **Grand Total: 254-367 hours** (31.5-46 days of work)

---

## 5. Risk Assessment

### High-Risk Areas

1. **Foreground Service Reliability** 🔴
   - Risk: Android 12+ introduced strict foreground service restrictions
   - Mitigation: Use `@capawesome-team/capacitor-android-foreground-service` as base, test extensively on Android 12+

2. **AlarmManager Exact Alarm Permissions** 🔴
   - Risk: Android 13+ requires user approval for exact alarms
   - Mitigation: Graceful degradation to inexact alarms, clear permission prompts

3. **Widget Compatibility** 🟡
   - Risk: Different launcher behaviors (Pixel, Samsung, OnePlus)
   - Mitigation: Test on multiple devices, consider deprecating if low usage

4. **SAF URI Permission Persistence** 🟡
   - Risk: Permissions can be revoked by system or user
   - Mitigation: Check permissions on each access, prompt for re-grant

5. **Plugin Maintenance Burden** 🟡
   - Risk: Custom plugins require ongoing maintenance for Android OS updates
   - Mitigation: Publish plugins as open-source, community support

### Low-Risk Areas

- Notification basics (already using Capacitor)
- File access (well-supported by Capacitor)
- App lifecycle events (handled by `@capacitor/app`)

---

## 6. Benefits of Migration

### Technical Benefits

1. **Unified Codebase** ✅
   - Single plugin API for Android + iOS (future-proofing)
   - Reduced platform-specific bugs
   - Easier onboarding for contributors

2. **Better TypeScript Integration** ✅
   - Strongly-typed plugin interfaces
   - IDE autocomplete for all native methods
   - Compile-time error checking

3. **Improved Testing** ✅
   - Mock plugins in unit tests
   - Consistent testing patterns across platforms
   - Better E2E test coverage

4. **Community Leverage** ✅
   - Use community plugins where possible
   - Share custom plugins with other projects
   - Get contributions for bug fixes

5. **Simplified Build Process** ✅
   - Capacitor CLI handles sync (`npx cap sync`)
   - Less Gradle configuration
   - Easier CI/CD setup

### Maintenance Benefits

1. **Reduced Technical Debt** 📉
   - Remove legacy `FullscreenActivity` and `JavaScriptInterface`
   - Consolidate dual-mode architecture
   - Cleaner separation of concerns

2. **Easier Debugging** 🐛
   - Capacitor DevTools for plugin inspection
   - Standardized logging
   - Better error messages

3. **Future Android Updates** 🔄
   - Capacitor team handles OS compatibility
   - Community plugins get updates
   - Less manual patching for OS changes

---

## 7. Drawbacks of Migration

### Development Costs

1. **Significant Upfront Investment** ⏱️
   - 254-367 hours of development (1.5-2 months)
   - Potential for bugs during transition
   - Requires thorough testing

2. **Learning Curve** 📚
   - Team must learn Capacitor plugin development
   - New debugging workflows
   - Different architecture patterns

3. **Plugin Maintenance** 🔧
   - Custom plugins require ongoing support
   - Must keep up with Capacitor updates
   - Potential for breaking changes

### Technical Limitations

1. **Capacitor Overhead** ⚠️
   - Slight performance overhead vs direct native code
   - Additional layer of abstraction
   - Larger app bundle size (minimal, ~100-200 KB)

2. **Widget Support** ⚠️
   - Widgets are Android-specific (no iOS equivalent)
   - Plugin ecosystem has limited widget support
   - May require significant custom work

3. **Foreground Service Constraints** ⚠️
   - Capacitor plugins must conform to framework patterns
   - Less flexibility than pure native code
   - May hit Capacitor framework limitations

---

## 8. Recommended Migration Strategy

### Phase 1: Low-Hanging Fruit (1-2 weeks)

**Goal**: Replace components already supported by Capacitor

- ✅ Migrate `KeyValStore` to `@capacitor/preferences`
- ✅ Remove `FullscreenActivity` and `LaunchDecider`
- ✅ Replace `AppLifecycleObserver` with `@capacitor/app`
- ✅ Test WebDAV with `@capacitor/http` (if supported, avoid custom plugin)

**Effort**: 15-25 hours

**Risk**: Low

---

### Phase 2: Community Plugins (2-3 weeks)

**Goal**: Leverage existing Capacitor ecosystem

- ⚙️ Evaluate `@capawesome-team/capacitor-android-foreground-service`
- ⚙️ Install `@capawesome-team/capacitor-file-picker` (if SAF not needed)
- ⚙️ Test foreground service plugin with tracking use case
- ⚙️ Update frontend to use community plugin APIs

**Effort**: 30-50 hours

**Risk**: Medium (plugin compatibility)

---

### Phase 3: Critical Custom Plugins (4-6 weeks)

**Goal**: Build essential plugins that have no alternatives

- 🔨 Build `@super-productivity/capacitor-foreground-tracking`
- 🔨 Build `@super-productivity/capacitor-focus-mode`
- 🔨 Build `@super-productivity/capacitor-exact-alarms`
- 🧪 Extensive testing on Android 10-15
- 📱 Beta testing with users

**Effort**: 120-180 hours

**Risk**: High (core functionality)

---

### Phase 4: Nice-to-Have Plugins (2-3 weeks)

**Goal**: Complete the migration with lower-priority features

- 🔨 Build `@super-productivity/capacitor-saf` (if needed)
- 🔨 Build `@super-productivity/capacitor-widget` (or deprecate)
- 🧹 Remove all legacy Android code
- 📚 Document plugin APIs

**Effort**: 60-90 hours

**Risk**: Low-Medium

---

### Phase 5: Testing & Stabilization (2-3 weeks)

**Goal**: Ensure production-ready quality

- 🧪 E2E test coverage for all plugins
- 🐛 Bug fixes from beta testing
- 📊 Performance benchmarking
- 📖 Update developer documentation
- 🚀 Gradual rollout (alpha → beta → stable)

**Effort**: 40-60 hours

**Risk**: Medium (edge cases)

---

## 9. Alternative: Hybrid Approach

If full migration is too risky, consider a **hybrid approach**:

### Keep Native for Complex Features
- ✅ Keep `TrackingForegroundService` and `FocusModeForegroundService` as-is
- ✅ Keep `ReminderAlarmReceiver` for exact alarms
- ✅ Keep `QuickAddWidgetProvider` for widget

### Migrate Simple Components to Capacitor
- ✅ Use `@capacitor/preferences` for storage
- ✅ Use `@capacitor/app` for lifecycle
- ✅ Use `@capacitor/share` for share intent
- ✅ Use `@capacitor/filesystem` for basic file ops

### Create Thin Plugin Wrappers
Instead of rewriting services, create **thin Capacitor plugin wrappers** around existing native code:

```kotlin
// Example: Wrap existing TrackingForegroundService
@CapacitorPlugin(name = "ForegroundTracking")
class ForegroundTrackingPlugin : Plugin() {
  @PluginMethod
  fun start(call: PluginCall) {
    val taskId = call.getString("taskId")
    // Delegate to existing TrackingForegroundService
    TrackingForegroundService.start(context, taskId, ...)
    call.resolve()
  }
}
```

**Benefits:**
- ⏱️ Faster migration (30-50 hours vs 254-367 hours)
- 🔒 Lower risk (proven native code remains)
- 📦 Still get TypeScript API benefits

**Drawbacks:**
- 🧹 Doesn't reduce technical debt
- 🔧 Still requires maintaining native code
- 🌍 Doesn't improve cross-platform parity

---

## 10. Decision Matrix

| Factor | Full Migration | Hybrid Approach | Keep Native |
|--------|----------------|-----------------|-------------|
| **Development Time** | 254-367 hours | 30-50 hours | 0 hours |
| **Risk** | High | Medium | Low |
| **Technical Debt** | ✅ Eliminated | 🟡 Reduced | ❌ Unchanged |
| **Cross-Platform** | ✅ iOS-ready | 🟡 Partial | ❌ Android-only |
| **Maintenance** | ✅ Easier | 🟡 Same | ❌ Complex |
| **Performance** | 🟡 Slight overhead | ✅ Native speed | ✅ Native speed |
| **Plugin Reuse** | ✅ Can share | 🟡 Limited | ❌ None |
| **TypeScript API** | ✅ Full coverage | ✅ Full coverage | ❌ Manual bindings |

---

## 11. Final Recommendation

### Recommended Approach: **Phased Full Migration**

**Rationale:**
1. ✅ Project already uses Capacitor extensively (7 plugins installed)
2. ✅ Cross-platform expansion (iOS) is likely a future goal
3. ✅ Community plugins exist for most difficult components (foreground services)
4. ✅ Custom plugins can be open-sourced for community benefit
5. ✅ TypeScript-first API improves developer experience
6. ⏱️ 1.5-2 months is acceptable for long-term benefits

### Critical Success Factors

1. **Start with Phase 1-2** (low-risk, high-value wins)
2. **Thorough testing** of `@capawesome-team/capacitor-android-foreground-service` before building custom
3. **Gradual rollout** via beta channel to catch issues early
4. **Fallback plan** to hybrid approach if blockers emerge
5. **Community engagement** if building custom plugins (potential for shared maintenance)

### When to Avoid Full Migration

❌ Avoid if:
- Team has <2 months for this effort
- No plans for iOS version
- Current native code is stable and bug-free
- No developer resources for Capacitor plugin maintenance

In these cases, use **Hybrid Approach** instead.

---

## 12. Next Steps

If proceeding with full migration:

1. ✅ **Validate WebDAV support** in `@capacitor/http` (2 hours)
2. ✅ **Test `@capawesome-team/capacitor-android-foreground-service`** with tracking use case (8 hours)
3. ✅ **Prototype one custom plugin** (e.g., exact alarms) to validate effort estimates (20 hours)
4. ✅ **Create detailed migration plan** with milestones and rollback strategy (4 hours)
5. ✅ **Set up beta testing infrastructure** (F-Droid beta channel, internal testers) (4 hours)

**Total Validation Effort: 38 hours** (1 week)

---

## Appendix A: Plugin Development Template

For custom plugins, use this structure:

```
@super-productivity/capacitor-plugin-name/
├── src/
│   ├── definitions.ts          # TypeScript interface
│   ├── index.ts                # Web implementation (optional)
│   └── web.ts                  # Web fallback
├── android/
│   └── src/main/java/com/superproductivity/plugins/
│       └── PluginNamePlugin.kt # Android implementation
├── ios/ (future)
│   └── Plugin/
│       └── PluginNamePlugin.swift
├── package.json
└── README.md
```

**Capacitor Plugin Template:**
```bash
npm init @capacitor/plugin@latest
```

---

## Appendix B: Estimated Cost Breakdown

Assuming **$100/hour** contractor rate:

| Phase | Hours | Cost |
|-------|-------|------|
| Phase 1: Low-Hanging Fruit | 15-25 | $1,500-$2,500 |
| Phase 2: Community Plugins | 30-50 | $3,000-$5,000 |
| Phase 3: Critical Custom Plugins | 120-180 | $12,000-$18,000 |
| Phase 4: Nice-to-Have Plugins | 60-90 | $6,000-$9,000 |
| Phase 5: Testing & Stabilization | 40-60 | $4,000-$6,000 |
| **Total** | **254-367** | **$25,400-$36,700** |

**Hybrid Approach Cost:** $3,000-$5,000

**ROI Timeline:** 12-18 months (reduced maintenance costs, faster feature development)

---

## Appendix C: Community Plugin Evaluation

### @capawesome-team/capacitor-android-foreground-service

**GitHub:** https://github.com/capawesome-team/capacitor-android-foreground-service

**Features:**
- ✅ Foreground service lifecycle management
- ✅ Custom notification support
- ✅ Notification action handling
- ✅ Android 12+ compliance

**Limitations:**
- ❓ Timer updates (need to verify 1-second update support)
- ❓ Static state tracking (may need workaround)
- ❓ Action intent → event listener plumbing

**Action:** Test with proof-of-concept implementation (8 hours)

---

## Appendix D: Migration Checklist

- [ ] Validate WebDAV support in `@capacitor/http`
- [ ] Test `@capawesome-team/capacitor-android-foreground-service`
- [ ] Prototype exact alarm plugin
- [ ] Create detailed project plan with milestones
- [ ] Set up beta testing infrastructure
- [ ] Migrate storage to `@capacitor/preferences`
- [ ] Remove `FullscreenActivity` and `LaunchDecider`
- [ ] Build foreground tracking plugin
- [ ] Build focus mode plugin
- [ ] Build exact alarms plugin
- [ ] Build SAF plugin (if needed)
- [ ] Build widget plugin (or deprecate)
- [ ] Update frontend to use Capacitor APIs
- [ ] Remove all legacy native code
- [ ] Write E2E tests for all plugins
- [ ] Performance benchmark vs current implementation
- [ ] Beta release to testers
- [ ] Address beta feedback
- [ ] Stable release
- [ ] Document migration process
- [ ] Publish plugins to npm (if open-sourcing)

---

**Document Version:** 1.0
**Date:** 2026-01-05
**Author:** Claude Code Analysis
**Status:** Draft - Pending Technical Review
