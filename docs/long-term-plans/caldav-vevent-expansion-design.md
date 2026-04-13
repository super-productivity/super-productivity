# CalDAV VEVENT Expansion — Design Document

> **Status: Planned**

## Overview

Extend the existing CalDAV provider to support VEVENT (calendar events) alongside VTODO (tasks). This gives self-hosted calendar users (Nextcloud, Radicale, Baikal, Fastmail) two-way event sync with no new auth infrastructure — the same basic auth that already works for VTODOs.

## Motivation

- **Privacy-first users** often self-host calendars via CalDAV. This is the highest-value, lowest-complexity path to calendar sync for that audience.
- **No new auth complexity** — basic auth over HTTPS, already implemented.
- **No external dependencies** — no OAuth, no auth proxy, no Google app verification.
- **Library support exists** — `@nextcloud/cdav-library` already supports `findByType('VEVENT')` and `findByTypeInTimeRange('VEVENT', from, to)`. `ical.js` is already used for parsing.
- **Complementary to Google Calendar** — serves the self-hosted segment while Google Calendar (separate provider, OAuth-based) serves mainstream users.

## Decisions

| Decision          | Choice                                                                  | Rationale                                                                                    |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Provider approach | Extend existing CalDAV provider                                         | Single provider handles both VTODOs and VEVENTs from the same server connection              |
| Event behavior    | Configurable per-provider: banners (default) or auto-import as tasks    | Matches user request; reuses existing `isAutoImportForCurrentDay` pattern from ICAL provider |
| Data model        | Reuse `CalendarIntegrationEvent` + CalDAV-specific wrapper for etag/URL | Shares display layer with ICAL provider; adds sync metadata for write-back                   |
| Auth              | Same basic auth as VTODO — no changes                                   | Already works, already implemented                                                           |
| Sync direction    | Two-way (configurable per field, like VTODO)                            | Consistent with existing CalDAV sync behavior                                                |

---

## Current State

### What Exists

**CalDAV provider** (`src/app/features/issue/providers/caldav/`):

- Two-way VTODO sync with basic auth
- Uses `@nextcloud/cdav-library` + `ical.js`
- Sync adapter pattern: `CaldavSyncAdapterService` implements `IssueSyncAdapter<CaldavCfg>`
- Field-level sync direction config (`SyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both'`)
- ETag-based change detection (hashed to 32-bit int for numeric comparison)
- Client/calendar caching per connection

**ICAL provider** (`src/app/features/issue/providers/calendar/`):

- Read-only VEVENT display from `.ics` URLs
- `CalendarIntegrationEvent` model: `{ id, calProviderId, title, description, start, duration, isAllDay }`
- `isAutoImportForCurrentDay` flag for auto-creating tasks from events
- Banner notifications for upcoming events (`showBannerBeforeThreshold`)
- Full RFC 5545 support: recurring events (RRULE), EXDATE, RECURRENCE-ID overrides

### What's Missing

- CalDAV VEVENT queries (library supports it, code doesn't use it)
- VEVENT parsing in CalDAV client (currently only parses `vtodo` subcomponent)
- Calendar event display from CalDAV sources (only from `.ics` URLs)
- Write-back for VEVENTs (updating event status/fields on CalDAV server)

---

## Architecture

### Config Model Extension

```typescript
// Existing CaldavCfg, extended:
interface CaldavCfg extends BaseIssueProviderCfg {
  caldavUrl: string | null;
  resourceName: string | null;
  username: string | null;
  password: string | null;
  categoryFilter: string | null;

  // Existing VTODO sync
  twoWaySync?: CaldavTwoWaySyncCfg;

  // New VEVENT support
  includeEvents?: boolean; // Enable VEVENT fetching (default: false)
  eventBehavior?: 'banners' | 'auto-import'; // How events appear in SP
  eventTwoWaySync?: CaldavEventTwoWaySyncCfg; // Field-level sync for events
  showBannerBeforeThreshold?: number | null; // Minutes before event to show banner
  eventCheckInterval?: number; // Poll interval for events (ms)
}

interface CaldavEventTwoWaySyncCfg {
  title?: SyncDirection;
  description?: SyncDirection;
  // VEVENTs don't have "completed" — status is confirmed/tentative/cancelled
  // Mapping: task done → event cancelled (configurable)
  markDoneAs?: 'cancelled' | 'none';
}
```

### VEVENT Data Model

```typescript
// Extends CalendarIntegrationEvent with CalDAV sync metadata
interface CaldavCalendarEvent extends CalendarIntegrationEvent {
  etag_hash: number; // For change detection (same pattern as VTODO)
  item_url: string; // CalDAV object URL for write-back
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  location?: string;
  categories?: string[];
}
```

### Data Flow

```
CalDAV Server
    ↕ (Basic Auth, same connection as VTODOs)
CaldavClientService
    ├── _getAllTodos()     → existing VTODO flow → tasks
    └── _getAllEvents()    → NEW VEVENT flow:
            ↓
    CalendarIntegrationEvent[]
            ↓
    ┌───────────────────────┐
    │ eventBehavior config  │
    ├───────────────────────┤
    │ 'banners'      → display as timeline banners (like ICAL provider)
    │ 'auto-import'  → create tasks from events (like isAutoImportForCurrentDay)
    └───────────────────────┘
            ↓ (if task created and two-way sync enabled)
    CaldavEventSyncAdapter → writes status changes back to server
```

### Changes to CaldavClientService

New methods (parallel to existing VTODO methods):

```typescript
// Query VEVENTs from CalDAV server
_getAllEvents(calendar, timeRangeStart, timeRangeEnd): CaldavCalendarEvent[]

// Parse a VEVENT from ical.js component
_mapEvent(veventObject): CaldavCalendarEvent

// Update a VEVENT on the server
_updateEvent(cfg, event, changes): Promise<void>
```

The existing `findByTypeInTimeRange('VEVENT', from, to)` method on the calendar object handles the CalDAV REPORT query. No new protocol code needed.

### New Sync Adapter

`CaldavEventSyncAdapterService` implements `IssueSyncAdapter<CaldavCfg>`:

```typescript
CALDAV_EVENT_FIELD_MAPPINGS = [
  { spField: 'title', issueField: 'summary', label: 'Title' },
  { spField: 'notes', issueField: 'description', label: 'Description' },
  // No direct 'isDone' mapping — VEVENTs use status: CONFIRMED/CANCELLED
];
```

When a user marks a task (created from a VEVENT) as done:

- If `markDoneAs === 'cancelled'`: set VEVENT `STATUS` to `CANCELLED`
- If `markDoneAs === 'none'`: don't write back done status

### Integration with CalendarIntegrationEffects

The existing `CalendarIntegrationEffects.pollChanges$` currently only handles ICAL providers. It needs to also poll CalDAV providers that have `includeEvents: true`:

1. On timer (per `eventCheckInterval`), call `CaldavClientService._getAllEvents()` for the relevant time window
2. Emit `CalendarIntegrationEvent[]` through the same display pipeline as ICAL events
3. If `eventBehavior === 'auto-import'`, create tasks (reusing existing `isAutoImportForCurrentDay` logic)
4. Show banner notifications (reusing existing threshold logic)

---

## VEVENT ↔ VTODO: How They Coexist

A single CalDAV provider instance connects to one calendar resource. That resource may contain both VTODOs and VEVENTs. The provider handles both:

| Aspect           | VTODOs (existing)                                 | VEVENTs (new)                                        |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Queried as       | `calendar.calendarQuery()` with VTODO comp-filter | `calendar.findByTypeInTimeRange('VEVENT', from, to)` |
| Displayed as     | Tasks in backlog/today list                       | Calendar banners or imported tasks                   |
| Two-way fields   | isDone, title, notes                              | title, description, done→cancelled                   |
| Change detection | ETag hash                                         | ETag hash (same mechanism)                           |
| Time window      | All open todos (no time filter)                   | Current day/week (configurable)                      |

---

## What Does NOT Sync

- Attendees (SP has no concept of event participants)
- Reminders/alarms (SP has its own notification system)
- Recurrence rules (complex — recurring instances are displayed but recurrence editing is out of scope)
- Attachments
- SP-specific fields: sub-tasks, time tracking, tags, priorities, estimates

---

## Implementation Phases

### Phase 1: Read-Only VEVENT Import

- Add `_getAllEvents()` and `_mapEvent()` to `CaldavClientService`
- Extend `CaldavCfg` with `includeEvents` flag
- Feed VEVENTs into `CalendarIntegrationEvent` display pipeline
- Support banner notifications and `auto-import` behavior
- Settings UI: checkbox to enable events, behavior selector

### Phase 2: Two-Way VEVENT Sync

- Add `CaldavEventSyncAdapterService`
- Register it in the two-way sync effects alongside the existing VTODO adapter
- Support title/description write-back and done→cancelled mapping
- ETag-based conflict detection (same as VTODO)

### Phase 3: Enhanced Event Features (Future)

- Time-range configuration (how far ahead to fetch events)
- Category/calendar filtering for events
- Location display in event banners
- Recurring event handling improvements

---

## Relationship to Other Calendar Work

| Provider                           | Target Users                  | Auth                     | API         | Status           |
| ---------------------------------- | ----------------------------- | ------------------------ | ----------- | ---------------- |
| **ICAL** (existing)                | Anyone with a public .ics URL | None                     | HTTP GET    | Done (read-only) |
| **CalDAV VTODO** (existing)        | Self-hosted calendar users    | Basic auth               | CalDAV      | Done (two-way)   |
| **CalDAV VEVENT** (this doc)       | Self-hosted calendar users    | Basic auth               | CalDAV      | Planned          |
| **Google Calendar** (separate doc) | Mainstream users              | OAuth 2.0 (hybrid proxy) | REST API v3 | Planned          |

CalDAV VEVENT and Google Calendar are complementary:

- CalDAV VEVENT serves privacy-focused, self-hosted users with zero auth overhead
- Google Calendar serves mainstream users who need OAuth infrastructure
- Both share the `CalendarIntegrationEvent` display layer and configurable import behavior

---

## References

- Existing CalDAV provider: `src/app/features/issue/providers/caldav/`
- Existing ICAL provider: `src/app/features/issue/providers/calendar/`
- Calendar integration effects: `src/app/features/calendar-integration/calendar-integration.effects.ts`
- Calendar integration model: `src/app/features/calendar-integration/calendar-integration.model.ts`
- Two-way sync adapter interface: `src/app/features/issue/two-way-sync/issue-sync-adapter.interface.ts`
- Two-way sync effects: `src/app/features/issue/two-way-sync/issue-two-way-sync.effects.ts`
- Google Calendar provider design: `docs/long-term-plans/google-calendar-provider-design.md`
- General calendar sync analysis: `docs/long-term-plans/calendar-two-way-sync-technical-analysis.md`
