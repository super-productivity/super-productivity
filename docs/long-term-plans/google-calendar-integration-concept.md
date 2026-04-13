# Google Calendar Integration -- Concept Design Document

## Context

Super Productivity currently has a read-only iCal calendar integration that displays events in the planner and schedule views. A Google Calendar plugin exists (`packages/plugin-dev/google-calendar-provider/src/plugin.ts`) with full OAuth + CRUD capabilities. The goal is to design a richer Google Calendar integration that lets users manage their calendar entirely from within SP, without needing a separate calendar app. Rather than "true 2-way sync" (which has fundamental issues -- calendar events and tasks are different entities), the design uses an **ownership-based model** where behavior is determined by who created the item.

## The Concept: Four Layers

### Layer 1: Calendar Display (Google -> SP)

Events from all connected Google calendars appear in planner and schedule views. Read-only display, same as current iCal behavior but fetched via Google Calendar API with incremental `syncToken` sync.

### Layer 2: Event Management (SP <-> Google, direct CRUD)

Users can create, edit, and delete calendar events as **events** (not tasks) directly from the planner and schedule UI. Edits go to the calendar the event came from. New events go to a user-selected default calendar (configurable via dropdown). This is direct API calls, not sync.

### Layer 3: Event -> Task Promotion (one-time snapshot)

User explicitly clicks "Create task from this event" in the event detail panel. Creates a linked task that lives independently. Completing/deleting the task never touches the calendar event.

### Layer 4: Task -> Calendar Blocking (SP -> Google, lowest priority)

When a user schedules a task (dueWithTime + timeEstimate), SP can push a time-block event to a designated calendar. SP owns these events. Completing a task marks the event as done (keeps it, doesn't delete). This layer is lowest priority and should be built last.

---

## Configuration / Setup

**Settings > Integrations > Google Calendar:**

1. **Connect Google Account** -- OAuth button (existing plugin flow)
2. **Calendars to display** -- multi-select of all user's Google calendars (read + write access)
3. **Default calendar for new events** -- dropdown of writable calendars
4. **Time-block calendar** -- (Phase 4) dropdown of writable calendars, for task time-blocking
5. **Auto-block scheduled tasks** -- (Phase 4) toggle, off by default
6. **Sync range** -- how far ahead to fetch (default: 2 weeks)

### Config model changes to plugin:

```
displayCalendarIds: string[]        // All calendars to show
defaultWriteCalendarId: string      // Default target for new events
timeBlockCalendarId: string | null  // Target for task time-blocks (Phase 4)
isAutoTimeBlock: boolean            // Auto-push scheduled tasks (Phase 4)
syncRangeWeeks: number              // Fetch range
```

---

## Interaction Design

### Layer 1: Calendar Display

**No UI changes.** Google Calendar events flow into the same `CalendarIntegrationEvent[]` pipeline as iCal events. Planner selectors split them into allDayEvents/timedEvents. Schedule view renders them as time blocks.

**Data source change:** `CalendarIntegrationService` gains a Google Calendar fetch path alongside iCal. Uses `syncToken` for incremental sync (much faster than re-parsing iCal feeds).

### Layer 2: Event Management

**Clicking a calendar event** -- opens a **mat-menu** with three options:

1. **Edit event** -- opens a dialog to view/edit event details (title, time, duration, description, calendar name). Save calls `PATCH /calendars/{calendarId}/events/{eventId}`. Event stays in its original calendar. Dialog also has a "Delete event" button that calls `DELETE /calendars/{calendarId}/events/{eventId}`. For read-only calendars, the dialog shows details without edit/delete controls.
2. **Create as task** -- calls `IssueService.addTaskFromIssue()` with the Google Calendar provider key. Creates a task with `issueId` pointing to the event. One-time snapshot, no ongoing sync. The calendar event is unaffected by task lifecycle.
3. **Hide forever** -- permanently hides this event from planner and schedule views. Stored locally (not synced to Google). Useful for recurring noise like "Office closed" or events the user doesn't care about.

**Creating** -- new "Add Event" button in the issue panel (alongside existing task creation). Shows title input, time picker, calendar dropdown (defaults to `defaultWriteCalendarId`). Creates via `POST /calendars/{calendarId}/events`.

**Drag-to-reschedule** -- dragging a calendar event in schedule view calls `updateIssue()` with new start time (future enhancement).

### Layer 4: Task -> Calendar Blocking (lowest priority)

**Auto-create trigger:** new effect watches for tasks gaining `dueWithTime` + `timeEstimate`. If `isAutoTimeBlock` is enabled and task isn't already linked to an issue, creates an event on `timeBlockCalendarId` and links the task.

**Rescheduling:** existing push effect handles this -- changing `dueWithTime` triggers `updateIssue()`.

**Completing:** marks the calendar event as done (e.g., `[DONE]` prefix or extended property), does NOT delete it. Preserves history of how time was spent.

**Deleting task:** removes the time-block event (SP created it, SP owns it).

---

## Architecture

### What's reused as-is:

- Plugin OAuth flow (`plugin.ts` lines 136-153)
- Plugin CRUD methods (`createIssue`, `updateIssue`, `deleteIssue`)
- Plugin field mappings (`plugin.ts` lines 263-324)
- `CalendarIntegrationEvent` model (`calendar-integration.model.ts`)
- Planner/schedule rendering pipeline
- `IssueService.addTaskFromIssue()` for Layer 3
- Two-way sync push/delete effects for Layer 4

### What needs modification:

- `CalendarIntegrationService` -- add Google Calendar API fetch alongside iCal, support `syncToken`
- Calendar provider selectors -- match Google Calendar plugin key in addition to `'ICAL'`
- `PlannerCalendarEventComponent` -- click opens context menu instead of converting to task
- `ScheduleEventComponent.clickHandler()` -- same change for schedule view
- Google Calendar plugin config -- add multi-calendar fields

### New components:

- `CalendarEventContextMenuComponent` -- mat-menu triggered on event click (Edit event / Create as task / Hide forever)
- `CalendarEventEditDialogComponent` -- dialog for viewing/editing/deleting events
- `AddEventInlineComponent` or mode in issue panel -- for creating new events
- `GoogleCalendarCacheService` -- manages `syncToken` and incremental sync
- `HiddenCalendarEventsService` -- persists permanently hidden event IDs (localStorage or IndexedDB)
- `TimeBlockSyncEffect` (Phase 4) -- watches task schedule changes, auto-creates/updates/removes events

### Key data flow:

```
Layer 1: Google Calendar API -> CalendarIntegrationService -> CalendarIntegrationEvent[] -> planner/schedule selectors -> UI
Layer 2: UI action -> Google Calendar API (direct CRUD) -> refresh cache -> UI updates
Layer 3: UI "Create task" button -> IssueService.addTaskFromIssue() -> task created with issueId link
Layer 4: Task schedule change -> TimeBlockSyncEffect -> Google Calendar API -> event created/updated/removed
```

---

## Phased Delivery

### Phase 1: Google Calendar Display (Layer 1)

- Google Calendar API fetch in `CalendarIntegrationService`
- `syncToken` incremental sync
- Multi-calendar selection in config
- Events appear in planner/schedule (same rendering, different data source)

### Phase 2: Context Menu + Event Detail Dialog (Layer 2 + Layer 3 refinement)

- Build `CalendarEventContextMenuComponent` (mat-menu: Edit event / Create as task / Hide forever)
- Build `CalendarEventEditDialogComponent` (view/edit/delete event details)
- Change click handlers in planner/schedule to open context menu instead of auto-converting to task
- `HiddenCalendarEventsService` for "Hide forever" persistence
- "Create as task" menu item replaces current click-to-convert behavior

### Phase 3: Event CRUD (Layer 2 write)

- Edit mode in the event dialog (title, time, description)
- Delete button in the event dialog
- "Add Event" creation flow in issue panel with calendar dropdown
- Respect `accessRole` for read-only calendars (hide edit/delete controls)

### Phase 4: Task Time-Blocking (Layer 4)

- `TimeBlockSyncEffect` for auto-creating calendar events from scheduled tasks
- Done-state handling (mark event, don't delete)
- Config: time-block calendar selection, auto-block toggle

---

## Key Design Decisions

1. **Ownership determines behavior** -- no "sync direction" config. Google events are read+edit as events. SP time-blocks are owned by SP.
2. **Event CRUD bypasses the task/issue system** -- editing a calendar event does not create or modify any task entity.
3. **No recurring event write-back** -- display recurring instances (via `singleEvents: true`), but never create/modify recurring series.
4. **Edits stay in source calendar** -- editing an event always patches it in its original calendar. New events use a configurable default.
5. **Time-block completion = mark done, not delete** -- preserves time-spent history in the calendar.
6. **Layer 4 is lowest priority** -- Layers 1-3 deliver the core value. Time-blocking is a nice-to-have built on top.

---

## Files to Create/Modify

### Phase 1

- `src/app/features/calendar-integration/calendar-integration.service.ts` -- add Google fetch path
- `packages/plugin-dev/google-calendar-provider/src/plugin.ts` -- extend config model
- `src/app/features/planner/store/planner.selectors.ts` -- accept Google Calendar provider key

### Phase 2

- NEW: `src/app/features/calendar-integration/calendar-event-context-menu/` -- mat-menu component
- NEW: `src/app/features/calendar-integration/calendar-event-edit-dialog/` -- edit dialog component
- NEW: `src/app/features/calendar-integration/hidden-calendar-events.service.ts` -- hide forever persistence
- `src/app/features/planner/planner-calendar-event/planner-calendar-event.component.ts` -- click opens context menu
- `src/app/features/schedule/schedule-event/schedule-event.component.ts` -- click opens context menu

### Phase 3

- NEW: event creation UI in issue panel area
- `calendar-event-edit-dialog` component -- add edit mode
- `packages/plugin-dev/google-calendar-provider/src/plugin.ts` -- ensure CRUD methods handle all cases

### Phase 4

- NEW: `src/app/features/issue/two-way-sync/time-block-sync.effects.ts`
- `packages/plugin-dev/google-calendar-provider/src/plugin.ts` -- done-marking logic
