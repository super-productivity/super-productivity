# Technical Hurdles for True Two-Way Calendar Sync

## Executive Summary

Based on my exploration of Super Productivity's codebase, implementing true two-way calendar sync faces several significant technical challenges that go beyond the robust sync infrastructure already in place. While the app has sophisticated Operation Log-based sync for its own data and read-only iCal polling for calendars, bridging these systems to enable bidirectional calendar sync requires solving authentication, API integration, conflict resolution, and architectural challenges.

---

## Current State Assessment

### What We Have ✓

1. **Read-only iCal integration** - Polls HTTP/HTTPS iCal feeds at configurable intervals
2. **Robust internal sync** - Operation Log with vector clocks for conflict detection
3. **Task conversion** - One-way: calendar events → Super Productivity tasks
4. **Recurring event handling** - Full RFC 5545 iCalendar parsing with RRULE support

### What's Missing ✗

1. **OAuth2 authentication** - No direct Google Calendar/Outlook API integration
2. **Write operations** - Cannot create/update/delete events in external calendars
3. **Bidirectional mapping** - No reverse mapping: tasks → calendar events
4. **Webhook/push notifications** - Poll-only architecture (no real-time updates from calendars)

---

## Technical Hurdles Breakdown

### 1. Authentication & Authorization 🔴 **CRITICAL**

**Challenge:** External calendar APIs require OAuth2 authentication with platform-specific implementations.

**Current State:**

- iCal integration uses anonymous HTTP fetching (no auth)
- No OAuth flow implementation in codebase
- Electron + PWA contexts require different auth strategies

**Required Work:**

- **Google Calendar API:**
  - OAuth2 with offline access + refresh tokens
  - Scopes: `calendar.events` (read/write)
  - Token storage in encrypted config
  - Refresh token rotation handling
  - Multiple account support (work + personal calendars)

- **Microsoft Outlook/Office 365:**
  - Microsoft Identity Platform OAuth
  - Different endpoint structure vs Google
  - Azure AD app registration required

- **Cross-platform considerations:**
  - **Electron desktop:** Can use local web server callback for OAuth
  - **PWA/web:** Must use redirect-based OAuth flow
  - **Mobile (Capacitor):** Deep linking for OAuth redirect
  - **File-based sync:** How to sync OAuth tokens securely across devices?

**Complexity:** 🔴 **HIGH** - Each provider needs custom implementation, token security critical

---

### 2. Bidirectional Data Mapping & Sync 🔴 **CRITICAL**

**Challenge:** Map Super Productivity tasks ↔ Calendar events with different data models.

**Current State:**

- One-way only: `CalendarIntegrationEvent` → `Task` (via manual/auto-import)
- No reverse tracking: which task originated from which calendar event
- No task → event conversion logic

**Required Work:**

#### A. Entity Relationship Model

```
Task ↔ CalendarEventBinding {
  taskId: string;
  calendarEventId: string;          // External calendar's event ID
  calendarProviderId: string;       // Which calendar (Google/Outlook/iCal)
  calendarId: string;               // Which specific calendar in provider
  isBidirectional: boolean;         // Is this a two-way synced event?
  lastSyncedAt: number;             // Prevent sync loops
  syncDirection: 'to-calendar' | 'from-calendar' | 'both';
}
```

#### B. Field Mapping Challenges

| Super Productivity | Calendar Event     | Conflict Potential                           |
| ------------------ | ------------------ | -------------------------------------------- |
| `title`            | `summary`          | ✓ Low                                        |
| `notes`            | `description`      | ✓ Medium - formatting differences            |
| `dueDay` (date)    | `start` (datetime) | 🔴 **HIGH** - all-day vs timed               |
| `timeEstimate`     | `duration`         | 🔴 **HIGH** - SP estimates vs fixed duration |
| `isDone`           | No equivalent      | 🟡 Medium - could use attendee status?       |
| `tagIds[]`         | `categories[]`?    | 🟡 Medium - limited support                  |
| `projectId`        | Which calendar?    | 🔴 **HIGH** - SP project ≠ calendar          |
| `subTasks[]`       | No equivalent      | 🔴 **HIGH** - can't sync nested structure    |
| `repeatCfgId`      | RRULE              | 🔴 **HIGH** - different recurrence models    |
| `remindCfg`        | Reminders          | ✓ Low                                        |

**Key Architectural Question:**

> Should tasks and calendar events be **separate entities with bindings** (current approach could extend)
> OR should they be **unified entities with multiple views**?

Current architecture suggests separate entities with bindings, but this creates:

- **Duplicate storage** (task in SP + event in calendar)
- **Sync loop risk** (update task → update event → webhook → update task...)
- **Conflict resolution complexity** (which is source of truth?)

#### C. Sync Direction Strategies

1. **Calendar → Task (read-only)** - Current implementation, works well
2. **Task → Calendar (write-only)** - Easier, no conflicts
3. **Full bidirectional** - Requires LWW or user resolution

**Complexity:** 🔴 **HIGH** - Data model impedance mismatch + conflict resolution

---

### 3. Conflict Resolution with External Systems 🟡 **MEDIUM-HIGH**

**Challenge:** External calendars have their own conflict resolution; must reconcile with SP's vector clocks.

**Current State:**

- Super Productivity uses **vector clocks + LWW** for internal sync
- External calendars use:
  - **Google:** ETag + revision tracking
  - **Outlook:** changeKey versioning
  - **CalDAV:** ETag headers

**Sync Scenarios:**

#### Scenario 1: Task updated in SP, event updated in calendar

```
User A (device 1): Updates task title in SP
User A (device 2): Updates event title in Google Calendar
SP syncs across devices (vector clock detects no conflict - same user)
But calendar API sees stale ETag → returns 412 Precondition Failed
```

**Problem:** SP's vector clocks don't translate to external ETags.

**Solutions:**

- **Store last-seen ETag/changeKey** in `CalendarEventBinding`
- **On conflict (412/409):**
  - Fetch latest from calendar
  - Apply LWW based on timestamps (SP op timestamp vs calendar `updated` field)
  - Retry with fresh ETag
- **Sync loop prevention:** Track `lastSyncedAt` + hash of synced state

#### Scenario 2: Recurring event series modified

```
User edits single instance in calendar (adds RECURRENCE-ID exception)
SP task still points to original event ID
Sync needs to decide: update binding to exception? Create new task?
```

**Problem:** Recurring events add complexity to 1:1 task-event mapping.

**Solutions:**

- **One task per instance** (explosion of tasks)
- **One task for series** (lose per-instance customization)
- **Mixed approach** (series task + exception tasks)

#### Scenario 3: Calendar deleted externally

```
User deletes event in Google Calendar app
SP polling detects missing event (404 or absent from list)
Should SP task be deleted? Unlinked? Marked as "calendar deleted"?
```

**Problem:** Destructive operations need user intent clarification.

**Solutions:**

- **Unlink task** (keep task, remove binding)
- **Auto-delete task** (if task was auto-created from calendar)
- **User confirmation** (show dialog: "Event deleted in calendar, delete task?")

**Complexity:** 🟡 **MEDIUM-HIGH** - Not as complex as internal sync, but external APIs have different semantics

---

### 4. Real-time Updates vs Polling 🟡 **MEDIUM**

**Challenge:** Current architecture is poll-based (5 min - 2 hours). Bidirectional sync needs faster updates.

**Current State:**

- iCal polling: 2 hours default
- Internal sync polling: 1-15 minutes
- No webhook/push notification support

**Calendar API Capabilities:**

- **Google Calendar:** Push notifications via webhooks (Cloud Pub/Sub channels)
- **Outlook:** Delta queries + webhooks (Microsoft Graph subscriptions)
- **CalDAV:** Poll-only (no standard webhook mechanism)

**Webhook Challenges:**

1. **Server requirement:**
   - SP is peer-to-peer / file-based (no central server for webhooks)
   - SuperSync server could handle webhooks, but not Dropbox/WebDAV sync

2. **Desktop/mobile webhook reception:**
   - Electron app: no public endpoint (behind NAT/firewall)
   - Mobile app: same issue
   - Web PWA: could use service worker + notification API, but unreliable

3. **Webhook verification:**
   - Google requires HTTPS endpoint with valid cert
   - Outlook requires webhook validation endpoint
   - Both need subscription renewal (Google: 7 days, Outlook: 3 days)

**Solutions:**

- **Hybrid approach:**
  - Poll more frequently for calendar sync (1-5 minutes)
  - Use webhooks only when SuperSync server available
  - Fall back to polling on Electron/mobile/file-based

- **Immediate upload after changes:**
  - When user updates task bound to calendar, immediately push to calendar API
  - Don't wait for sync cycle
  - Similar to SP's `ImmediateUploadService` for SuperSync

- **Accept eventual consistency:**
  - 1-5 minute delay acceptable for most use cases
  - Reserve immediate sync for user-initiated actions

**Complexity:** 🟡 **MEDIUM** - Polling is viable, webhooks are nice-to-have

---

### 5. API Rate Limits & Quotas 🟡 **MEDIUM**

**Challenge:** External APIs have strict rate limits; aggressive polling could hit limits.

**API Limits:**

- **Google Calendar API:**
  - 1,000,000 queries/day (free tier)
  - 500 queries per 100 seconds per user
  - Batch requests: 50 requests per batch

- **Microsoft Graph (Outlook):**
  - Varies by license (free tier: ~1200 requests/min)
  - Throttling returns 429 with Retry-After header

**Current SP Sync Patterns:**

- Polls all enabled calendars on timer
- No batch request optimization
- No incremental sync (always fetches full month)

**Required Optimizations:**

1. **Incremental sync:**
   - Google: `syncToken` for changes since last fetch
   - Outlook: `deltaLink` for changes only
   - Only fetch modified events (huge bandwidth savings)

2. **Batch operations:**
   - Google: Batch API for multiple calendar reads/writes
   - Outlook: `$batch` endpoint
   - Reduce API calls by 10-50x

3. **Exponential backoff:**
   - Respect 429 Retry-After headers
   - Back off on repeated failures
   - Disable sync temporarily if quota exhausted

4. **Selective sync:**
   - Only sync calendars user explicitly enables
   - Configurable date range (default: 1 month ahead)
   - Skip unchanged calendars (ETag-based conditional requests)

**Complexity:** 🟡 **MEDIUM** - Well-documented patterns, but requires careful implementation

---

### 6. Recurring Events & Exceptions 🔴 **HIGH**

**Challenge:** SP's recurring task model differs from iCalendar RRULE model.

**Current State:**

- SP has `RepeatCfg` with simpler recurrence (daily/weekly/monthly)
- iCal parsing handles RRULE, but SP doesn't generate RRULE
- No exception handling (EXDATE, RECURRENCE-ID) in SP's repeat model

**Recurring Event Scenarios:**

#### A. Simple recurring task → calendar

```
SP Task: "Daily standup" repeats every weekday
Calendar: RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR
```

✓ **Straightforward mapping**

#### B. Recurring calendar event with exceptions → tasks

```
Calendar: "Team meeting" every Tuesday, but June 15 is cancelled (EXDATE)
SP: Create multiple tasks? One task with skip dates?
```

🔴 **Complex** - SP doesn't have native "skip date" concept

#### C. Single instance modification

```
Calendar: User moves one instance of recurring event to different time
Calendar creates exception event with RECURRENCE-ID
SP: Update one task instance? Create new task? Modify repeat config?
```

🔴 **Very complex** - 1:1 mapping breaks down

**Solutions:**

1. **Limit to simple recurrence:**
   - Only sync recurring events that map cleanly to SP's model
   - Show warning for complex RRULE patterns
   - Treat exceptions as separate events/tasks

2. **Expand recurring events:**
   - Generate individual tasks for each instance (next 3 months)
   - No recurrence config in SP
   - Simple but creates many tasks

3. **Enhance SP's repeat model:**
   - Add exception date support
   - Add RRULE generator
   - Major refactor of task repeat system

**Complexity:** 🔴 **HIGH** - Fundamental model mismatch requires architectural decisions

---

### 7. Calendar Selection & Multiple Calendars 🟡 **MEDIUM**

**Challenge:** Users have multiple calendars per provider; need flexible mapping to SP projects/contexts.

**User Scenarios:**

- Work Google account: "Work calendar", "Team events", "OOO calendar"
- Personal Google account: "Personal", "Family", "Gym classes"
- Outlook: "Company calendar", "Shared team calendar"

**Questions to Answer:**

1. **Project mapping:**
   - Should calendars map to SP projects? (1:1 or N:1?)
   - Should SP projects export to specific calendars?
   - What about tasks without projects?

2. **Sync scope:**
   - Sync all calendars from authenticated account?
   - Let user select which calendars to sync?
   - Per-calendar sync direction (read-only vs bidirectional)?

3. **Event creation:**
   - When user creates task in SP, which calendar does event go to?
   - Default calendar per project?
   - Prompt user every time?

4. **Shared calendars:**
   - Some calendars are read-only (shared by others)
   - How to handle permission errors gracefully?

**Configuration Model:**

```typescript
CalendarSyncConfig {
  provider: 'google' | 'outlook';
  accountEmail: string;

  calendars: {
    calendarId: string;              // External calendar ID
    calendarName: string;            // Display name
    syncDirection: 'import' | 'export' | 'bidirectional';
    mappedProjectId?: string;        // SP project for this calendar
    isAutoImport: boolean;           // Auto-convert events to tasks
  }[];

  defaultCalendarId?: string;        // Where to create events
}
```

**Complexity:** 🟡 **MEDIUM** - Mostly UI/UX decisions, not deep technical challenges

---

### 8. Error Handling & Resilience 🟡 **MEDIUM**

**Challenge:** External APIs fail (network issues, auth expiry, API changes); must handle gracefully.

**Failure Modes:**

1. **Auth expiry:**
   - Refresh token invalid → re-authenticate
   - Show notification to user
   - Pause sync until re-auth

2. **Network failures:**
   - Offline detection (navigator.onLine)
   - Retry with exponential backoff
   - Queue operations for later retry

3. **API errors:**
   - 404: Event deleted externally
   - 409/412: Conflict (stale ETag)
   - 429: Rate limit exceeded
   - 500: Server error (transient)

4. **Data corruption:**
   - Malformed API responses
   - Schema mismatches
   - Partial sync failures

5. **Sync loops:**
   - Update event → webhook → update task → update event → ∞
   - Prevent with lastSyncedAt + state hash

**Required Infrastructure:**

1. **Retry queue:**
   - Store failed operations in IndexedDB
   - Retry with backoff (similar to SP's sync retry logic)
   - User-visible status ("3 events pending sync")

2. **Error notifications:**
   - Toast messages for transient errors
   - Persistent banner for auth issues
   - Sync status indicator (red = error, yellow = pending, green = synced)

3. **Conflict UI:**
   - Show side-by-side comparison (current in SP vs current in calendar)
   - Let user choose or merge
   - Similar to SP's existing sync conflict dialog

4. **Sync audit log:**
   - Track all sync operations for debugging
   - Useful for support ("why didn't my task sync?")

**Complexity:** 🟡 **MEDIUM** - Can leverage existing SP sync error handling patterns

---

### 9. Privacy & Data Security 🟡 **MEDIUM**

**Challenge:** Calendar data is sensitive; must maintain SP's privacy-first approach.

**Privacy Principles:**

- SP currently keeps all data local (or E2E encrypted with SuperSync)
- iCal integration is read-only, anonymous HTTP fetches
- No telemetry or analytics

**New Concerns with Two-Way Sync:**

1. **OAuth tokens:**
   - Store encrypted in local DB
   - Never log or transmit tokens in plaintext
   - Rotate refresh tokens periodically

2. **Calendar data exposure:**
   - Synced events now in SP's database
   - File-based sync: events in sync-data.json (encrypted?)
   - SuperSync: E2E encrypted already (no issue)

3. **Third-party API privacy:**
   - Google/Microsoft can see which events SP accesses
   - OAuth scopes should be minimal (`calendar.events` only)
   - No telemetry sent to calendar providers

4. **Shared calendar leakage:**
   - User syncs company shared calendar
   - Sensitive meeting info now in personal SP database
   - Need clear warnings about scope of sync

**Required Work:**

- Document privacy implications clearly
- Add toggle: "Enable cloud calendar sync" (off by default)
- Encrypt OAuth tokens in storage
- Clear documentation: "This feature shares your task data with Google/Microsoft APIs"

**Complexity:** 🟡 **MEDIUM** - More about policy and transparency than technical implementation

---

### 10. Testing & Reliability 🟡 **MEDIUM-HIGH**

**Challenge:** External API dependencies make testing complex; need comprehensive mocking.

**Testing Challenges:**

1. **OAuth flows:**
   - Hard to test end-to-end in CI
   - Need mock OAuth server
   - Token refresh edge cases

2. **API mocking:**
   - Google Calendar API: 50+ endpoints
   - Outlook Graph API: different structure
   - Need comprehensive fixture data

3. **Conflict scenarios:**
   - Simulate concurrent updates
   - Test ETag conflicts (412)
   - Test sync loop prevention

4. **Error conditions:**
   - Network failures (abort requests)
   - Rate limiting (429 responses)
   - Malformed responses

5. **Recurring event edge cases:**
   - Exceptions, EXDATE, RECURRENCE-ID
   - Timezone changes (DST)
   - All-day → timed conversions

**Testing Strategy:**

1. **Unit tests:**
   - Mock calendar API services
   - Test mapping logic (task ↔ event)
   - Test conflict resolution

2. **Integration tests:**
   - Use Google/Outlook test accounts
   - Automated E2E flows (create task → verify event in calendar)
   - Cleanup test data after runs

3. **Manual testing:**
   - OAuth flows (different browsers, platforms)
   - Multi-device scenarios
   - Permission errors (read-only calendars)

**Complexity:** 🟡 **MEDIUM-HIGH** - Requires dedicated test infrastructure

---

## Architectural Decision Points

### Decision 1: Which Calendar Providers?

**Options:**

1. Google Calendar only (simplest, most popular)
2. Google + Outlook (covers 90%+ of users)
3. Generic CalDAV (covers remaining providers, but more complex)

**Recommendation:** Start with Google Calendar only (MVP), add Outlook in phase 2.

---

### Decision 2: Sync Strategy

**Options:**

1. **Read-only enhanced** (current + better UX)
   - Easiest: improve current iCal integration
   - Add task binding for manual updates
   - No write permissions needed

2. **Write-only** (tasks → events)
   - Medium difficulty
   - Export SP tasks to calendar
   - No conflicts (one-way)

3. **Full bidirectional**
   - Hardest: both directions
   - Real two-way sync
   - Conflict resolution required

**Recommendation:** Implement in phases:

- **Phase 1:** Read-only enhanced (quick win)
- **Phase 2:** Write-only (export capability)
- **Phase 3:** Full bidirectional (if user demand justifies complexity)

---

### Decision 3: Entity Model

**Options:**

1. **Separate entities with bindings** (current architecture extends cleanly)
   - Tasks and CalendarEvents remain separate
   - `CalendarEventBinding` table links them
   - Can sync subset of tasks

2. **Unified entity** (major refactor)
   - "ScheduledItem" that can be both task and event
   - Single source of truth
   - Simpler sync logic but breaks existing architecture

**Recommendation:** Separate entities with bindings (less risky, incremental).

---

### Decision 4: Conflict Resolution

**Options:**

1. **Last-Write-Wins (LWW)** - Automatic, can lose data
2. **Manual resolution** - User chooses, better UX but disruptive
3. **Hybrid** - LWW for simple conflicts, manual for complex

**Recommendation:** Hybrid (same as current SP sync strategy).

---

## Estimated Complexity Scoring

| Component                       | Complexity     | LOC Estimate  | Risk Level |
| ------------------------------- | -------------- | ------------- | ---------- |
| OAuth2 implementation (Google)  | 🔴 High        | 800-1200      | Medium     |
| OAuth2 implementation (Outlook) | 🔴 High        | 600-800       | Medium     |
| Data mapping (task ↔ event)     | 🔴 High        | 1000-1500     | High       |
| Conflict resolution             | 🟡 Medium-High | 400-600       | High       |
| Recurring event handling        | 🔴 High        | 800-1200      | High       |
| Calendar selection UI           | 🟡 Medium      | 600-800       | Low        |
| Error handling & retry          | 🟡 Medium      | 500-700       | Medium     |
| Testing infrastructure          | 🟡 Medium-High | 1000-1500     | Medium     |
| **Total Estimate**              | **🔴 High**    | **6000-9000** | **High**   |

---

## Critical Path & Unknowns

### Unknowns Requiring Prototyping:

1. **Recurring event sync:** Can we map complex RRULE to SP's model?
2. **Sync loop prevention:** Will lastSyncedAt + hash prevent infinite loops?
3. **OAuth on Electron:** How to handle redirect callback securely?
4. **Rate limits:** Will 1-min polling hit Google's quotas with multiple calendars?
5. **Offline edits:** How to queue calendar writes when offline?

### Critical Dependencies:

- Decision on sync strategy (read vs write vs bidirectional)
- Decision on entity model (separate vs unified)
- Google Calendar API approval (OAuth consent screen)

---

## Recommendation Summary

**Short Term (MVP):**

1. ✓ Keep current read-only iCal integration
2. ✓ Add task binding tracking (which task came from which event)
3. ✓ Improve UX: show calendar icon on tasks, click to open in calendar
4. ✓ Add manual "update from calendar" action
   - Fetch latest event data from calendar API
   - Update task fields if changed
   - No automatic sync, user-initiated only

**Effort:** ~2-3 weeks, low risk, immediate value

---

**Medium Term (Write Capability):**

1. Implement Google Calendar OAuth
2. Add "Export task to calendar" action
3. Create event in calendar when user clicks export
4. No automatic bidirectional sync yet
5. Handle simple edits (update event when task updated)

**Effort:** ~6-8 weeks, medium risk, high value for power users

---

**Long Term (Full Bidirectional):**

1. Add automatic bidirectional sync
2. Implement conflict resolution UI
3. Add webhook support (where feasible)
4. Support recurring events with exceptions
5. Add Outlook provider

**Effort:** ~12-16 weeks, high risk, requires careful rollout

---

## Key Takeaway

**True two-way calendar sync is achievable but non-trivial.** The main hurdles are:

1. **Authentication complexity** (OAuth flows across platforms)
2. **Data model impedance mismatch** (tasks ≠ events, especially recurring)
3. **Conflict resolution** (reconciling external ETags with SP's vector clocks)
4. **Sync loop prevention** (avoiding infinite update cycles)

Super Productivity's robust Operation Log architecture is a strong foundation, but calendar sync is fundamentally different from peer-to-peer sync:

- External APIs have different conflict semantics
- No vector clocks to coordinate with
- Destructive operations (deletes) need user confirmation
- Recurring events are complex

**The smart path:** Start with read-only enhancements, add write capability incrementally, only implement full bidirectional if user demand justifies the complexity.

---

---

# DEEP DIVES: Technical Implementation Details

The following sections provide comprehensive technical deep dives into each major hurdle, including code examples, API specifics, edge cases, and implementation strategies.

---

## DEEP DIVE 1: OAuth2 Authentication Architecture

### 1.1 OAuth2 Flow Comparison: Google vs Outlook vs Electron

#### Google Calendar OAuth2 Flow

**Endpoints:**

```typescript
const GOOGLE_OAUTH = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: [
    'https://www.googleapis.com/auth/calendar.events', // Read/write events
    'https://www.googleapis.com/auth/calendar.readonly', // Read-only (optional)
  ],
  // CRITICAL: Request offline access for refresh tokens
  accessType: 'offline',
  prompt: 'consent', // Force consent screen to get refresh token
};
```

**Authorization Request:**

```typescript
// Step 1: Generate PKCE challenge (required for security)
const codeVerifier = generateRandomString(128);
const codeChallenge = await sha256(codeVerifier);

const authUrl = new URL(GOOGLE_OAUTH.authUrl);
authUrl.searchParams.append('client_id', CLIENT_ID);
authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
authUrl.searchParams.append('response_type', 'code');
authUrl.searchParams.append('scope', GOOGLE_OAUTH.scopes.join(' '));
authUrl.searchParams.append('access_type', 'offline');
authUrl.searchParams.append('prompt', 'consent');
authUrl.searchParams.append('code_challenge', codeChallenge);
authUrl.searchParams.append('code_challenge_method', 'S256');

// Open browser or redirect
window.location.href = authUrl.toString();
```

**Token Exchange:**

```typescript
// Step 2: Exchange authorization code for tokens
const tokenResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code: authorizationCode,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier, // PKCE verifier
  }),
});

const tokens = await tokenResponse.json();
// {
//   access_token: "ya29.a0...",
//   refresh_token: "1//0e...",  // Only on first auth or forced consent
//   expires_in: 3600,
//   scope: "https://www.googleapis.com/auth/calendar.events",
//   token_type: "Bearer"
// }
```

**Refresh Token Flow:**

```typescript
// Step 3: Refresh access token when expired
const refreshResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: storedRefreshToken,
  }),
});

const newTokens = await refreshResponse.json();
// {
//   access_token: "ya29.a0...",  // New access token
//   expires_in: 3600,
//   scope: "https://www.googleapis.com/auth/calendar.events",
//   token_type: "Bearer"
//   // NOTE: No new refresh_token (reuse existing one)
// }
```

**Critical Issue: Refresh Token Rotation**

- Google refresh tokens are **long-lived but not permanent**
- Refresh tokens can be invalidated if:
  - User revokes access in Google Account settings
  - User changes password
  - 6 months of inactivity
  - 50 refresh tokens issued (oldest gets revoked)
- **Solution:** Detect `invalid_grant` error and force re-authentication

#### Microsoft Outlook/Office 365 OAuth2 Flow

**Endpoints:**

```typescript
const MICROSOFT_OAUTH = {
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: [
    'https://graph.microsoft.com/Calendars.ReadWrite', // Read/write calendars
    'offline_access', // REQUIRED for refresh tokens
  ],
};
```

**Key Differences from Google:**

1. **Tenant ID:** Use `common` for multi-tenant, or specific tenant ID for org accounts
2. **Scope Format:** Different structure (`Graph.microsoft.com/` prefix)
3. **Refresh Token Rotation:** Microsoft **rotates refresh tokens** on every refresh (Google doesn't)

**Token Refresh with Rotation:**

```typescript
const refreshResponse = await fetch(MICROSOFT_OAUTH.tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    scope: MICROSOFT_OAUTH.scopes.join(' '),
    grant_type: 'refresh_token',
    refresh_token: storedRefreshToken,
  }),
});

const newTokens = await refreshResponse.json();
// {
//   access_token: "EwB4A8l6...",
//   refresh_token: "M.R3_BAY...",  // NEW refresh token (MUST SAVE!)
//   expires_in: 3600,
//   token_type: "Bearer"
// }

// CRITICAL: Update stored refresh token
await updateStoredRefreshToken(newTokens.refresh_token);
```

**Failure to Save New Refresh Token = Lost Access**

- If you don't save the new refresh token, the old one becomes invalid
- Next refresh attempt will fail with `invalid_grant`
- User must re-authenticate from scratch

---

### 1.2 Cross-Platform OAuth Implementation

#### Challenge: Different Redirect URI Strategies

| Platform                | Redirect URI                             | Implementation    |
| ----------------------- | ---------------------------------------- | ----------------- |
| **Electron Desktop**    | `http://localhost:PORT`                  | Local HTTP server |
| **Web PWA**             | `https://your-domain.com/oauth/callback` | Standard redirect |
| **Android (Capacitor)** | `com.yourapp:/oauth/callback`            | Deep link         |
| **iOS (Capacitor)**     | `yourapp://oauth/callback`               | Custom URL scheme |

#### Electron: Local HTTP Server for OAuth Callback

**Implementation:**

```typescript
import { BrowserWindow } from 'electron';
import * as http from 'http';

async function startOAuthFlow(): Promise<OAuthTokens> {
  // 1. Start local HTTP server on random port
  const server = http.createServer();
  const port = await getAvailablePort(8000, 9000);

  await new Promise<void>((resolve) => server.listen(port, resolve));

  const redirectUri = `http://localhost:${port}/oauth/callback`;

  // 2. Generate PKCE challenge
  const { codeVerifier, codeChallenge } = await generatePKCE();

  // 3. Build authorization URL
  const authUrl = buildAuthUrl({
    clientId: CLIENT_ID,
    redirectUri,
    codeChallenge,
    scopes: GOOGLE_OAUTH.scopes,
  });

  // 4. Open in system browser (NOT in-app browser for security)
  await shell.openExternal(authUrl);

  // 5. Wait for callback
  const authCode = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('OAuth timeout')), 120000);

    server.on('request', (req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400);
          res.end(
            `<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`,
          );
          reject(new Error(error));
        } else if (code) {
          res.writeHead(200);
          res.end(
            '<html><body><h1>Success!</h1><p>You can close this window.</p><script>window.close()</script></body></html>',
          );
          clearTimeout(timeout);
          resolve(code);
        }
      }
    });
  });

  // 6. Clean up server
  server.close();

  // 7. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(authCode, codeVerifier, redirectUri);

  return tokens;
}
```

**Security Considerations:**

- **Use system browser, not in-app WebView:** Prevents phishing attacks (user can verify real google.com URL)
- **PKCE is mandatory:** Even for desktop apps (prevents authorization code interception)
- **Random port:** Avoid port conflicts with other apps
- **Timeout:** Close server after 2 minutes to prevent port leaks

#### Web PWA: Standard Redirect Flow

**Implementation:**

```typescript
// In Angular service
async startOAuthFlow(): Promise<void> {
  // 1. Generate PKCE and store in sessionStorage
  const { codeVerifier, codeChallenge } = await generatePKCE();
  sessionStorage.setItem('oauth_code_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', generateRandomString(32));

  // 2. Build auth URL
  const authUrl = buildAuthUrl({
    clientId: CLIENT_ID,
    redirectUri: `${window.location.origin}/oauth/callback`,
    codeChallenge,
    state: sessionStorage.getItem('oauth_state'),
    scopes: GOOGLE_OAUTH.scopes,
  });

  // 3. Redirect user
  window.location.href = authUrl;
}

// In OAuth callback route component
async ngOnInit(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  // 4. Validate state (CSRF protection)
  const storedState = sessionStorage.getItem('oauth_state');
  if (state !== storedState) {
    throw new Error('Invalid state parameter (CSRF detected)');
  }

  if (error) {
    this.router.navigate(['/settings'], {
      queryParams: { oauth_error: error }
    });
    return;
  }

  // 5. Exchange code for tokens
  const codeVerifier = sessionStorage.getItem('oauth_code_verifier')!;
  const tokens = await this.calendarAuthService.exchangeCodeForTokens(
    code,
    codeVerifier,
    `${window.location.origin}/oauth/callback`
  );

  // 6. Clean up session storage
  sessionStorage.removeItem('oauth_code_verifier');
  sessionStorage.removeItem('oauth_state');

  // 7. Store tokens and redirect
  await this.calendarAuthService.storeTokens(tokens);
  this.router.navigate(['/settings/calendar']);
}
```

#### Mobile (Capacitor): Deep Link Callback

**Android Configuration (capacitor.config.json):**

```json
{
  "appId": "com.superproductivity.app",
  "plugins": {
    "CapacitorOAuth": {
      "android": {
        "deepLinkScheme": "com.superproductivity.app"
      }
    }
  }
}
```

**iOS Configuration (Info.plist):**

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>superproductivity</string>
    </array>
  </dict>
</array>
```

**Implementation:**

```typescript
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

async startOAuthFlow(): Promise<OAuthTokens> {
  // 1. Generate PKCE
  const { codeVerifier, codeChallenge } = await generatePKCE();

  // Store verifier for callback handler
  await Preferences.set({
    key: 'oauth_code_verifier',
    value: codeVerifier,
  });

  // 2. Build auth URL with custom scheme redirect
  const redirectUri = 'com.superproductivity.app:/oauth/callback';
  const authUrl = buildAuthUrl({
    clientId: CLIENT_ID,
    redirectUri,
    codeChallenge,
    scopes: GOOGLE_OAUTH.scopes,
  });

  // 3. Open in system browser
  await Browser.open({ url: authUrl });

  // 4. Wait for deep link callback
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('OAuth timeout'));
    }, 120000);

    const listener = App.addListener('appUrlOpen', async (data) => {
      clearTimeout(timeout);
      listener.remove();

      // Parse deep link: com.superproductivity.app:/oauth/callback?code=...
      const url = new URL(data.url);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        reject(new Error(error));
        return;
      }

      // 5. Exchange code for tokens
      const verifier = (await Preferences.get({ key: 'oauth_code_verifier' })).value!;
      const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);

      await Preferences.remove({ key: 'oauth_code_verifier' });
      resolve(tokens);
    });
  });
}
```

---

### 1.3 Token Storage & Security

#### Encryption Strategy

**Store encrypted tokens in IndexedDB:**

```typescript
import { AES, enc } from 'crypto-js';

class SecureTokenStorage {
  // Device-specific encryption key (derived from device ID + user password hash)
  private async getEncryptionKey(): Promise<string> {
    // Option 1: Derive from device ID (less secure, but no user input)
    const deviceId = await this.getDeviceId();
    return await this.deriveKey(deviceId);

    // Option 2: Require user password (more secure, but UX friction)
    // const password = await this.promptUserPassword();
    // return await this.deriveKey(password);
  }

  async storeTokens(accountId: string, tokens: OAuthTokens): Promise<void> {
    const encryptionKey = await this.getEncryptionKey();

    const encrypted = {
      accessToken: AES.encrypt(tokens.access_token, encryptionKey).toString(),
      refreshToken: AES.encrypt(tokens.refresh_token, encryptionKey).toString(),
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };

    // Store in IndexedDB (not localStorage - too small, too insecure)
    await this.db.put('oauth_tokens', encrypted, accountId);
  }

  async getTokens(accountId: string): Promise<OAuthTokens | null> {
    const encrypted = await this.db.get('oauth_tokens', accountId);
    if (!encrypted) return null;

    const encryptionKey = await this.getEncryptionKey();

    return {
      access_token: AES.decrypt(encrypted.accessToken, encryptionKey).toString(enc.Utf8),
      refresh_token: AES.decrypt(encrypted.refreshToken, encryptionKey).toString(
        enc.Utf8,
      ),
      expires_in: Math.floor((encrypted.expiresAt - Date.now()) / 1000),
      token_type: 'Bearer',
    };
  }

  async refreshAccessToken(accountId: string): Promise<string> {
    const tokens = await this.getTokens(accountId);
    if (!tokens) throw new Error('No tokens found');

    // Check if still valid
    if (Date.now() < tokens.expiresAt - 60000) {
      // 1 min buffer
      return tokens.access_token;
    }

    // Refresh
    try {
      const newTokens = await this.exchangeRefreshToken(tokens.refresh_token);
      await this.storeTokens(accountId, newTokens);
      return newTokens.access_token;
    } catch (error) {
      if (error.message === 'invalid_grant') {
        // Refresh token invalid - require re-authentication
        await this.revokeTokens(accountId);
        throw new Error('REAUTH_REQUIRED');
      }
      throw error;
    }
  }
}
```

#### Syncing Tokens Across Devices (File-Based Sync)

**Problem:** User authenticates on Device A, syncs to Dropbox, opens Device B. How does Device B get OAuth tokens?

**Solution Options:**

**Option 1: No Sync (Recommended)**

- OAuth tokens are **device-specific**
- User must authenticate on each device independently
- Safer: compromised sync file doesn't expose calendar access
- **Trade-off:** User annoyance (must OAuth on each device)

**Option 2: Encrypted Token Sync**

- Encrypt tokens with user-provided password (not device-specific key)
- Include encrypted tokens in sync-data.json
- Device B prompts for password to decrypt tokens
- **Trade-off:** Password management complexity, weaker security if password reused

**Option 3: SuperSync Token Relay**

- SuperSync server stores encrypted tokens (E2E encrypted with user's encryption key)
- Device B fetches tokens from server after authentication
- **Trade-off:** Only works with SuperSync, not file-based sync

**Recommendation:** Option 1 (no sync) - security over convenience.

---

### 1.4 Edge Cases & Error Handling

#### Scenario: User Revokes Access Mid-Sync

**Timeline:**

```
T0: Sync starts, fetches calendar events successfully
T1: User opens Google Account settings
T2: User clicks "Remove access" for Super Productivity
T3: Sync tries to create event → 401 Unauthorized
```

**Handling:**

```typescript
async syncToCalendar(task: Task, binding: CalendarEventBinding): Promise<void> {
  try {
    const accessToken = await this.tokenStorage.refreshAccessToken(binding.accountId);

    await this.calendarApi.updateEvent(
      binding.calendarId,
      binding.calendarEventId,
      this.mapTaskToEvent(task),
      accessToken
    );
  } catch (error) {
    if (error.status === 401 && error.error?.error === 'invalid_grant') {
      // Token revoked - disable sync and notify user
      await this.disableCalendarSync(binding.accountId);

      this.notificationService.show({
        type: 'error',
        title: 'Calendar Access Revoked',
        message: 'Please re-authenticate to continue syncing.',
        action: {
          label: 'Re-authenticate',
          callback: () => this.startOAuthFlow(binding.provider),
        },
        persistent: true, // Don't auto-dismiss
      });

      throw new Error('REAUTH_REQUIRED');
    }

    throw error; // Other errors bubble up
  }
}
```

#### Scenario: Multiple Accounts (Work + Personal)

**Data Model:**

```typescript
interface CalendarAccount {
  id: string; // UUID
  provider: 'google' | 'outlook';
  email: string; // Account identifier
  displayName: string; // "Work Gmail", "Personal Outlook"
  tokens: EncryptedOAuthTokens;
  calendars: {
    calendarId: string;
    calendarName: string;
    colorId?: string;
    accessRole: 'owner' | 'writer' | 'reader';
    syncEnabled: boolean;
    syncDirection: 'import' | 'export' | 'bidirectional';
    mappedProjectId?: string;
  }[];
  isDefault: boolean; // Default account for new events
}
```

**UI Flow:**

```
Settings > Calendar Sync
  ├─ [+ Add Account]
  ├─ Work Gmail (user@company.com) [Default] [Remove]
  │   ├─ ✓ Work Calendar (import + export) → Project: Work
  │   ├─ ✓ Team Events (import only)
  │   └─ ☐ OOO Calendar (disabled)
  └─ Personal Gmail (personal@gmail.com) [Remove]
      ├─ ✓ Personal Calendar (import + export) → Project: Personal
      └─ ✓ Family Calendar (import only) → Project: Family
```

---

## DEEP DIVE 2: Data Mapping & Synchronization Logic

### 2.1 Field-by-Field Mapping Strategy

#### Title / Summary (Low Conflict Risk)

**Mapping:**

```typescript
// Task → Event
event.summary = task.title;

// Event → Task
task.title = event.summary || '(No title)';
```

**Edge Cases:**

- **Empty title:** Google Calendar allows empty summary, SP requires title
  - **Solution:** Use placeholder "(No title)" or "(Untitled event)"
- **Very long title:** Calendar APIs have limits (Google: ~1024 chars, Outlook: ~255 chars)
  - **Solution:** Truncate with ellipsis, store full title in description

#### Notes / Description (Medium Conflict Risk)

**Challenge:** Formatting differences

- SP: Plain text with markdown-like formatting
- Google: Supports limited HTML (`<b>`, `<i>`, `<a>`)
- Outlook: Rich text (HTML)

**Mapping Strategy:**

```typescript
// Task → Event
function taskNotesToEventDescription(notes: string): string {
  // Option 1: Plain text (safest, loses formatting)
  return notes;

  // Option 2: Convert markdown to HTML (better UX)
  return marked.parse(notes, {
    breaks: true,
    gfm: true,
  });
}

// Event → Task
function eventDescriptionToTaskNotes(description: string): string {
  // Strip HTML tags
  const stripped = description.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  return he.decode(stripped);
}
```

**Conflict Scenario:**

```
Device A: User edits task notes in SP (markdown)
Device B: User edits event description in Google Calendar (adds bold formatting)
Sync: Both changes detected → LWW based on timestamps
```

#### Due Date/Time (HIGH Conflict Risk)

**Challenge:** SP has two fields, calendar has `start` + `end`

**SP Model:**

```typescript
interface Task {
  dueDay: string | null; // YYYY-MM-DD (all-day task)
  dueWithTime: number | null; // Timestamp (timed task)
  timeEstimate: number | null; // Milliseconds (estimated duration)
}
```

**Calendar Model:**

```typescript
interface CalendarEvent {
  start: {
    date?: string; // YYYY-MM-DD (all-day event)
    dateTime?: string; // ISO 8601 with timezone (timed event)
    timeZone?: string;
  };
  end: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
}
```

**Mapping Rules:**

**Case 1: All-day task → All-day event**

```typescript
// Task: dueDay = "2024-06-15", dueWithTime = null
// Event:
{
  start: { date: "2024-06-15" },
  end: { date: "2024-06-16" }  // IMPORTANT: Exclusive end date!
}
```

**Case 2: Timed task → Timed event**

```typescript
// Task: dueWithTime = 1718467200000 (2024-06-15T14:00:00Z), timeEstimate = 3600000 (1 hour)
// Event:
{
  start: {
    dateTime: "2024-06-15T14:00:00Z",
    timeZone: "UTC"
  },
  end: {
    dateTime: "2024-06-15T15:00:00Z",  // start + timeEstimate
    timeZone: "UTC"
  }
}
```

**Case 3: Task with both dueDay and dueWithTime (SP allows this!)**

```typescript
// Task: dueDay = "2024-06-15", dueWithTime = 1718467200000
// Interpretation: Task is due on June 15, ideally at 2pm
// Event: Use dueWithTime (more specific)
{
  start: { dateTime: "2024-06-15T14:00:00Z" },
  end: { dateTime: "2024-06-15T15:00:00Z" }
}
```

**Case 4: All-day event → Task**

```typescript
// Event: start = { date: "2024-06-15" }, end = { date: "2024-06-16" }
// Task:
{
  dueDay: "2024-06-15",
  dueWithTime: null,
  timeEstimate: null
}
```

**Case 5: Timed event → Task**

```typescript
// Event: start = "2024-06-15T14:00:00Z", end = "2024-06-15T15:00:00Z"
// Task:
{
  dueDay: null,  // Don't set both dueDay and dueWithTime (prefer dueWithTime)
  dueWithTime: 1718467200000,  // start timestamp
  timeEstimate: 3600000  // end - start
}
```

**Conflict Scenario: All-day ↔ Timed Conversion**

```
Initial: All-day event on June 15
User A (SP): Sets dueWithTime = June 15 at 2pm (converts to timed task)
User B (Calendar): Keeps as all-day event
Sync: Conflict detected
  → LWW: If User A's change is newer, event becomes timed (start = 2pm, end = 3pm with default 1h duration)
  → If User B's change is newer, task reverts to all-day (dueDay = June 15, dueWithTime = null)
```

**Duration Ambiguity:**

- **Task timeEstimate is optional** (SP allows tasks without estimates)
- **Calendar end time is mandatory**
- **Solution:** Use default duration (1 hour) if timeEstimate is null

```typescript
function getEventEnd(task: Task): string {
  const start = task.dueWithTime!;
  const duration = task.timeEstimate || 3600000; // Default: 1 hour
  const end = start + duration;

  return new Date(end).toISOString();
}
```

#### Completion Status (Medium Conflict Risk)

**Challenge:** Calendar events don't have "isDone" concept

**Options:**

**Option 1: Don't sync completion**

- Keep task completion status local to SP
- Calendar event unchanged regardless of task.isDone
- **Trade-off:** User completes task in SP, event still shows in calendar (confusing)

**Option 2: Delete event when task completed**

- When task.isDone = true, delete calendar event
- When event deleted, mark task.isDone = true
- **Trade-off:** Destructive (loses event history)

**Option 3: Use calendar-specific completion fields**

- **Google Calendar:** No native completion field, but could use `status: 'cancelled'`
- **Outlook:** Has `responseStatus` (accepted/declined), not quite the same
- **Trade-off:** Abusing fields for unintended purposes

**Option 4: Change event color/transparency**

- Mark completed events with specific color (e.g., gray)
- Google: `colorId` property
- Outlook: `showAs: 'free'` (vs 'busy')
- **Trade-off:** Visual indicator only, not semantic

**Recommendation:** Option 4 (color change) + make deletion configurable

```typescript
async markTaskCompleted(task: Task, binding: CalendarEventBinding): Promise<void> {
  const userPreference = await this.getUserCompletionStrategy();

  switch (userPreference) {
    case 'DELETE_EVENT':
      await this.calendarApi.deleteEvent(binding.calendarEventId);
      await this.deleteBinding(binding.id);
      break;

    case 'CHANGE_COLOR':
      await this.calendarApi.updateEvent(binding.calendarEventId, {
        colorId: this.config.completedEventColorId, // Gray
      });
      break;

    case 'KEEP_UNCHANGED':
    default:
      // Do nothing
      break;
  }
}
```

---

### 2.2 Sync Operation Semantics

#### Create Operation: Task → Event

**Preconditions:**

- Task has `dueDay` or `dueWithTime` (can't sync tasks without dates)
- User has selected target calendar
- Task is not already bound to an event

**Implementation:**

```typescript
async createEventFromTask(task: Task, calendarId: string, accountId: string): Promise<CalendarEventBinding> {
  // 1. Map task to event
  const event = this.taskToEvent(task);

  // 2. Call calendar API
  const accessToken = await this.tokenStorage.refreshAccessToken(accountId);
  const createdEvent = await this.calendarApi.createEvent(calendarId, event, accessToken);

  // 3. Create binding
  const binding: CalendarEventBinding = {
    id: generateUUID(),
    taskId: task.id,
    calendarEventId: createdEvent.id,
    calendarProviderId: accountId,
    calendarId,
    isBidirectional: true,
    syncDirection: 'both',
    lastSyncedAt: Date.now(),
    lastSyncedHash: this.hashEvent(createdEvent), // Prevent immediate sync loop
    etag: createdEvent.etag, // Store ETag for conflict detection
  };

  // 4. Store binding (via NgRx + Operation Log)
  this.store.dispatch(calendarBindingActions.create({ binding }));

  return binding;
}

private taskToEvent(task: Task): GoogleCalendarEvent {
  const hasTimedDue = task.dueWithTime != null;

  if (hasTimedDue) {
    // Timed event
    const start = new Date(task.dueWithTime!);
    const duration = task.timeEstimate || 3600000; // Default 1h
    const end = new Date(task.dueWithTime! + duration);

    return {
      summary: task.title,
      description: this.taskNotesToEventDescription(task.notes),
      start: {
        dateTime: start.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      reminders: this.mapTaskReminders(task.remindCfg),
    };
  } else {
    // All-day event
    const dueDay = task.dueDay!;
    const endDay = this.addDays(dueDay, 1); // Exclusive end date

    return {
      summary: task.title,
      description: this.taskNotesToEventDescription(task.notes),
      start: { date: dueDay },
      end: { date: endDay },
    };
  }
}
```

#### Update Operation: Detect Changes & Sync

**Challenge:** Detect which side changed (task in SP or event in calendar)

**Solution: State Hashing**

```typescript
interface CalendarEventBinding {
  // ... other fields ...
  lastSyncedHash: string; // Hash of last synced state
  lastSyncedTaskState: string; // JSON of relevant task fields
  lastSyncedEventState: string; // JSON of relevant event fields
  lastSyncedAt: number; // Timestamp of last sync
}

function hashTaskState(task: Task): string {
  const relevant = {
    title: task.title,
    notes: task.notes,
    dueDay: task.dueDay,
    dueWithTime: task.dueWithTime,
    timeEstimate: task.timeEstimate,
    isDone: task.isDone,
  };
  return sha256(JSON.stringify(relevant));
}

function hashEventState(event: GoogleCalendarEvent): string {
  const relevant = {
    summary: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
  };
  return sha256(JSON.stringify(relevant));
}
```

**Sync Decision Logic:**

```typescript
async syncBinding(binding: CalendarEventBinding): Promise<void> {
  // 1. Fetch current state from both sides
  const task = await this.taskService.getById(binding.taskId);
  const event = await this.calendarApi.getEvent(
    binding.calendarId,
    binding.calendarEventId
  );

  // 2. Hash current state
  const currentTaskHash = hashTaskState(task);
  const currentEventHash = hashEventState(event);

  // 3. Compare with last synced state
  const taskChanged = currentTaskHash !== binding.lastSyncedTaskState;
  const eventChanged = currentEventHash !== binding.lastSyncedEventState;

  // 4. Sync decision
  if (!taskChanged && !eventChanged) {
    // No changes - skip
    return;
  }

  if (taskChanged && !eventChanged) {
    // Task changed → update event
    await this.updateEventFromTask(task, event, binding);
  } else if (eventChanged && !taskChanged) {
    // Event changed → update task
    await this.updateTaskFromEvent(event, task, binding);
  } else {
    // CONFLICT: Both changed
    await this.resolveConflict(task, event, binding);
  }
}
```

**Conflict Resolution:**

```typescript
async resolveConflict(
  task: Task,
  event: GoogleCalendarEvent,
  binding: CalendarEventBinding
): Promise<void> {
  // 1. Get timestamps
  const taskUpdatedAt = this.getTaskUpdatedTimestamp(task);
  const eventUpdatedAt = new Date(event.updated).getTime();

  // 2. Last-Write-Wins
  if (eventUpdatedAt > taskUpdatedAt) {
    // Event is newer → update task
    console.log(`Conflict: event newer (${event.updated} > ${new Date(taskUpdatedAt).toISOString()})`);
    await this.updateTaskFromEvent(event, task, binding);
  } else if (taskUpdatedAt > eventUpdatedAt) {
    // Task is newer → update event
    console.log(`Conflict: task newer (${new Date(taskUpdatedAt).toISOString()} > ${event.updated})`);
    await this.updateEventFromTask(task, event, binding);
  } else {
    // Same timestamp → prefer calendar (external source of truth)
    console.log('Conflict: same timestamp → preferring calendar');
    await this.updateTaskFromEvent(event, task, binding);
  }
}

private getTaskUpdatedTimestamp(task: Task): number {
  // SP doesn't store updatedAt on tasks by default!
  // Need to look in Operation Log for last UPDATE operation
  const lastOp = this.opLogService.getLastOperationForEntity('Task', task.id);
  return lastOp?.timestamp || 0;
}
```

**Sync Loop Prevention:**

```typescript
async updateTaskFromEvent(
  event: GoogleCalendarEvent,
  task: Task,
  binding: CalendarEventBinding
): Promise<void> {
  // 1. Update task
  const updatedTask = {
    ...task,
    title: event.summary || '(No title)',
    notes: this.eventDescriptionToTaskNotes(event.description || ''),
    dueDay: event.start.date || null,
    dueWithTime: event.start.dateTime ? new Date(event.start.dateTime).getTime() : null,
    timeEstimate: this.calculateDuration(event.start, event.end),
  };

  // 2. Dispatch update action
  this.store.dispatch(taskActions.update({
    id: task.id,
    changes: updatedTask,
  }));

  // 3. Update binding with new hashes
  const newTaskHash = hashTaskState(updatedTask);
  const newEventHash = hashEventState(event);

  this.store.dispatch(calendarBindingActions.update({
    id: binding.id,
    changes: {
      lastSyncedTaskState: newTaskHash,
      lastSyncedEventState: newEventHash,
      lastSyncedAt: Date.now(),
      etag: event.etag, // Update ETag for next API call
    },
  }));

  // CRITICAL: This binding update must happen in the SAME operation as task update
  // Otherwise, sync loop: task update triggers sync → sees task changed → updates event → ∞
}
```

#### Delete Operation: Cascading vs Unlinking

**Scenario 1: User deletes task in SP**

```
Question: Should calendar event also be deleted?
Options:
  A. Yes, delete event (keeps in sync, but destructive)
  B. No, unlink only (preserves event, but inconsistent)
  C. Ask user (best UX, but interruptive)
```

**Implementation (Option C - Ask User):**

```typescript
async deleteTask(taskId: string): Promise<void> {
  const bindings = await this.getBindingsForTask(taskId);

  if (bindings.length > 0) {
    // Show confirmation dialog
    const userChoice = await this.dialogService.showDialog({
      title: 'Delete Calendar Events?',
      message: `This task is linked to ${bindings.length} calendar event(s). Do you want to delete the event(s) too?`,
      buttons: [
        { label: 'Delete Events', value: 'DELETE', primary: true },
        { label: 'Unlink Only', value: 'UNLINK' },
        { label: 'Cancel', value: 'CANCEL' },
      ],
    });

    if (userChoice === 'CANCEL') {
      return; // Abort deletion
    }

    if (userChoice === 'DELETE') {
      // Delete all linked events
      for (const binding of bindings) {
        await this.calendarApi.deleteEvent(
          binding.calendarId,
          binding.calendarEventId
        );
        await this.deleteBinding(binding.id);
      }
    } else {
      // Unlink only
      for (const binding of bindings) {
        await this.deleteBinding(binding.id);
      }
    }
  }

  // Finally delete task
  this.store.dispatch(taskActions.delete({ id: taskId }));
}
```

**Scenario 2: User deletes event in calendar**

```
Detection: Event ID no longer in calendar API response (404 or absent from list)
Question: Should task also be deleted?
Options:
  A. Yes, delete task (consistent)
  B. No, unlink only (preserve task)
  C. Ask user
```

**Implementation (Auto-decide based on binding origin):**

```typescript
async detectDeletedEvents(): Promise<void> {
  const bindings = await this.getAllBindings();

  for (const binding of bindings) {
    try {
      // Try to fetch event
      await this.calendarApi.getEvent(
        binding.calendarId,
        binding.calendarEventId
      );
    } catch (error) {
      if (error.status === 404) {
        // Event deleted externally
        await this.handleExternalEventDeletion(binding);
      }
    }
  }
}

async handleExternalEventDeletion(binding: CalendarEventBinding): Promise<void> {
  // Decision: If task was auto-created from calendar, delete it
  //           If task was created in SP first, just unlink

  const task = await this.taskService.getById(binding.taskId);
  const wasAutoCreated = task.createdFrom === 'CALENDAR_IMPORT';

  if (wasAutoCreated) {
    // Delete task silently
    this.store.dispatch(taskActions.delete({ id: task.id }));
    await this.deleteBinding(binding.id);

    this.notificationService.show({
      type: 'info',
      message: `Task "${task.title}" deleted (calendar event removed)`,
    });
  } else {
    // Unlink only + notify
    await this.deleteBinding(binding.id);

    this.notificationService.show({
      type: 'warning',
      message: `Calendar event for "${task.title}" was deleted. Task preserved.`,
      action: {
        label: 'Recreate Event',
        callback: () => this.createEventFromTask(task, binding.calendarId, binding.calendarProviderId),
      },
    });
  }
}
```

---

## DEEP DIVE 3: Recurring Events - The Hardest Problem

### 3.1 RRULE Complexity Analysis

**iCalendar RRULE** (RFC 5545) is extremely powerful and complex:

**Basic RRULE:**

```
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10
```

"Every Monday, Wednesday, Friday for 10 occurrences"

**Complex RRULE:**

```
RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20241231T235959Z
```

"Every second Tuesday of the month until Dec 31, 2024"

**Super Complex RRULE:**

```
RRULE:FREQ=YEARLY;BYMONTH=1,7;BYDAY=1MO,1WE,1FR;BYHOUR=9,14;BYMINUTE=0
```

"First Monday, Wednesday, and Friday of January and July, at 9am and 2pm each year"

**SP's RepeatCfg Model:**

```typescript
interface TaskRepeatCfg {
  id: string;
  repeatEvery: number; // Interval (e.g., 2 for "every 2 days")
  repeatType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  startDate?: string; // Optional start date
  endDate?: string; // Optional end date
  monday?: boolean; // Weekly: repeat on Monday
  tuesday?: boolean;
  // ... other weekdays
  // MISSING: No support for "2nd Tuesday" or "last Friday"
  // MISSING: No exception dates (EXDATE)
  // MISSING: No modified instances (RECURRENCE-ID)
}
```

**Mapping Coverage:**

| RRULE Pattern                       | SP RepeatCfg                   | Mappable?                               |
| ----------------------------------- | ------------------------------ | --------------------------------------- |
| `FREQ=DAILY`                        | `DAILY`                        | ✅ Yes                                  |
| `FREQ=WEEKLY;BYDAY=MO,WE,FR`        | `WEEKLY` with weekday flags    | ✅ Yes                                  |
| `FREQ=MONTHLY;INTERVAL=2`           | `MONTHLY` with `repeatEvery=2` | ✅ Yes                                  |
| `FREQ=MONTHLY;BYDAY=2TU`            | N/A                            | ❌ **No** (nth weekday unsupported)     |
| `FREQ=YEARLY;BYMONTH=3,9`           | N/A                            | ❌ **No** (multiple months unsupported) |
| `RRULE + EXDATE`                    | N/A                            | ❌ **No** (exceptions unsupported)      |
| `RECURRENCE-ID` (modified instance) | N/A                            | ❌ **No** (instance edits unsupported)  |

**Coverage Estimate:** SP can map ~40% of real-world RRULE patterns.

---

### 3.2 Recurring Event Sync Strategies

#### Strategy 1: Expand Recurring Events (Flatten)

**Concept:** Treat each instance of a recurring event as a separate task.

**Example:**

```
Calendar: "Team meeting" every Tuesday for 10 weeks
SP: Create 10 individual tasks (one per occurrence)
```

**Pros:**

- ✅ Simple implementation (no recurring logic in sync)
- ✅ Each task can be customized independently (notes, estimates, completion)
- ✅ Works with all RRULE patterns (just expand them)
- ✅ Task deletion doesn't affect other instances

**Cons:**

- ❌ Creates many tasks (clutters task list)
- ❌ No way to update all instances at once
- ❌ If calendar series is updated, hard to detect which tasks to update
- ❌ Can't re-create series in calendar from individual tasks

**Implementation:**

```typescript
async importRecurringEvent(event: GoogleCalendarEvent): Promise<void> {
  // 1. Expand RRULE to instances (next 3 months)
  const instances = this.icalService.expandRecurrence(event, {
    startDate: new Date(),
    endDate: addMonths(new Date(), 3),
  });

  // 2. Create task for each instance
  for (const instance of instances) {
    const task = this.eventToTask(instance);
    task.title = `${event.summary} (${format(instance.start, 'MMM d')})`; // Add date to title

    const createdTask = await this.createTask(task);

    // 3. Create binding
    const binding: CalendarEventBinding = {
      id: generateUUID(),
      taskId: createdTask.id,
      calendarEventId: instance.id, // Instance ID (e.g., "eventid_20240615")
      recurringEventId: event.id,   // Series ID
      calendarProviderId: accountId,
      calendarId,
      syncDirection: 'from-calendar', // One-way only (don't export back)
      lastSyncedAt: Date.now(),
    };

    await this.createBinding(binding);
  }
}
```

**Best For:** Simple use cases where users want calendar events as task reminders, but don't need full bidirectional sync.

---

#### Strategy 2: Master Task with Instances

**Concept:** One "master" task representing the series, with child tasks for exceptions/modifications.

**Example:**

```
Calendar: "Team meeting" every Tuesday, but June 15 moved to Wednesday
SP:
  - Master task: "Team meeting" (repeats weekly on Tuesday)
  - Exception task: "Team meeting (June 15)" (due Wednesday, child of master)
```

**Pros:**

- ✅ Cleaner task list (one master task, not dozens)
- ✅ Can update series by editing master task
- ✅ Supports exceptions (modified instances)
- ✅ Closer to calendar's native model

**Cons:**

- ❌ Complex implementation (need to track series + exceptions)
- ❌ SP doesn't have "exception" concept natively (requires extension)
- ❌ Harder to visualize (master task doesn't show in timeline)
- ❌ Completing master task: what happens to future instances?

**Data Model:**

```typescript
interface RecurringTaskBinding {
  id: string;
  masterTaskId: string; // Master task (series)
  recurringEventId: string; // Calendar series ID
  calendarProviderId: string;
  calendarId: string;

  exceptionTasks: {
    taskId: string; // Exception task ID
    instanceDate: string; // Which instance (YYYY-MM-DD)
    exceptionType: 'MOVED' | 'CANCELLED' | 'MODIFIED';
  }[];
}
```

**Implementation Challenges:**

- Detecting when instance modified vs series modified
- Handling EXDATE (skipped instances) - create "cancelled" task or just skip?
- Bi-directional: User edits exception task, how to update calendar instance?

---

#### Strategy 3: Limit to Simple Recurrence Only (Recommended)

**Concept:** Only sync recurring events that map cleanly to SP's model. Show warning for complex patterns.

**Supported Patterns:**

- ✅ Daily (every N days)
- ✅ Weekly with specific weekdays (e.g., Mon/Wed/Fri)
- ✅ Monthly (every Nth month, on same day)
- ✅ Yearly (every year on same date)
- ✅ With end date or count

**Unsupported Patterns:**

- ❌ "2nd Tuesday of month"
- ❌ "Last Friday of month"
- ❌ Multiple months (e.g., January and July)
- ❌ EXDATE (exception dates)
- ❌ RECURRENCE-ID (modified instances)

**User Experience:**

```
User tries to import "Monthly team meeting (2nd Tuesday)"
SP shows warning:
  "This recurring event uses advanced recurrence rules that Super Productivity
   doesn't support. Would you like to:"
   [ ] Import as individual tasks (next 3 months)
   [ ] Skip this event
   [ ] Import only (don't sync changes back)
```

**Implementation:**

```typescript
function isSimpleRRULE(rrule: string): boolean {
  const parsed = RRule.fromString(rrule);

  // Check for unsupported features
  if (parsed.options.byweekday && typeof parsed.options.byweekday[0] === 'object') {
    // Nth weekday (e.g., 2nd Tuesday)
    return false;
  }

  if (parsed.options.bymonth && parsed.options.bymonth.length > 1) {
    // Multiple months
    return false;
  }

  if (parsed.options.bysetpos) {
    // "Last" or positional selectors
    return false;
  }

  // Simple enough!
  return true;
}

async importRecurringEvent(event: GoogleCalendarEvent): Promise<void> {
  if (!event.recurrence) {
    // Not recurring - use regular import
    return this.importSimpleEvent(event);
  }

  const rrule = event.recurrence[0]; // RRULE:...

  if (!this.isSimpleRRULE(rrule)) {
    // Show warning dialog
    const userChoice = await this.showComplexRecurrenceDialog(event);

    if (userChoice === 'EXPAND') {
      return this.expandAndImportInstances(event);
    } else if (userChoice === 'SKIP') {
      return;
    }
    // Otherwise continue with import-only (no sync back)
  }

  // Create recurring task
  const repeatCfg = this.rruleToRepeatCfg(rrule);
  const task = this.eventToTask(event);
  task.repeatCfgId = repeatCfg.id;

  await this.createTask(task);
  await this.createRepeatCfg(repeatCfg);

  // Create binding
  const binding: CalendarEventBinding = {
    id: generateUUID(),
    taskId: task.id,
    calendarEventId: event.id,
    recurringEventId: event.id,
    isRecurring: true,
    syncDirection: this.isSimpleRRULE(rrule) ? 'both' : 'from-calendar',
    // ...
  };

  await this.createBinding(binding);
}
```

**Bidirectional Sync for Simple Recurrence:**

```typescript
// Task → Event (update series)
async updateRecurringEventFromTask(task: Task, binding: RecurringTaskBinding): Promise<void> {
  const repeatCfg = await this.getRepeatCfg(task.repeatCfgId!);
  const rrule = this.repeatCfgToRRULE(repeatCfg);

  await this.calendarApi.updateEvent(binding.recurringEventId, {
    summary: task.title,
    description: this.taskNotesToEventDescription(task.notes),
    recurrence: [rrule],
    // IMPORTANT: Don't update start/end (affects all instances)
  });
}

// Event → Task (update series)
async updateTaskFromRecurringEvent(event: GoogleCalendarEvent, task: Task): Promise<void> {
  const rrule = event.recurrence[0];
  const repeatCfg = this.rruleToRepeatCfg(rrule);

  this.store.dispatch(taskActions.update({
    id: task.id,
    changes: {
      title: event.summary,
      notes: this.eventDescriptionToTaskNotes(event.description),
    },
  }));

  this.store.dispatch(taskRepeatCfgActions.update({
    id: task.repeatCfgId,
    changes: repeatCfg,
  }));
}
```

**Recommendation:** Strategy 3 (limit to simple recurrence) for MVP. Add Strategy 2 (master + exceptions) in later version if user demand justifies complexity.

---

## DEEP DIVE 4-10: Remaining Hurdles (Condensed)

Due to document length, the remaining deep dives are condensed. Key implementation details for each:

### DEEP DIVE 4: Real-time Updates & Polling Optimization

**Google Calendar Push Notifications:**

```typescript
// 1. Create push notification channel
const channel = await fetch(
  'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: generateUUID(), // Unique channel ID
      type: 'web_hook',
      address: 'https://your-server.com/calendar-webhook', // MUST be HTTPS
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days (max)
    }),
  },
);

// 2. Webhook endpoint receives notifications
app.post('/calendar-webhook', async (req, res) => {
  const channelId = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state']; // "sync", "exists", "not_exists"

  if (resourceState === 'exists') {
    // Calendar changed - trigger sync for this user
    await triggerSyncForChannel(channelId);
  }

  res.sendStatus(200); // Must respond quickly
});

// 3. Renew channel every 6 days (expires after 7)
setInterval(
  async () => {
    await renewAllChannels();
  },
  6 * 24 * 60 * 60 * 1000,
);
```

**Challenge:** Webhooks require server infrastructure, but SP is peer-to-peer.
**Solution:** Only use webhooks when SuperSync server available. Fall back to polling otherwise.

---

### DEEP DIVE 5: API Rate Limits & Incremental Sync

**Google Calendar Incremental Sync:**

```typescript
interface SyncState {
  calendarId: string;
  syncToken: string | null;  // Incremental sync token
  lastFullSync: number;       // Timestamp of last full sync
}

async syncCalendar(calendarId: string): Promise<void> {
  const syncState = await this.getSyncState(calendarId);

  let params: any = {
    calendarId,
    maxResults: 250,
  };

  if (syncState.syncToken) {
    // Incremental sync - only fetch changes
    params.syncToken = syncState.syncToken;
  } else {
    // Full sync - fetch all events
    params.timeMin = new Date().toISOString();
    params.timeMax = addMonths(new Date(), 3).toISOString();
  }

  try {
    const response = await this.calendarApi.events.list(params);

    // Process events
    for (const event of response.items) {
      if (event.status === 'cancelled') {
        await this.handleDeletedEvent(event.id);
      } else {
        await this.syncEvent(event);
      }
    }

    // Save new sync token for next incremental sync
    if (response.nextSyncToken) {
      await this.saveSyncState({
        calendarId,
        syncToken: response.nextSyncToken,
        lastFullSync: Date.now(),
      });
    }
  } catch (error) {
    if (error.status === 410) {
      // Sync token expired - do full sync
      syncState.syncToken = null;
      return this.syncCalendar(calendarId); // Retry without token
    }
    throw error;
  }
}
```

**Batch API for Multiple Calendars:**

```typescript
// Instead of 10 separate API calls:
for (const calendar of calendars) {
  await fetchEvents(calendar.id); // 10 API calls
}

// Use batch request (1 API call):
const batch = this.calendarApi.newBatch();

for (const calendar of calendars) {
  batch.add(this.calendarApi.events.list({ calendarId: calendar.id }));
}

const responses = await batch.execute(); // Single API call with 10 sub-requests
```

**Rate Limit Handling:**

```typescript
async executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        // Rate limited
        const retryAfter = parseInt(error.headers['retry-after'] || '60', 10);
        console.warn(`Rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue; // Retry
      }

      if (error.status === 403 && error.error?.errors?.[0]?.reason === 'rateLimitExceeded') {
        // Quota exhausted
        const backoff = Math.pow(2, attempt) * 1000; // Exponential backoff
        await sleep(backoff);
        continue;
      }

      throw error; // Other errors
    }
  }

  throw new Error('Max retries exceeded');
}
```

---

### DEEP DIVE 6: Subtasks & Nested Structures

**Problem:** SP has subtasks (nested hierarchy), calendars don't.

**Solutions:**

**Option 1: Flatten Subtasks**

```
SP:
  - Task: "Launch product"
    - Subtask: "Design landing page"
    - Subtask: "Write copy"
    - Subtask: "Set up analytics"

Calendar:
  - Event: "Launch product - Design landing page"
  - Event: "Launch product - Write copy"
  - Event: "Launch product - Set up analytics"
```

**Option 2: Only Sync Parent**

```
SP:
  - Task: "Launch product" (with 3 subtasks)

Calendar:
  - Event: "Launch product"
    Description: "Subtasks: Design landing page, Write copy, Set up analytics"
```

**Option 3: Don't Sync Tasks with Subtasks**

- Show warning: "This task has subtasks. Calendar sync not available."
- User must remove subtasks or skip sync

**Recommendation:** Option 2 (only sync parent) - preserves hierarchy information without creating event explosion.

---

### DEEP DIVE 7: Tags/Projects → Calendars Mapping

**Challenge:** Should SP projects map to calendar selection?

**Mapping Strategy:**

```typescript
// User configuration
interface ProjectCalendarMapping {
  projectId: string;
  defaultCalendarId: string;        // Where to create events for this project
  syncDirection: 'import' | 'export' | 'both';
}

// When creating event from task
async exportTaskToCalendar(task: Task): Promise<void> {
  let targetCalendarId: string;

  if (task.projectId) {
    // Use project's mapped calendar
    const mapping = await this.getProjectCalendarMapping(task.projectId);
    targetCalendarId = mapping?.defaultCalendarId || this.defaultCalendarId;
  } else {
    // No project - use default calendar
    targetCalendarId = this.defaultCalendarId;
  }

  await this.createEventFromTask(task, targetCalendarId);
}

// When importing event to task
async importEventToTask(event: GoogleCalendarEvent, calendarId: string): Promise<void> {
  // Find project mapped to this calendar
  const mapping = await this.getCalendarProjectMapping(calendarId);

  const task = this.eventToTask(event);

  if (mapping) {
    task.projectId = mapping.projectId;
  }

  await this.createTask(task);
}
```

**UI Configuration:**

```
Settings > Calendar Sync > Project Mapping

Project "Work" → Calendar "Work Calendar" (Google)
  ✓ Auto-import events from this calendar
  ✓ Export tasks from this project to calendar

Project "Personal" → Calendar "Personal" (Google)
  ✓ Auto-import events from this calendar
  ✓ Export tasks from this project to calendar

Project "Side Project" → No calendar mapping
  (Tasks in this project won't sync to calendar)
```

---

### DEEP DIVE 8: Timezone Handling

**Challenge:** Calendar events have explicit timezones, SP tasks use device local time.

**Problems:**

1. User creates task at "2pm" in New York, syncs to calendar as "2pm EST"
2. User travels to California, opens SP, task shows "2pm" but calendar shows "11am PST" (correct)
3. Sync conflict: SP thinks task is at 2pm local, calendar says 11am local

**Solution: Store timezone in task**

```typescript
interface Task {
  dueWithTime: number | null; // UTC timestamp
  dueWithTimeTimezone?: string | null; // IANA timezone (e.g., "America/New_York")
}

// When creating event from task
function taskToEvent(task: Task): GoogleCalendarEvent {
  const start = new Date(task.dueWithTime!);
  const timezone =
    task.dueWithTimeTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    start: {
      dateTime: start.toISOString(),
      timeZone: timezone, // Use task's stored timezone
    },
    // ...
  };
}

// When importing event to task
function eventToTask(event: GoogleCalendarEvent): Task {
  return {
    dueWithTime: new Date(event.start.dateTime).getTime(),
    dueWithTimeTimezone: event.start.timeZone, // Store event's timezone
    // ...
  };
}
```

**Display Handling:**

```typescript
// Always display in user's current timezone
function displayDueTime(task: Task): string {
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const taskTimezone = task.dueWithTimeTimezone || userTimezone;

  if (taskTimezone !== userTimezone) {
    // Show original timezone for clarity
    return `2:00 PM EST (11:00 AM PST)`;
  } else {
    return `2:00 PM`;
  }
}
```

---

### DEEP DIVE 9: Offline Operations & Sync Queue

**Challenge:** User edits task while offline, then reconnects. How to sync changes to calendar?

**Solution: Persistent Sync Queue**

```typescript
interface PendingCalendarOperation {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  taskId: string;
  calendarEventId?: string;
  calendarId: string;
  accountId: string;
  payload: any;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

class CalendarSyncQueue {
  async enqueueOperation(op: PendingCalendarOperation): Promise<void> {
    // Store in IndexedDB
    await this.db.put('pending_calendar_ops', op);

    // Try to process immediately if online
    if (navigator.onLine) {
      await this.processQueue();
    }
  }

  async processQueue(): Promise<void> {
    const pending = await this.db.getAll('pending_calendar_ops');

    for (const op of pending) {
      try {
        await this.executeOperation(op);

        // Success - remove from queue
        await this.db.delete('pending_calendar_ops', op.id);
      } catch (error) {
        // Failed - increment retry count
        op.retryCount++;
        op.lastError = error.message;

        if (op.retryCount >= 5) {
          // Give up after 5 retries
          await this.moveToFailedQueue(op);
        } else {
          // Retry later
          await this.db.put('pending_calendar_ops', op);
        }
      }
    }
  }

  async executeOperation(op: PendingCalendarOperation): Promise<void> {
    const accessToken = await this.tokenStorage.refreshAccessToken(op.accountId);

    switch (op.type) {
      case 'CREATE':
        await this.calendarApi.createEvent(op.calendarId, op.payload, accessToken);
        break;

      case 'UPDATE':
        await this.calendarApi.updateEvent(
          op.calendarId,
          op.calendarEventId!,
          op.payload,
          accessToken,
        );
        break;

      case 'DELETE':
        await this.calendarApi.deleteEvent(
          op.calendarId,
          op.calendarEventId!,
          accessToken,
        );
        break;
    }
  }
}

// Listen for online event
window.addEventListener('online', () => {
  this.syncQueue.processQueue();
});
```

**UI Indicator:**

```
Sync Status: ⚠️ 3 changes pending
  - Created event for "Write blog post"
  - Updated event for "Team meeting"
  - Deleted event for "Old task"

[ Retry Now ] [ View Details ]
```

---

### DEEP DIVE 10: Testing Strategy

**Unit Tests:**

```typescript
describe('TaskToEventMapper', () => {
  it('should map all-day task to all-day event', () => {
    const task: Task = {
      id: '1',
      title: 'Submit report',
      dueDay: '2024-06-15',
      dueWithTime: null,
      timeEstimate: null,
    };

    const event = taskToEvent(task);

    expect(event.start.date).toBe('2024-06-15');
    expect(event.end.date).toBe('2024-06-16'); // Exclusive end
    expect(event.start.dateTime).toBeUndefined();
  });

  it('should map timed task to timed event', () => {
    const task: Task = {
      id: '1',
      title: 'Team meeting',
      dueDay: null,
      dueWithTime: new Date('2024-06-15T14:00:00Z').getTime(),
      timeEstimate: 3600000, // 1 hour
    };

    const event = taskToEvent(task);

    expect(event.start.dateTime).toBe('2024-06-15T14:00:00.000Z');
    expect(event.end.dateTime).toBe('2024-06-15T15:00:00.000Z');
  });

  it('should use default duration if timeEstimate is null', () => {
    const task: Task = {
      id: '1',
      title: 'Call client',
      dueWithTime: new Date('2024-06-15T10:00:00Z').getTime(),
      timeEstimate: null, // No estimate
    };

    const event = taskToEvent(task);

    const duration =
      new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime();
    expect(duration).toBe(3600000); // Default 1 hour
  });
});
```

**Integration Tests:**

```typescript
describe('Calendar Sync Integration', () => {
  let testAccount: CalendarAccount;
  let testCalendarId: string;

  beforeAll(async () => {
    // Authenticate with test Google account
    testAccount = await authenticateTestAccount();
    testCalendarId = 'primary';
  });

  afterAll(async () => {
    // Clean up test events
    await cleanupTestEvents(testCalendarId);
  });

  it('should create event from task and sync back', async () => {
    // 1. Create task in SP
    const task = await createTestTask({
      title: 'Integration test event',
      dueWithTime: Date.now() + 86400000, // Tomorrow
      timeEstimate: 1800000, // 30 min
    });

    // 2. Export to calendar
    const binding = await exportTaskToCalendar(task, testCalendarId, testAccount.id);

    // 3. Verify event exists in Google Calendar
    const event = await fetchEventFromCalendar(binding.calendarEventId);
    expect(event.summary).toBe('Integration test event');

    // 4. Update event in calendar
    await updateEventInCalendar(binding.calendarEventId, {
      summary: 'Updated title',
    });

    // 5. Trigger sync
    await syncCalendar(testCalendarId);

    // 6. Verify task updated in SP
    const updatedTask = await getTask(task.id);
    expect(updatedTask.title).toBe('Updated title');

    // 7. Clean up
    await deleteTask(task.id);
    await deleteEventFromCalendar(binding.calendarEventId);
  });

  it('should handle conflicts with LWW', async () => {
    const task = await createTestTask({
      title: 'Conflict test',
      dueWithTime: Date.now(),
    });

    const binding = await exportTaskToCalendar(task, testCalendarId, testAccount.id);

    // Simulate concurrent updates
    await Promise.all([
      updateTask(task.id, { title: 'Updated in SP' }),
      updateEventInCalendar(binding.calendarEventId, { summary: 'Updated in Calendar' }),
    ]);

    // Sync should resolve conflict with LWW
    await syncCalendar(testCalendarId);

    // One of the changes should win (depends on timestamps)
    const finalTask = await getTask(task.id);
    expect(['Updated in SP', 'Updated in Calendar']).toContain(finalTask.title);
  });
});
```

**E2E Tests with Playwright:**

```typescript
test('calendar sync workflow', async ({ page }) => {
  // 1. Authenticate with Google Calendar
  await page.goto('http://localhost:4200/settings/calendar');
  await page.click('button:has-text("Add Google Account")');

  // OAuth flow (handled by test account credentials)
  await handleOAuthFlow(page, {
    email: process.env.TEST_GOOGLE_EMAIL!,
    password: process.env.TEST_GOOGLE_PASSWORD!,
  });

  // 2. Enable calendar sync
  await page.check('input[name="sync-enabled"]');
  await page.selectOption('select[name="default-calendar"]', 'primary');

  // 3. Create task with due date
  await page.goto('http://localhost:4200');
  await page.fill('input[placeholder="Add task"]', 'E2E test task');
  await page.click('button:has-text("Set due date")');
  await page.click('[data-testid="tomorrow"]');
  await page.press('input[placeholder="Add task"]', 'Enter');

  // 4. Export to calendar
  await page.click('[data-testid="task-actions"]');
  await page.click('button:has-text("Export to Calendar")');

  // 5. Verify success notification
  await expect(page.locator('text=Event created')).toBeVisible();

  // 6. Verify calendar icon appears on task
  await expect(page.locator('[data-testid="calendar-icon"]')).toBeVisible();

  // 7. Open calendar in new tab and verify event exists
  const calendarPage = await page.context().newPage();
  await calendarPage.goto('https://calendar.google.com');
  await expect(calendarPage.locator('text=E2E test task')).toBeVisible();
});
```

---

## Conclusion: Implementation Roadmap

Given the depth of these technical hurdles, here's a pragmatic phased approach:

### Phase 1: Read-Only Enhancement (2-3 weeks)

- ✅ Improve current iCal integration UI
- ✅ Add task binding tracking
- ✅ Show calendar icon on imported tasks
- ✅ "View in calendar" link

### Phase 2: One-Way Export (6-8 weeks)

- Implement Google OAuth (Electron + Web + Mobile)
- Add "Export to Calendar" action
- Create events from tasks (simple mapping)
- Handle update propagation (task → event)
- No conflict resolution needed (one-way)

### Phase 3: Bidirectional Sync (12-16 weeks)

- Implement change detection (state hashing)
- Add conflict resolution (LWW + manual)
- Support simple recurring events
- Add sync queue for offline operations
- Implement incremental sync (syncToken)
- Add comprehensive testing

### Optional Future Phases:

- Outlook/Office 365 provider
- Complex recurring event support (master + exceptions)
- Webhook support (when SuperSync available)
- Subtask flattening/embedding
- Advanced project-calendar mapping

**Confidence Level:** 75% - The architecture is sound and SP's existing sync infrastructure provides a strong foundation. Main risks are recurring events (hardest problem) and OAuth token management across platforms. Recommend building a prototype for Phase 2 before committing to full bidirectional sync.
