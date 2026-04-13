# Google Calendar Provider — Design Document

> **Status: Planned**

## Overview

Add a Google Calendar provider (`GOOGLE_CALENDAR`) to Super Productivity with two-way event sync via the Google Calendar REST API. Authentication uses a hybrid approach: an auth proxy by default with an option for user-provided OAuth credentials.

## Decisions

| Decision               | Choice                                                      | Rationale                                                                            |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Integration level      | Two-way event sync (phased)                                 | Full value requires writing back status changes                                      |
| Auth approach          | Hybrid: auth proxy default + user-provided option           | Best UX for most users; self-hosters/privacy users can opt out of proxy              |
| API layer              | Google Calendar REST API v3                                 | Better documented, more reliable than Google's CalDAV endpoint; avoids CalDAV quirks |
| Initial sync direction | Google → SP first, status sync back                         | Reduce scope for first version; no SP → Google event creation yet                    |
| Auth proxy hosting     | Decide at implementation time                               | Proxy is stateless and thin enough to move between hosting options                   |
| Token storage          | Reuse existing `SyncCredentialStore` (IndexedDB `sup-sync`) | Proven pattern from Dropbox sync                                                     |

---

## Why OAuth Is Mandatory

Google Calendar API requires OAuth 2.0. No alternative exists — even Google's CalDAV endpoint requires OAuth. This is the core complexity of the feature.

### Google-Specific Constraints

1. **OOB flow deprecated (2022)** — The manual "copy this code" pattern used by Dropbox sync does not work with Google. A redirect-based flow is required.
2. **Per-platform OAuth client types** — Google registers separate OAuth clients for web, desktop, Android, and iOS, each with different redirect mechanisms.
3. **Calendar scope is "restricted"** — Requires Google's full app verification process (privacy policy, security assessment, demo video). Unverified apps are limited to 100 users with a warning screen.
4. **Open-source visibility** — Any `client_secret` embedded in source is public. Desktop/mobile clients are treated as "public clients" (PKCE, no secret), but web clients traditionally need one.
5. **Self-hosted web instances** — Different origins make a single registered redirect URI insufficient for web.

---

## Authentication Architecture

### Hybrid Approach

**Default mode (proxy):** A stateless auth proxy handles OAuth token exchange, keeping `client_secret` server-side. All platforms use the same proxy. Calendar data never touches the proxy — only OAuth tokens during exchange/refresh.

**Custom mode:** Users provide their own Google Cloud OAuth credentials. The app performs PKCE flows directly with Google. Intended for self-hosted instances and privacy-conscious users.

### Auth Proxy Design

The proxy is intentionally minimal — stateless, no database, no sessions, no user accounts.

**Endpoints:**

```
POST /auth/google/token-exchange
  Input:  { code, code_verifier, redirect_uri, platform }
  Action: Exchanges auth code for tokens using client_secret
  Output: { access_token, refresh_token, expires_in }

POST /auth/google/token-refresh
  Input:  { refresh_token }
  Action: Refreshes access token using client_secret
  Output: { access_token, expires_in }
```

**Hosting options (to be decided):**

- Routes added to existing SuperSync server
- Standalone serverless functions (Cloudflare Workers, Vercel, AWS Lambda)
- Dedicated micro-service

### Client Auth Flow

```
1. Client generates PKCE code_verifier + code_challenge
2. Client opens Google consent screen URL (with code_challenge)
3. Google redirects to proxy with auth code
4. Proxy exchanges code for tokens (using client_secret + code_verifier)
5. Proxy redirects to app with tokens:
   - Electron: custom protocol (super-productivity://oauth/google)
   - Web: redirect to app origin
   - Android/iOS: deep link (com.super-productivity.app://oauth/google)
6. Client stores tokens locally in SyncCredentialStore
7. Client calls Google Calendar API directly (proxy not involved)
8. On 401: client calls proxy /token-refresh for new access_token
```

### Per-Platform Redirect Handling

| Platform | Proxy mode                         | Custom credentials mode                                    |
| -------- | ---------------------------------- | ---------------------------------------------------------- |
| Electron | Proxy → custom protocol redirect   | Local loopback server (`http://127.0.0.1:<port>/callback`) |
| Web/PWA  | Proxy → redirect to app origin     | Standard redirect (user registers their own origin)        |
| Android  | Proxy → deep link                  | Deep link with user's own client ID                        |
| iOS      | Proxy → deep link / universal link | Deep link with user's own client ID                        |

### Auth Infrastructure (shared, reusable)

Located at `src/app/core/oauth/` — designed to support future providers (Outlook, etc.):

```
src/app/core/oauth/
  google-oauth.service.ts     # Google-specific OAuth config + PKCE flow
  oauth-proxy.service.ts      # Routes token exchange through auth proxy
  oauth-credential.store.ts   # Extends/reuses SyncCredentialStore
```

---

## Provider Structure

New provider at `src/app/features/issue/providers/google-calendar/`:

```
google-calendar/
  google-calendar.model.ts          # GoogleCalendarCfg, event type mappings
  google-calendar.const.ts          # Scopes, API URLs, defaults
  google-calendar-api.service.ts    # REST API calls (events CRUD, calendar listing)
  google-calendar.service.ts        # Extends BaseIssueProviderService
  google-calendar-sync-adapter.ts   # Two-way sync logic
  google-calendar-cfg/              # Settings UI component
```

### Config Model

```typescript
interface GoogleCalendarCfg extends BaseIssueProviderCfg {
  calendarIds: string[];
  authMode: 'proxy' | 'custom';
  customClientId?: string;
  customClientSecret?: string;
  syncDirection: 'read-only' | 'two-way';
  checkUpdatesEvery: number;
}
```

---

## Data Mapping

### Google → Super Productivity

| Google Calendar Event          | Super Productivity                          |
| ------------------------------ | ------------------------------------------- |
| `summary`                      | Task title                                  |
| `description`                  | Task notes                                  |
| `start` / `end`                | `CalendarIntegrationEvent` start / duration |
| `status` (confirmed/cancelled) | Task done state                             |
| `updated`                      | Last-modified timestamp for sync            |

### Super Productivity → Google (Phase 2+)

| Super Productivity | Google Calendar Event                      |
| ------------------ | ------------------------------------------ |
| Task marked done   | Event status → cancelled (or configurable) |
| Title changed      | `summary` updated                          |
| Notes changed      | `description` updated                      |

### What Does NOT Sync

- Sub-tasks (no Google Calendar equivalent)
- Time tracking data
- Tags, priorities, estimates — SP-specific concepts

---

## Sync Strategy

Follows the pattern established by `CaldavSyncAdapterService`:

1. **Poll-based** on configurable interval (default: 5 minutes)
2. **Incremental sync** using Google's `syncToken` — only returns events changed since last sync, much more efficient than full re-fetch
3. **Conflict resolution** via `updated` timestamps (last-write-wins, server as authority)
4. **Sync state** stored per-provider-instance in config

---

## Implementation Phases

### Phase 1: Auth + Read-Only Import

- Google OAuth service with PKCE + proxy support
- Platform-specific redirect handling (Electron, Web, Capacitor)
- Fetch events from Google Calendar API
- Display as `CalendarIntegrationEvent` (like existing ICAL provider)
- Settings UI for connecting Google account, selecting calendars

### Phase 2: Status Sync Back to Google

- Mark events as completed/cancelled when SP tasks are done
- Incremental sync using `syncToken`
- Conflict detection via `updated` timestamps
- Error handling for API rate limits, revoked permissions

### Phase 3: Full Two-Way (Future)

- Create Google Calendar events from SP tasks
- Bidirectional field sync (title, description, time)
- Consider: should SP time tracking update event duration?

---

## Open Questions

1. **Google app verification timeline** — Restricted scope verification can take weeks/months. Should we apply early or build with an unverified app first (100-user limit)?
2. **Multiple Google accounts** — Should users be able to connect more than one Google account? The provider model supports multiple instances, but the OAuth flow needs to handle account switching.
3. **Recurring events** — Google Calendar has its own recurrence model. How do recurring events map to SP tasks? One task per occurrence, or one task for the series?
4. **Event deletion** — When a Google event is deleted, should the corresponding SP task be deleted, archived, or just marked?
5. **Proxy rate limiting** — The proxy needs rate limiting to prevent abuse. What limits are reasonable?

---

## References

- [Google Calendar API v3 docs](https://developers.google.com/calendar/api/v3/reference)
- [Google OAuth 2.0 for mobile/desktop](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google app verification requirements](https://support.google.com/cloud/answer/9110914)
- Existing CalDAV two-way sync: `src/app/features/issue/providers/caldav/caldav-sync-adapter.service.ts`
- Existing Dropbox OAuth: `src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts`
- Existing credential store: `src/app/op-log/sync-providers/credential-store.service.ts`
- General calendar sync analysis: `docs/long-term-plans/calendar-two-way-sync-technical-analysis.md`
