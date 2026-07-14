# Microsoft 365 Calendar provider (Outlook without an iCal URL)

Status: **proposed, revised after repository audit and adversarial Codex review** ·
2026-07-14

## Decision summary

This is feasible, but it is not a mechanical rename of the Google Calendar plugin.
Microsoft Graph event mapping is the easy half. The harder half is operating a
multitenant Microsoft Entra application reliably in university tenants and closing
several generic plugin-host gaps around OAuth, polling, throttling, all-day dates, and
device-local credentials.

The smallest responsible product is a bundled, **read-only, Electron-only Microsoft
365 Calendar provider for work/school accounts**. It should let a user authenticate
without an iCal URL, select their own calendars, see events in Schedule/Planner,
manually turn an event into a task, and open the original event in Outlook.

Do not begin the production implementation until the Phase 0 tenant gate succeeds.
Code cannot bypass a university's consent, Conditional Access, or enterprise-app
policy.

### Difficulty and estimate

| Outcome                                                     |                                  Estimate | Confidence                        |
| ----------------------------------------------------------- | ----------------------------------------: | --------------------------------- |
| Disposable Graph/tenant feasibility spike                   |                      1–2 engineering days | Medium; tenant policy is external |
| Production Electron MVP, including host hardening and tests | 17–26 additional focused engineering days | Medium                            |
| Total engineering effort                                    |          About 4–6 weeks for one engineer | Medium                            |
| Microsoft publisher/admin approval                          |                              Not included | Unbounded external elapsed time   |

A demo that only logs in and lists events could be built in a few days. Calling that
production-ready would hide the main risks found in review: unsupported mobile flows
currently start OAuth, all calendar providers can be polled at the fastest provider's
cadence, linked tasks cause per-task Graph requests, refresh-token persistence is not
transactional, and synced calendar IDs can meet credentials for a different local
account.

## User problem

Some universities require Outlook/Microsoft 365 but disable calendar publication, so
the existing URL-based iCal integration cannot be used. The requested workflow is
personal planning, not team calendar management:

1. Sign in with a university Microsoft 365 account.
2. Select one or more personal calendars.
3. See upcoming events beside tasks when planning a realistic day.
4. Convert an event into a task when useful.
5. Open the source event in Outlook.

This fits Super Productivity's deep-work scope as an optional integration. It must be
quiet by default, read-only, least-privilege, and safe when offline or disconnected.

## What can be reused

The repository already has most of the structural pieces:

- `packages/plugin-dev/google-calendar-provider/` demonstrates a bundled OAuth
  agenda provider, dynamic calendar selection, recurrence expansion through a remote
  API, event-to-task mapping, and provider-local tests.
- `src/app/plugins/oauth/` supplies authorization-code + PKCE flows, Electron
  loopback callbacks, token refresh, and local IndexedDB token storage.
- `packages/plugin-api/src/issue-provider-types.ts` already represents agenda events
  with start, duration, all-day, due-time, and source URL fields.
- `src/app/features/calendar-integration/` already combines plugin events with iCal
  events and exposes task creation and source-link actions.
- `packages/plugin-dev/scripts/build-all.js`, `src/app/plugins/plugin.service.ts`, and
  `electron/bundled-plugin-ids.test.cjs` define the bundled-plugin build and reserved-ID
  path.

The provider should extend these building blocks. It should not introduce a second
calendar framework, a Microsoft SDK, a backend token broker, or a new root dependency.

## Corrections made during the double-check

The initial outline was too optimistic in the following ways. These are requirements,
not optional polish:

- Missing mobile client IDs do **not** currently disable native OAuth. The host needs
  an explicit additive platform-capability contract.
- Agenda refresh currently uses the minimum interval across all calendar providers.
  A one-minute Google provider can therefore make a five-minute Microsoft provider
  call Graph every minute.
- Agenda-view configurations hide the auto-poll setting while the default remains on.
  Imported plugin-calendar tasks can consequently generate one `getById` request per
  task on every issue-poll cycle.
- `/me/calendars` can expose locally represented shared/delegated calendars. The MVP
  must filter to calendars owned by the signed-in mailbox instead of merely hiding a
  label in the UI.
- Agenda loading and issue search are independent host paths. A claim of “local
  search” requires an explicitly keyed provider cache and in-flight deduplication.
- Refreshed token persistence must finish before a new access token is returned, and
  a late refresh must not resurrect credentials after disconnect or overwrite a newer
  login.
- Transient refresh failures and terminal reauthentication failures need different
  state transitions. A 429, timeout, offline error, or 5xx must not delete a usable
  refresh token.
- Microsoft requires clients to respect `Retry-After`. A small typed error extension
  is preferable to blind sleeps or exposing every response header as a permanent
  plugin API.
- Calendar selection is synced, while OAuth credentials are local and keyed once per
  plugin. The provider must detect calendar IDs from a different account and explain
  that all configurations on one device share one Microsoft login.
- An all-day event needs an explicit `dueDay` date string. Reconstructing it from a
  UTC millisecond timestamp can shift it by a day when mailbox and device time zones
  differ.
- Event metadata is cached unencrypted in local storage. Authentication changes must
  purge the affected provider's cache, while transient offline failures may retain it.
- Plugin translations require `i18n.languages: ["en"]`, `i18n/en.json`, build copying,
  and `PluginAPI.translate`; copying the current Google scaffold literally would miss
  those requirements.

## MVP scope

### Included

- Microsoft 365 work/school accounts in the global Microsoft cloud.
- Super Productivity Electron builds on Windows, macOS, and Linux.
- One Microsoft account per plugin per device.
- Up to 10 calendars owned by the signed-in mailbox.
- A fixed event window from 7 days before local today through 28 days after local
  today.
- Single events, recurring occurrences/exceptions, and multi-day/all-day events.
- Schedule/Planner display, bounded title search over the provider cache, manual task
  creation, and opening the Outlook web link.
- Read-only delegated permission `Calendars.ReadBasic` plus `offline_access`.
- Stale cached agenda data during transient offline/server failures, clearly
  distinguishable from a reconnect-required state.

### Explicitly excluded

- Creating, editing, moving, completing, or deleting Outlook events.
- Time-block write-back and Google feature parity.
- Event bodies/notes, attachments, extensions, attendees, or meeting chat data.
- Shared, delegated, group, room, or resource calendars.
- Personal Outlook.com accounts, guest-only accounts, and national/sovereign clouds.
- Web, Android, and iOS support.
- Multiple Microsoft accounts on one device.
- Automatic backlog import.
- Automatic refresh of imported tasks. The task is a manually created planning
  snapshot with a source link; this avoids an unbounded per-task Graph polling path.

The exclusions should appear in the setup copy and documentation, not only in code
comments.

## Architecture

```text
Microsoft Entra authorization (system browser + PKCE)
        |
        v
device-local OAuth token store (one account per plugin, never synced)
        |
        v
Microsoft provider -> validated Graph client -> bounded in-memory event cache
        |                                      |
        |                                      +-> local title search / getById reuse
        v
existing issue-provider agenda contract
        |
        v
calendar integration cache -> Schedule/Planner -> manual task snapshot
```

Provider configuration, including selected calendar IDs, remains part of synced issue
provider state. Tokens and the provider's event cache remain device-local. On each
device, the selected IDs must be reconciled against the calendars returned for that
device's connected account before Graph event calls begin.

## Fixed contracts and limits

These values make “bounded” testable and avoid adding settings before a real workflow
requires them:

| Concern                      | MVP rule                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant endpoint              | `organizations` authorization/token endpoints                                                                                                                 |
| Delegated scopes             | `offline_access https://graph.microsoft.com/Calendars.ReadBasic`                                                                                              |
| Calendar ownership           | Compare each calendar owner to the default calendar's owner; if ownership is missing/ambiguous, expose only the default calendar and fail closed for the rest |
| Selected calendars           | 1 required, 10 maximum                                                                                                                                        |
| Event window                 | Local start-of-day −7 days through local start-of-day +28 days, sent as explicit-offset instants                                                              |
| Graph page size              | `$top=100`                                                                                                                                                    |
| Pagination                   | At most 5 pages per calendar and 2,000 mapped events total                                                                                                    |
| Calendar request concurrency | 2                                                                                                                                                             |
| Request timeout              | 30 seconds                                                                                                                                                    |
| Agenda cadence               | 5 minutes per Microsoft provider; manual refresh may bypass the due time                                                                                      |
| Overlap                      | One in-flight fetch per account/config cache key; later automatic ticks reuse it                                                                              |
| Search                       | Case-insensitive title search, 50 results maximum, over the same bounded cache                                                                                |
| Retry without `Retry-After`  | At most 2 retries using approximately 1 s and 2 s exponential delay plus jitter                                                                               |
| Retry with `Retry-After`     | Do not retry before the supplied time; retry once only when the wait is at most 30 s, otherwise stop and retain stale data                                    |
| Timed event identity         | Composite, reversible encoding of case-sensitive calendar ID + immutable event ID                                                                             |
| All-day identity/date        | Preserve `YYYY-MM-DD` start and exclusive end dates separately from numeric schedule instants                                                                 |
| Content limits               | Validate response shapes; cap IDs/URLs/titles to documented local constants before mapping                                                                    |

If a cap is reached, fail that refresh with a safe localized “calendar result limit
reached” error and keep the last complete provider snapshot. Do not silently replace a
complete cache with a truncated one.

### Failure semantics

- **Offline, timeout, 429, or 5xx:** keep tokens and the last complete agenda cache;
  retry only within the table's budget.
- **One selected calendar returns 403/404:** fail the refresh and retain the last
  complete snapshot; setup/test-connection identifies the inaccessible calendar and
  requires reselection. This is intentionally all-or-nothing for the MVP because the
  host cache is provider-wide, not per remote calendar.
- **401:** force-refresh the access token once and retry the Graph request once. A
  second 401, `invalid_grant`, `interaction_required`, or a claims challenge becomes
  reconnect-required and purges the affected provider's cached event metadata.
- **Malformed Graph data:** reject the malformed item. If rejected items or paging
  limits make the result incomplete, reject the refresh and keep the prior complete
  snapshot.
- **No previous cache:** show no events and a localized actionable error; never invent
  an empty successful result for an authentication or completeness failure.
- **Account/config mismatch:** make no `calendarView` calls. Ask the user to reselect
  calendars for the locally connected account.

## External feasibility gate (Phase 0)

This phase deliberately precedes repo implementation.

1. Create a Super Productivity-owned, multitenant public-client Entra registration
   limited to accounts in organizational directories. Do not add a client secret.
2. Register the Electron loopback redirect
   `http://127.0.0.1:<fixed-high-port>/<fixed-callback-path>` through the Entra
   application manifest. Microsoft does not treat a literal `127.0.0.1` port as
   interchangeable, so the exact URI matters.
3. Configure only `Calendars.ReadBasic`; request `offline_access` in the OAuth flow.
4. Record whether the project can satisfy Microsoft publisher-verification
   prerequisites. Many education tenants restrict unverified multitenant apps even
   when a delegated permission is normally user-consentable.
5. Prove authorization, PKCE token exchange, refresh, `/me/calendars`, and one
   `calendarView` call with:
   - an ordinary Microsoft 365 tenant;
   - a representative restrictive university tenant, ideally the reporting user's;
   - consent denied and admin-approval-required paths.
6. Verify the chosen fixed port on all three desktop OSes. Confirm that a port
   collision produces a clear actionable failure rather than a timeout.
7. Verify that Graph responses expose the fields required under
   `Calendars.ReadBasic`: calendar owner/default flags, event subject/start/end,
   `isAllDay`, cancellation/response status, immutable ID, and `webLink`.

**Go:** at least one representative university user can consent, or the university has
a realistic documented admin-approval route; the app registration can be operated and
published by the project; all required fields are available at read-basic scope.

**No-go:** representative tenants categorically block the app with no workable approval
path, publisher requirements cannot be met, or required event/ownership fields demand
a broader permission the project is unwilling to request. In that case, answer the
user honestly; no client implementation can override the policy.

The spike should leave a short evidence note with tenant type, requested scopes,
redirect used, success/failure category, and redacted screenshots/errors. Never commit
tokens, tenant IDs, user addresses, authorization codes, or client secrets.

## Dependency order

```text
Phase 0 tenant gate
  -> host OAuth safety
  -> host HTTP/polling/calendar contracts
  -> provider Graph slices
  -> cross-tenant/manual verification
  -> docs and pilot
```

Stop at each checkpoint if the preceding contract cannot be made reliable without a
larger architectural change.

## Ordered implementation tasks

Each task is intentionally reviewable on its own. File lists are expected touch points,
not permission to broaden the task.

### 1. Add an explicit OAuth platform-capability contract

**Depends on:** Phase 0 green.

Add an optional, backward-compatible `supportedPlatforms` field to
`OAuthFlowConfig`. Existing plugins that omit it keep current behavior; the Microsoft
provider declares Electron only. Enforce the field before preparing a redirect server
or opening a browser.

Likely files:

- `packages/plugin-api/src/types.ts`
- `src/app/plugins/oauth/resolve-effective-oauth-config.util.ts`
- `src/app/plugins/oauth/resolve-effective-oauth-config.util.spec.ts`
- `src/app/plugins/oauth/plugin-oauth-bridge.service.ts`
- `src/app/plugins/oauth/plugin-oauth-bridge.service.spec.ts`

Acceptance: web/native attempts fail before any OAuth side effect; Google behavior is
unchanged. Verify with targeted specs and `npm run checkFile` for every changed TypeScript
file. Estimate: 0.5 day.

### 2. Make unsupported-platform UX generic

**Depends on:** Task 1.

Replace the web-only availability check in the provider dialog with the new platform
contract and a localized desktop-only explanation.

Likely files:

- `src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.ts`
- `src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.html`
- `src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.spec.ts`
- `src/assets/i18n/en.json`

Acceptance: unsupported builds show a disabled connect action and never start OAuth;
Electron remains connectable. Estimate: 0.5 day.

### 3. Make token refresh an awaited, generation-guarded transaction

**Depends on:** Task 1.

Define internal refresh outcomes for success, transient failure, and terminal
reauthentication. On success, replace a rotated refresh token (or retain the old one if
none is returned), persist the full new token set, and only then return the access
token. Increment a per-plugin generation on connect/disconnect; a late refresh from an
older generation must be discarded and must not write to memory or IndexedDB. Deduplicate
concurrent refreshes within the same generation.

Expose an additive force-refresh option for the one-retry-on-401 path and emit a
plugin-session-changed event after connect, disconnect, or terminal invalidation.
Transient network/429/5xx errors retain credentials.

Likely files:

- `src/app/plugins/oauth/plugin-oauth.model.ts`
- `src/app/plugins/oauth/plugin-oauth.service.ts`
- `src/app/plugins/oauth/plugin-oauth.service.spec.ts`
- `src/app/plugins/oauth/plugin-oauth-bridge.service.ts`
- `src/app/plugins/oauth/plugin-oauth-bridge.service.spec.ts`

Acceptance: tests cover rotation, no rotation, persistence failure, refresh
deduplication, disconnect during refresh, reconnect/account switch during refresh,
restart restoration, transient failure, terminal failure, and forced refresh. No token
or response body is logged. Estimate: 2–3 days.

### 4. Harden the Electron loopback callback

**Depends on:** Phase 0's exact redirect.

At `PLUGIN_OAUTH_START`, extract the expected state and callback path from the validated
authorization URL. The loopback server must ignore unrelated paths and wrong-state
requests without marking the flow handled or closing. Close only after a matching
callback, timeout, explicit cancellation, or startup error. Keep the existing clear
`EADDRINUSE` error for the fixed port.

Likely files:

- `electron/plugin-oauth.ts`
- a small pure callback-validation helper and focused test beside it

Acceptance: wrong path/state cannot consume the real callback; correct error and code
callbacks complete once; collision and timeout clean up. Estimate: 0.5–1 day.

### 5. Add a narrow typed plugin HTTP error contract

**Depends on:** none after Phase 0; land before Graph retry logic.

Add an optional typed error shape containing only normalized `status`,
`retryAfterMs`, and a stable error category. Parse both seconds and HTTP-date forms of
`Retry-After`. Do not expose arbitrary headers and do not change successful response
shapes. Keep the addition backward-compatible for existing plugins.

Likely files:

- `packages/plugin-api/src/issue-provider-types.ts`
- `src/app/plugins/issue-provider/plugin-issue-provider.model.ts`
- `src/app/plugins/issue-provider/plugin-http.service.ts`
- `src/app/plugins/issue-provider/plugin-http.service.spec.ts`

Acceptance: Electron and supported native paths produce the same safe error fields for
401/403/404/429/5xx/timeout; existing consumers still receive their expected data.
Estimate: 1–1.5 days.

### 6. Enforce per-provider agenda cadence and no overlap

**Depends on:** none; required before enabling the provider.

The combined calendar timer may continue waking at the smallest configured interval,
but it must call only providers that are due. Track last attempt/success and an in-flight
promise per provider ID. A manual refresh marks providers due; an automatic tick never
starts a second request for a provider already in flight.

Likely files:

- `src/app/features/calendar-integration/calendar-integration.service.ts`
- `src/app/features/calendar-integration/calendar-integration.service.spec.ts`

Acceptance: with Google at one minute and Microsoft at five, Microsoft is called once
per five minutes; slow requests never overlap; enable/disable and provider removal clear
cadence state. Estimate: 1–1.5 days.

### 7. Add a default-auto-poll capability for agenda providers

**Depends on:** none; additive public contract.

Add `defaultAutoPoll?: boolean` to the issue-provider manifest plumbing. Preserve the
current default for existing plugins; Microsoft sets it to false. This prevents hidden
agenda-view defaults from starting per-linked-task Graph polling.

Likely contract/plumbing files:

- `packages/plugin-api/src/issue-provider-types.ts`
- `src/app/plugins/issue-provider/plugin-issue-provider.model.ts`
- `src/app/plugins/issue-provider/plugin-issue-provider-registry.service.ts`
- `src/app/plugins/issue-provider/plugin-issue-provider-registry.service.spec.ts`
- `src/app/plugins/plugin-bridge.service.ts`

Then apply it in the provider setup model and cover it in the dialog spec. Acceptance:
new Microsoft configurations store `isAutoPoll: false`; Google and existing providers
retain current defaults. Estimate: 0.5–1 day.

### 8. Preserve date-only due dates and canonical URLs through the agenda contract

**Depends on:** contract review checkpoint.

Add optional `dueDay?: string` to `PluginSearchResult` and
`CalendarIntegrationEvent`. Preserve `dueDay` and `url` when mapping plugin agenda
results. Validate `dueDay` as `YYYY-MM-DD`; the issue adapter must prefer it over
deriving a date from `start` milliseconds. Event opening prefers the canonical HTTPS
URL and falls back to `getIssueLink`.

Likely files, split into two small commits if needed:

- `packages/plugin-api/src/issue-provider-types.ts`
- `src/app/features/calendar-integration/calendar-integration.model.ts`
- `src/app/features/calendar-integration/calendar-integration.service.ts` and spec
- `src/app/plugins/issue-provider/plugin-issue-provider-adapter.service.ts` and spec
- `src/app/features/calendar-integration/calendar-event-actions.service.ts` and spec

Acceptance: mailbox/device timezone differences never shift all-day task dates;
canonical URL, fallback URL, malformed URL, and ordinary iCal behavior are covered.
Estimate: 1–2 days.

### 9. Purge only authentication-invalid calendar cache entries

**Depends on:** Tasks 3 and 8.

Consume the OAuth session-change event in calendar integration. Remove in-memory and
local-storage entries belonging to provider configurations registered by that plugin
on disconnect, account replacement, or terminal invalidation. Retain the last complete
snapshot for transient offline/429/5xx failures.

Likely files:

- `src/app/features/calendar-integration/calendar-integration.service.ts`
- `src/app/features/calendar-integration/calendar-integration.service.spec.ts`
- OAuth event definitions/specs from Task 3 if not already complete

Acceptance: old account titles/links are not visible after disconnect or reconnect;
offline startup can still show the prior account's cache only while that same OAuth
session remains valid. Estimate: 1 day.

**Checkpoint A:** run all targeted OAuth, plugin HTTP, calendar integration, issue
adapter, provider-dialog, and Google Calendar tests. Review every additive public type
before starting the Microsoft package. If these changes need a breaking plugin API,
stop and write an architecture decision instead.

### 10. Scaffold the provider with real i18n

**Depends on:** Checkpoint A.

Create `packages/plugin-dev/microsoft-calendar-provider/` with the Google provider's
Vitest/esbuild shape, but follow the current plugin i18n contract rather than copying
Google's hard-coded labels.

Required assets:

- permanent manifest ID `microsoft-calendar-provider`;
- `i18n.languages: ["en"]` and `i18n/en.json`;
- a build script that copies manifest, icon, and English translations;
- `PluginAPI.translate` for every user-facing provider string;
- OAuth and HTTP permissions only; no node execution;
- `useAgendaView: true`, five-minute agenda interval,
  `defaultAutoAddToBacklog: false`, and `defaultAutoPoll: false`;
- no web/mobile client IDs and `supportedPlatforms: ["electron"]`.

Likely package/tooling files: `package.json`, `package-lock.json`, `tsconfig.json`,
`vitest.config.ts`, and `scripts/build.js`. Keep runtime code dependency-free; scoped
build/test packages mirror the existing plugin. Estimate: 1 day.

### 11. Implement pure Graph boundary parsing and mapping

**Depends on:** Task 10.

Create small typed modules for config validation, Graph response validation, composite
IDs, URL allowlisting, and date mapping. Treat every Graph response and `nextLink` as
untrusted. Every bearer-authenticated absolute URL must be HTTPS with hostname exactly
`graph.microsoft.com`; reject credentials, alternate ports, lookalike suffixes, and
redirect-derived hosts.

Mapping rules:

- request `Prefer: IdType="ImmutableId"` on every event request;
- use a reversible calendar-ID + event-ID composite key and preserve case;
- filter cancelled events and, by calm default, events the user declined;
- use a localized “Untitled event” fallback for an empty subject;
- timed values become real instants using the supplied Graph timezone/offset;
- all-day start/end retain date strings, with end exclusive; numeric schedule instants
  are constructed from local date boundaries solely for display;
- multi-day duration uses local date boundaries so 23/25-hour DST days still occupy the
  correct calendar days;
- accept only safe HTTPS Outlook `webLink` values.

Acceptance: pure tests cover invalid shapes, oversized fields, hostile `nextLink`, ID
case, recurrence instances/exceptions, missing titles, timed timezone offsets, mailbox
timezone different from device timezone, travel, DST, and multi-day all-day events.
Estimate: 2 days.

### 12. Connect OAuth and load only owned calendars

**Depends on:** Tasks 3, 4, 10, and 11.

Configure authorization-code + PKCE against the `organizations` endpoints with the
Phase 0 client ID and redirect. Load `/me/calendars` after connection. Establish the
mailbox owner from the default calendar, filter calendars to the same normalized owner,
and fail closed as specified when owner data is absent. Do not persist or log the owner
address.

The multi-select is required and capped at 10. Before saving/testing, reconcile synced
selected IDs with the locally returned owned-calendar IDs. If none or only some match,
show an account-mismatch/reselection error and make no event calls. Setup copy must say
that disconnect/reconnect affects every Microsoft Calendar configuration on the device.

Acceptance: ordinary own calendars appear; shared/delegated calendars do not; a config
synced from the same account works; a config synced from a different account fails
safely. Estimate: 1–1.5 days.

### 13. Implement the bounded event fetch and provider cache

**Depends on:** Tasks 5, 6, 11, and 12.

Fetch each selected calendar's `calendarView` using the fixed window and numeric limits.
Follow only validated `@odata.nextLink` values. Limit concurrency, enforce one in-flight
promise per cache key, and implement the fixed failure/retry semantics above.

Use a session-memory cache keyed by a one-way in-memory account-owner fingerprint plus
the sorted selected calendar IDs and window. Never persist the fingerprint. Before the
first agenda load, search may populate the same cache once; afterward `searchIssues`
filters it locally. Clear it on connect, disconnect, selection change, or OAuth terminal
invalidation.

Acceptance: tests prove pagination caps, total-event cap, 429 with both Retry-After
forms, long Retry-After abort, 5xx backoff, timeout, 401 force-refresh-once, terminal
reconnect, no overlapping fetches, cache isolation, and all-or-nothing retention of the
last complete snapshot. Estimate: 2–3 days.

### 14. Register the read-only provider definition

**Depends on:** Task 13.

Implement the mandatory issue-provider methods:

- `getHeaders` obtains the current OAuth access token;
- `testConnection` validates account, selection, and one bounded Graph call;
- `getNewIssuesForBacklog` returns the agenda window;
- `searchIssues` searches the same cache, fetching once only if needed;
- `getById` reuses a fresh cache entry or performs one bounded direct lookup;
- `getIssueLink` uses a cached canonical link with a documented work/school fallback;
- `issueDisplay` shows only non-sensitive basic fields.

Do not register `createIssue`, `updateIssue`, `deleteIssue`, comments, time-block
methods, or push field mappings. Do not include Graph event bodies in mapped objects.

Acceptance: a static/spy test proves no write HTTP method or write provider hook exists;
task creation gets title, `dueWithTime` or `dueDay`, duration/time estimate, and source
link as appropriate. Estimate: 1–1.5 days.

### 15. Bundle and reserve the permanent plugin ID

**Depends on:** Tasks 10 and 14.

Register build/copy and discovery atomically:

- `packages/plugin-dev/scripts/build-all.js`
- `src/app/plugins/plugin.service.ts`
- `electron/bundled-plugin-ids.test.cjs` (verification; change only if the test itself
  needs no new behavior)

Acceptance: built assets include `manifest.json`, `plugin.js`, `icon.svg`, and
`i18n/en.json`; the asset path and reserved manifest ID cannot drift. Estimate: 0.5 day.

### 16. Document privacy, platform, and tenant limitations

**Depends on:** working implementation.

Update user documentation in the same feature PR:

- `docs/wiki/3.07-Issue-Integration-Comparison.md`
- `docs/wiki/4.24-Integrations.md`
- `docs/wiki/3.05-Web-App-vs-Desktop.md`
- `docs/wiki/3.06-User-Data.md`

Document exact scopes, read-only behavior, Electron-only support, one local account,
synced selection versus unsynced credentials, university admin approval, and storage:
OAuth tokens in local-only IndexedDB plus basic event metadata/source URLs in the
existing unencrypted calendar local-storage cache. State when each cache is retained or
purged. Estimate: 0.5–1 day.

### 17. End-to-end verification and pilot

**Depends on:** all implementation tasks.

Run:

- `npm run checkFile <filepath>` for every changed `.ts` or `.scss` file;
- targeted root specs for OAuth, plugin HTTP, calendar integration, provider dialog,
  issue adapter, and Google Calendar regression;
- Microsoft plugin `npm test`, `npm run typecheck`, and `npm run build`;
- `node --test electron/bundled-plugin-ids.test.cjs`;
- `npm run plugins:build` and a production build appropriate to the release branch.

Manual matrix:

- Windows, macOS, and Linux Electron;
- ordinary tenant and representative university tenant;
- first consent, denied consent, admin approval required, expired access token, rotated
  refresh token, offline refresh, revoked grant, and reconnect to another account;
- one and ten calendars, same-account synced config, different-account synced config;
- timed, recurring, exception, cancelled, declined, all-day, multi-day, DST, and
  mailbox/device timezone mismatch;
- one-minute Google plus five-minute Microsoft cadence;
- disconnect/account switch cache purge and offline stale-cache retention;
- port collision and wrong-path/state loopback requests.

Pilot with the reporting user before general release. A successful pilot means they can
connect without an iCal URL, select their university calendars, plan from the agenda,
create a task snapshot, and open the Outlook event without broader permissions.
Estimate: 1.5–2 days plus user availability.

## Security and privacy acceptance criteria

- No client secret or tenant-specific identifier is committed.
- Only `offline_access` and delegated `Calendars.ReadBasic` are requested.
- Every OAuth flow uses PKCE and state; the loopback listener accepts only the expected
  path/state on `127.0.0.1`.
- Bearer tokens are sent only to exact HTTPS Microsoft Graph hosts.
- Redirects and `nextLink` values cannot move a bearer request to another host.
- Graph response values are shape/length validated at the boundary and rendered only
  through normal escaped Angular/plugin form paths.
- Logs contain only safe categories/status/counts and opaque internal provider IDs;
  never tokens, codes, email addresses, tenant IDs, titles, bodies, event URLs, or raw
  Graph error payloads.
- OAuth credentials are local-only and never enter synced `pluginConfig`.
- Event bodies, attendees, and attachments are neither requested nor cached.
- Account replacement, disconnect, and terminal authentication failure purge affected
  cached event metadata.
- Automatic and manual request paths share concurrency, pagination, retry, and timeout
  bounds.
- No new root dependency is introduced.

## Release criteria

Ship only when all are true:

- Phase 0 passed for a representative education tenant.
- The Entra app registration has a named long-term owner and publisher-verification
  decision.
- Unsupported platforms cannot start OAuth.
- Refresh rotation survives restart and cannot race disconnect/reconnect.
- Microsoft calls remain on their own cadence even beside faster providers.
- Imported tasks do not trigger automatic per-task Graph polling.
- Shared/delegated calendars are absent from selection.
- All-day dates remain stable across mailbox/device timezone differences.
- Throttling honors Retry-After and all request/page/event limits are tested.
- Cache retention/purge behavior is tested and documented.
- Existing Google Calendar behavior remains green.
- The university pilot succeeds without broader scopes.

## Deferred follow-ups

Consider these only after real demand and a separate design review:

- Android/iOS support with dedicated Entra redirect/client configuration.
- Web support, including the 24-hour SPA refresh-token lifetime and CORS/reauth design.
- Outlook.com consumer accounts and sovereign-cloud endpoint sets.
- Shared/delegated calendars with explicit permission and ownership UX.
- Multiple accounts per device, which requires changing plugin-global OAuth storage.
- Event write operations and time-block synchronization, which require
  `Calendars.ReadWrite`, conflict semantics, and a much larger trust surface.
- Delta queries or change notifications if measured Graph volume justifies the added
  state and lifecycle complexity.

## Official references checked

- [Microsoft identity platform authorization-code flow with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Redirect URI restrictions and loopback rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- [Refresh-token replacement and lifetimes](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)
- [`Calendars.ReadBasic` delegated permission](https://learn.microsoft.com/en-us/graph/permissions-reference#calendarsreadbasic)
- [Tenant user-consent configuration](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)
- [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- [List calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0)
- [Shared and delegated Outlook calendars](https://learn.microsoft.com/en-us/graph/outlook-get-shared-events-calendars)
- [Calendar view and recurrence expansion](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
- [Outlook immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [Microsoft Graph event resource and `webLink`](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
- [Get an event](https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0)
- [Microsoft Graph throttling and Retry-After](https://learn.microsoft.com/en-us/graph/throttling)
- [Claims challenges and Conditional Access](https://learn.microsoft.com/en-us/entra/identity-platform/claims-challenge)
