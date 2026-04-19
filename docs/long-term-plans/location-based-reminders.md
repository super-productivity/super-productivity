# Location-Based Reminders — Design Document

> **Status: Planned (Brainstorm)**

## Overview

Add location-based reminders to Super Productivity. Users can attach a saved location to a task and receive a notification when they arrive at that place. This is primarily a mobile feature (Android/iOS via Capacitor), with passive location display on desktop/web.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary platform | Mobile (Android/iOS) | Geofencing requires GPS + background location. Desktop/web show location info but don't trigger. |
| Trigger type | Arrive only (v1) | Simplest. Leave triggers can be added later. |
| Location management | Saved locations entity | Users revisit the same places. Follows existing Tag entity pattern. |
| Location picker (v1) | "Use current location" + label | No map needed for v1. Map picker is a v2 enhancement. |
| Geofencing approach | Custom native Capacitor plugin | `@capacitor/geolocation` only does point-in-time reads, not geofencing. Need native `GeofencingClient` (Android) / `CLLocationManager` (iOS). |
| Sync | Sync by default | Location data treated like any other entity. Each device manages its own geofences locally after sync. |
| Feature toggle | `isLocationRemindersEnabled` in `AppFeaturesConfig` | Opt-in, default false. |

---

## 1. Data Model

### 1.1 SavedLocation Entity

New file: `src/app/features/saved-location/saved-location.model.ts`

```typescript
import { EntityState } from '@ngrx/entity';

export interface SavedLocationCopy {
  id: string;
  title: string;             // "Office", "Grocery Store", "Gym"
  lat: number;               // latitude
  lng: number;               // longitude
  radius: number;            // geofence radius in meters (default 200)
  icon?: string | null;      // material icon name, e.g. 'home', 'work', 'shopping_cart'
  created: number;           // creation timestamp
  modified?: number;         // last update timestamp
}

export type SavedLocation = Readonly<SavedLocationCopy>;
export type SavedLocationState = EntityState<SavedLocation>;
```

### 1.2 Task Model Changes

File: `src/app/features/tasks/task.model.ts` — add to `TaskCopy`:

```typescript
/** ID of a SavedLocation. When set, a geofence reminder is active for this task. */
locationReminderId?: string | null;
```

### 1.3 Config Changes

File: `src/app/features/config/global-config.model.ts` — add to `AppFeaturesConfig`:

```typescript
isLocationRemindersEnabled: boolean;  // default false
```

File: `src/app/features/config/default-global-config.const.ts` — set default:

```typescript
isLocationRemindersEnabled: false,
```

### 1.4 Platform Capabilities

File: `src/app/core/platform/platform-capabilities.model.ts` — add:

```typescript
/** Whether the platform supports native geofencing (background location monitoring). */
readonly geofencing: boolean;
```

| Platform | `geofencing` |
|----------|-------------|
| Android (`ANDROID_CAPABILITIES`) | `true` |
| iOS (`IOS_CAPABILITIES`) | `true` |
| Electron (`ELECTRON_CAPABILITIES`) | `false` |
| Web (`WEB_CAPABILITIES`) | `false` |

---

## 2. Sync & Persistence Registration

All registration steps required for the new entity, following existing patterns:

### 2.1 Entity Type

File: `packages/shared-schema/src/entity-types.ts`

Add `'SAVED_LOCATION'` to the `ENTITY_TYPES` array.

### 2.2 Action Types Enum

File: `src/app/op-log/core/action-types.enum.ts`

```typescript
// SavedLocation actions
SAVED_LOCATION_ADD = '[SavedLocation] Add SavedLocation',
SAVED_LOCATION_UPDATE = '[SavedLocation] Update SavedLocation',
SAVED_LOCATION_DELETE = '[SavedLocation] Delete SavedLocation',
```

These string values are **immutable** once deployed — they are used for encoding/decoding operations in IndexedDB and sync between clients.

### 2.3 Entity Registry

File: `src/app/op-log/core/entity-registry.ts`

Add to `ENTITY_CONFIGS`:

```typescript
SAVED_LOCATION: {
  storagePattern: 'adapter',
  featureName: SAVED_LOCATION_FEATURE_NAME,
  payloadKey: 'savedLocation',
  adapter: savedLocationAdapter,
  selectEntities: createSelector(
    selectSavedLocationFeatureState,
    selectSavedLocationEntitiesFromAdapter,
  ),
  selectById: selectSavedLocationById,
},
```

### 2.4 Model Config

File: `src/app/op-log/model/model-config.ts`

Add to `AllModelConfig` type:

```typescript
savedLocation: ModelCfg<SavedLocationState>;
```

Add to `MODEL_CONFIGS`:

```typescript
savedLocation: {
  defaultData: initialSavedLocationState,
  isMainFileModel: true,
  repair: fixEntityStateConsistency,
},
```

### 2.5 Root State

File: `src/app/root-store/root-state.ts`

```typescript
[SAVED_LOCATION_FEATURE_NAME]: SavedLocationState;
```

### 2.6 Feature Store Registration

File: `src/app/root-store/feature-stores.module.ts`

```typescript
StoreModule.forFeature(SAVED_LOCATION_FEATURE_NAME, savedLocationReducer),
```

### 2.7 Cascading Delete Meta-Reducer

File: `src/app/root-store/meta/task-shared-meta-reducers/saved-location-shared.reducer.ts`

When a SavedLocation is deleted, clear `locationReminderId` on all tasks that reference it. This must be a meta-reducer (not an effect) to ensure atomicity — one operation in the sync log.

Register in `src/app/root-store/meta/meta-reducer-registry.ts` in **Phase 5** (Entity-Specific Cascades), alongside `tagSharedMetaReducer`, `projectSharedMetaReducer`, etc.

---

## 3. NgRx Store

### 3.1 Actions

File: `src/app/features/saved-location/store/saved-location.actions.ts`

Following the Tag action pattern with `PersistentActionMeta`:

| Action | OpType | Payload |
|--------|--------|---------|
| `addSavedLocation` | `Create` | `{ savedLocation: SavedLocation }` |
| `updateSavedLocation` | `Update` | `{ savedLocation: Update<SavedLocation> }` |
| `deleteSavedLocation` | `Delete` | `{ id: string }` |

All include `meta: { isPersistent: true, entityType: 'SAVED_LOCATION', entityId, opType } satisfies PersistentActionMeta`.

### 3.2 Reducer

File: `src/app/features/saved-location/store/saved-location.reducer.ts`

Standard `@ngrx/entity` adapter:

```typescript
export const SAVED_LOCATION_FEATURE_NAME = 'savedLocation';
export const savedLocationAdapter = createEntityAdapter<SavedLocation>({
  sortComparer: (a, b) => a.title.localeCompare(b.title),
});
export const initialSavedLocationState = savedLocationAdapter.getInitialState();
```

### 3.3 Selectors

File: `src/app/features/saved-location/store/saved-location.selectors.ts`

| Selector | Returns |
|----------|---------|
| `selectSavedLocationFeatureState` | Feature state |
| `selectAllSavedLocations` | `SavedLocation[]` |
| `selectSavedLocationById` | `SavedLocation \| undefined` |
| `selectSavedLocationEntities` | `Dictionary<SavedLocation>` |

Task-side selector (in task selectors or a cross-feature selector):

| Selector | Returns |
|----------|---------|
| `selectTasksWithLocationReminder` | All undone tasks that have `locationReminderId` set |

### 3.4 Service

File: `src/app/features/saved-location/saved-location.service.ts`

Thin wrapper dispatching actions to the store. Methods: `addSavedLocation()`, `updateSavedLocation()`, `deleteSavedLocation()`, `getById$()`.

---

## 4. Geofencing Service

### 4.1 Architecture

New file: `src/app/features/saved-location/geofence.service.ts`

```
Store (undone tasks with locationReminderId)
  → GeofenceService watches selector (distinctUntilChanged)
  → Computes which locations need active geofences
  → Registers/unregisters via custom Capacitor plugin
  → Receives geofence enter events
  → Emits to ReminderService for dialog/notification
```

### 4.2 Why a Custom Capacitor Plugin

`@capacitor/geolocation` only provides one-time and continuous position reads — it does **not** support geofencing. Native geofencing requires:

- **Android:** `com.google.android.gms.location.GeofencingClient` (Google Play Services). Supports up to 100 geofences. Fires `BroadcastReceiver` on enter/exit.
- **iOS:** `CLLocationManager.startMonitoring(for: CLCircularRegion)`. Supports up to 20 monitored regions. Fires delegate callbacks on enter/exit.

Implementation: Create `GeofencePlugin.kt` (Android) and `GeofencePlugin.swift` (iOS) extending Capacitor's `Plugin` class. Register in `CapacitorMainActivity.onCreate()` following the pattern of `SafBridgePlugin`, `WebDavHttpPlugin`, etc.

### 4.3 Lifecycle Rules

**Register geofence when:**
- Feature is enabled + a task gets `locationReminderId` assigned
- App starts with existing location-reminded tasks

**Unregister geofence when:**
- Task is completed, deleted, or `locationReminderId` cleared
- SavedLocation is deleted
- No more undone tasks reference that location
- Feature is disabled

**iOS 20-region limit:** Only register geofences for the 20 locations with the most active tasks. Re-evaluate when tasks change.

### 4.4 Effects

Effects MUST use `inject(LOCAL_ACTIONS)` — geofence registration should never happen during remote sync replay. Each device manages its own geofences based on local state after sync.

### 4.5 Background Behavior

When geofence fires while app is in background:
- **Android:** `BroadcastReceiver` shows native notification directly (same pattern as `ReminderAlarmReceiver`). Tapping opens app + reminder dialog.
- **iOS:** `CLLocationManager` delegate fires local notification. Tapping opens app + reminder dialog.

### 4.6 Permission Flow

On first use:
1. Check `CapacitorPlatformService.hasCapability('geofencing')`
2. Request `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` (Android) or "Always" location access (iOS)
3. If denied: feature degrades to display-only, show explanation

---

## 5. Reminder Integration

### 5.1 Integration Point

The existing `ReminderService.onRemindersActive$` is a derived observable — external code cannot emit to it directly. Two approaches:

**Option A (recommended):** Add a new public subject on `ReminderService`:

```typescript
// In ReminderService
private _onLocationReminders$ = new Subject<TaskWithReminderData[]>();
locationReminders$ = this._onLocationReminders$.asObservable();
```

Then merge in `ReminderModule`:

```typescript
merge(
  this._reminderService.onRemindersActive$,
  this._reminderService.locationReminders$,
).subscribe(reminders => /* existing dialog handling */);
```

**Option B:** Add a public method `emitLocationReminders()` that pushes to the private `_onRemindersActive$` subject.

### 5.2 Data Shape

Location-triggered reminders must satisfy `TaskWithReminderData`:

```typescript
interface TaskWithReminderData extends Task {
  readonly reminderData: { remindAt: number };  // use trigger timestamp
  readonly parentData?: Task;
  readonly isDeadlineReminder?: boolean;         // false for location
}
```

Consider adding `isLocationReminder?: boolean` for UI differentiation.

### 5.3 Dialog UX Changes

The existing `DialogViewTaskRemindersComponent` works as-is with minor additions:
- Show location name/icon in header (e.g., "At: Grocery Store")
- **Snooze** = suppress this location reminder for 1 hour (temporary geofence pause)
- **Dismiss** = clear `locationReminderId` on the task
- **Done** = mark task complete (same as today)
- Hide "Edit Reminder" time picker for location-triggered reminders

### 5.4 Native Notifications (Background)

Reuse `CapacitorReminderService` patterns:
- Android: native notification via `ReminderNotificationHelper` triggered from geofence `BroadcastReceiver`
- iOS: `LocalNotifications.schedule()` triggered from `CLLocationManager` delegate
- Both support Done/Snooze action buttons

---

## 6. UI Components

### 6.1 New Components

| Component | Path | Purpose |
|-----------|------|---------|
| `saved-location-settings` | `src/app/features/saved-location/saved-location-settings/` | CRUD list in settings page |
| `location-picker-dialog` | `src/app/features/saved-location/location-picker-dialog/` | Assign location to task (dropdown + "Use current location") |

### 6.2 Modified Components

| Component | Change |
|-----------|--------|
| Task detail panel | Add "Location" field showing assigned location |
| Task schedule dialog | Add location option alongside time-based reminder |
| Settings page | Add "Locations" section |
| Reminder dialog | Show location name when triggered by geofence |

### 6.3 Location Picker UX

```
┌─────────────────────────────────┐
│  Set Location Reminder          │
├─────────────────────────────────┤
│                                 │
│  📍 Use Current Location        │  ← gets GPS, prompts for label
│                                 │
│  ─── Saved Locations ────────── │
│                                 │
│  🏠 Home                        │
│  🏢 Office                      │
│  🛒 Grocery Store               │
│                                 │
│  [ Remove Location ] [ Cancel ] │
└─────────────────────────────────┘
```

### 6.4 Settings Section

```
┌─────────────────────────────────┐
│  Location Reminders             │
├─────────────────────────────────┤
│  [Toggle] Enable location       │
│          reminders              │
│                                 │
│  Saved Locations:               │
│  ┌─────────────────────────┐    │
│  │ 🏠 Home     200m  [✏️][🗑]│    │
│  │ 🏢 Office   150m  [✏️][🗑]│    │
│  │ 🛒 Grocery  200m  [✏️][🗑]│    │
│  └─────────────────────────┘    │
│  [ + Add Location ]            │
└─────────────────────────────────┘
```

---

## 7. Cross-Platform Behavior

| Platform | Geofencing | Location Display | Notifications |
|----------|-----------|-----------------|---------------|
| **Android** | Native `GeofencingClient`, up to 100 fences, background | Yes | Native via `BroadcastReceiver` |
| **iOS** | Native `CLLocationManager`, up to 20 regions, background | Yes | Native via `LocalNotifications` |
| **Electron** | None | Yes (label only) | None |
| **Web** | None | Yes (label only) | None |

---

## 8. File Structure

```
src/app/features/saved-location/
├── saved-location.model.ts
├── saved-location.const.ts                    # DEFAULT_RADIUS = 200
├── saved-location.service.ts
├── geofence.service.ts                        # Capacitor geofencing bridge
├── store/
│   ├── saved-location.actions.ts
│   ├── saved-location.reducer.ts
│   └── saved-location.selectors.ts
├── saved-location-settings/
│   ├── saved-location-settings.component.ts
│   └── saved-location-settings.component.html
└── location-picker-dialog/
    ├── location-picker-dialog.component.ts
    └── location-picker-dialog.component.html

src/app/root-store/meta/task-shared-meta-reducers/
└── saved-location-shared.reducer.ts           # Cascading delete

android/app/src/main/java/.../
└── GeofencePlugin.kt                         # Native Android geofencing
    GeofenceBroadcastReceiver.kt              # Handles fence enter events

ios/App/App/
└── GeofencePlugin.swift                      # Native iOS geofencing
```

---

## 9. All Files to Touch

### New Files

| File | Purpose |
|------|---------|
| `src/app/features/saved-location/saved-location.model.ts` | Entity interface |
| `src/app/features/saved-location/saved-location.const.ts` | Defaults |
| `src/app/features/saved-location/saved-location.service.ts` | Service |
| `src/app/features/saved-location/geofence.service.ts` | Capacitor bridge |
| `src/app/features/saved-location/store/saved-location.actions.ts` | Actions |
| `src/app/features/saved-location/store/saved-location.reducer.ts` | Reducer + adapter |
| `src/app/features/saved-location/store/saved-location.selectors.ts` | Selectors |
| `src/app/features/saved-location/saved-location-settings/*` | Settings UI |
| `src/app/features/saved-location/location-picker-dialog/*` | Picker dialog |
| `src/app/root-store/meta/task-shared-meta-reducers/saved-location-shared.reducer.ts` | Cascading deletes |
| `android/.../GeofencePlugin.kt` | Android native geofencing |
| `android/.../GeofenceBroadcastReceiver.kt` | Android fence event handler |
| `ios/App/App/GeofencePlugin.swift` | iOS native geofencing |

### Modified Files

| File | Change |
|------|--------|
| `packages/shared-schema/src/entity-types.ts` | Add `'SAVED_LOCATION'` |
| `src/app/op-log/core/action-types.enum.ts` | Add `SAVED_LOCATION_ADD/UPDATE/DELETE` |
| `src/app/op-log/core/entity-registry.ts` | Add `SAVED_LOCATION` config |
| `src/app/op-log/model/model-config.ts` | Add to `AllModelConfig` + `MODEL_CONFIGS` |
| `src/app/root-store/root-state.ts` | Add to `RootState` |
| `src/app/root-store/feature-stores.module.ts` | Register feature store |
| `src/app/root-store/meta/meta-reducer-registry.ts` | Register cascading delete in Phase 5 |
| `src/app/features/tasks/task.model.ts` | Add `locationReminderId` field |
| `src/app/features/config/global-config.model.ts` | Add `isLocationRemindersEnabled` |
| `src/app/features/config/default-global-config.const.ts` | Set default `false` |
| `src/app/core/platform/platform-capabilities.model.ts` | Add `geofencing` capability |
| `src/app/features/reminder/reminder.service.ts` | Add `locationReminders$` subject |
| `src/app/features/reminder/reminder.module.ts` | Merge location reminders into dialog flow |
| `android/app/src/main/AndroidManifest.xml` | Add location permissions |
| `android/.../CapacitorMainActivity.kt` | Register `GeofencePlugin` |

---

## 10. Future Enhancements (Out of Scope)

- Map picker with OpenStreetMap tiles
- Address search / geocoding (Nominatim)
- Leave triggers ("remind when I leave the office")
- Time + location combos ("at the store, but only after 5 PM")
- Project default locations
- Location-based task views ("show tasks for where I am now")
- WiFi-based triggers (alternative to GPS, works indoors)
- Bluetooth beacon triggers

---

## 11. Verification Plan

1. **Unit tests:** SavedLocation reducer, selectors, service, cascading delete meta-reducer
2. **Manual mobile testing:**
   - Create location from "Use current location"
   - Assign to a task, verify geofence registration
   - Move in/out of geofence, verify notification fires
   - Complete task, verify geofence unregistered
   - Delete location, verify `locationReminderId` cleared on tasks
3. **Desktop/web:** Verify location label displays on tasks, no geofencing attempted
4. **Sync:** Create location on device A, verify it appears on device B
5. **Lint/format:** `npm run lint`, `npm run prettier`, `npm test`
