# Multi-user collaboration: close the Plainspace seam

Oct 21, 2026 · status: direction agreed; ready to implement · rev. 4: KISS
pass. The protocol reuses the generic two-way-sync engine as it is; no
conditional writes, no idempotency column, no capability negotiation, no
server migration · rev. 3: the scheduled time syncs directly, a plan without
a time clears it, one delete path · rev. 2 after a review by Astra (schedule
contract, write protocol, deletion contract, token scoping, smaller first
release)

Super Productivity stays a single-user deep-work tool; Plainspace stays the
place where tasks go when they need other people. What fails users today is
the seam between the two, not the absence of a native multi-user mode. This
plan makes a Plainspace-linked project behave the way users already assume it
does: what I change in SP reaches the Space, what others change reaches me, and
how I work on a task (time, notes, subtasks) is not sent to Plainspace.

Builds on: [#8648](https://github.com/super-productivity/super-productivity/issues/8648)
(task-level delegation exploration), Plainspace's
[`docs/plans/2026-06-02-super-productivity-integration.md`](https://github.com/super-productivity/plainspace/blob/main/docs/plans/2026-06-02-super-productivity-integration.md)
(product vision) and
[`2026-06-30-connect-from-super-productivity.md`](https://github.com/super-productivity/plainspace/blob/main/docs/plans/2026-06-30-connect-from-super-productivity.md)
(connect flow). Resolves #8790, #9833, #8616; informs #8476.

Mockups of every screen and contract below:
[design canvas](https://claude.ai/artifact/Phtx9HgeANGnrhrLd48oGA) (private
until shared by the maintainer).

## Decision

1. **Fix the seam, don't build native multi-user.** No shared scopes in the
   SuperSync op-log, no accounts or roles in SP (§ Options considered).
2. **Shared task, private work.** Title, done, the scheduled time and (later)
   the assignee are shared with the Space. Time tracked, estimates, notes,
   subtasks, tags and Today order are never sent to Plainspace. SP's own sync
   still carries them between my devices.
3. **Only tasks assigned to me sync.** While a task is assigned to me, its
   title, done state and timed schedule sync both ways. A task that is not (or
   no longer) assigned to me is not synced, whatever the reason (§ Scheduled
   time, § Deletion and lost access).
4. **Reuse the engine that exists.** Plainspace already runs on SP's generic
   two-way-sync engine, which keeps per-field baselines, fetches before it
   writes and lets the remote win (§ Sync protocol). The plan fills its gaps
   instead of adding a protocol on top.
5. **Plainspace stays minimal.** One widened `PATCH` now, two small endpoints
   for Phase 2, no migration. No notes, subtasks or comments on Plainspace
   items; its own non-goals already say so.
6. **Small releases, each shippable alone** (§ Releases). Accepted risks are
   written down instead of guarded against (§ Accepted gaps).

## Evidence

### Demand

Small but real, and concentrated on the integration's behaviour rather than on
whether collaboration should exist.

- 8 user-filed SP issues over ~4 years ask for multi-user, ~17 👍 total:
  [#3969](https://github.com/super-productivity/super-productivity/issues/3969)
  (8, assign to family and co-workers, TickTick switcher),
  [#5189](https://github.com/super-productivity/super-productivity/issues/5189)
  (5, family: separate profiles _and_ shared tasks),
  [#5835](https://github.com/super-productivity/super-productivity/issues/5835)
  (4, people on tasks); the rest have 0. For scale: task dependencies #2173 has 43.
- Use cases: small work team 4, household/family 2 (+ super-productivity/plainspace#17, #10),
  same-device profiles 3 (mostly one person's work/life split), client
  read-only 1.
- Plainspace users are an active early-adopter group (~6 people). Every one of
  their reports is about the seam:

| Pain                                           | Where                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Renaming in SP doesn't reach the Space         | #3969 comment, #9833                                                               |
| A due time set in SP never reaches others      | #9833                                                                              |
| A task moved into a shared project stays local | #8790 (maintainer: "next release", 2026-07-06; community PR #9511 closed unmerged) |
| Second Space or reconnect breaks the token     | #8616 ("you can only have one active token")                                       |
| Android can't connect                          | #9988 (logs supplied, unanswered since Sep 28)                                     |
| Wiki said "two-way" when only done synced      | #9833 (wiki corrected)                                                             |
| Closing #3969 read as a dodge                  | #3969: "You can't be serious."                                                     |

Declined before, and still declined here: real-time Trello-style team boards
(#10830), SP-hosted public links (#10351, "doesn't fit offline-first,
privacy-first"), same-device multi-login (#5189 part 1; OS accounts cover it).

### What the code does today

| Area            | Today                                                                                                                                                                  | Source                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Engine          | Plainspace is registered on the generic two-way-sync engine: per-field baselines in `issueLastSyncedValues`, fetch right before a push, remote wins on conflict        | `issue-two-way-sync.effects.ts:150`, `compute-push-decisions.ts:79-90`       |
| Push            | Only `isDone`. `pushChanges` returns early otherwise; `patchTask$` sends `{done}`                                                                                      | `plainspace-sync-adapter.service.ts:61,99-113`                               |
| Pull            | Any `updatedAt` change overwrites title, done and `dueWithTime` together, ignoring the baselines, so a local edit is lost when anyone touches the item                 | `plainspace-common-interfaces.service.ts:132-151`                            |
| Errors          | `getMyTasks$` and `getById$` turn every error, 401 and offline included, into an empty result; an offline push is dropped with no message                              | `plainspace-api.service.ts:141,171`                                          |
| Schedule fields | Setting `dueWithTime` clears `dueDay` and vice versa                                                                                                                   | ARCHITECTURE-DECISIONS.md #1                                                 |
| Create          | Only on `addTask` of a root task in the bound project; create, then a second op links                                                                                  | `issue-two-way-sync.effects.ts:326-428`                                      |
| Delete          | `deleteTask`/`deleteTasks` delete the Plainspace item for everyone after the undo window; deleting a project does not; removing the provider unlinks tasks, keeps them | same `:267-325`, `issue-provider-shared.reducer.ts:60-70`                    |
| Missing items   | A task that leaves my `/tasks` list is left untouched; the server answers 404 for deleted, unassigned and no-longer-member alike                                       | `plainspace-common-interfaces.service.ts:94-130`, server `integration.ts`    |
| Move in / out   | Moving in creates nothing; moving out keeps the link and keeps syncing                                                                                                 | `poll-issue-updates.effects.ts:139-146`                                      |
| Share a project | Binds a provider; existing tasks stay local; no invite link shown                                                                                                      | `plainspace-share.service.ts:51-110`                                         |
| Space link      | SP already builds `{host}/{slug}`; Plainspace sends a visitor without identity to `/{slug}/join`                                                                       | `plainspace-api.service.ts:109-127`, plainspace `routes/Project.tsx:318-325` |
| Connect         | Guided page on plainspace.org, then copy-paste the token; one PAT per email, minting revokes the old one; provider configs may point at different hosts                | `plainspace-connect-dialog.component.ts:66-80`, server `schema.ts:367-369`   |
| Latency         | 5-minute poll of the full assigned list (at most 500 items per Space)                                                                                                  | `plainspace.const.ts:7`, plainspace `shared/src/constants.ts:29`             |

### What the Plainspace server offers

The integration API (`packages/server/src/routes/integration.ts`, PAT auth)
lists my tasks, creates (assigned to the caller, `:305`), patches **only**
`{done}` and answers 422 to anything else (`:381-383`), deletes (soft, kept
30 days: `services/retention.ts:16`; the web app restores an item only from
the Undo toast after its own delete, `routes/items.ts:457`, so an
integration delete has no restore path for Space members), lists and claims
unassigned tasks, and creates Spaces. Items have `text` varchar(500), single
`assignedTo`, `remindAt` (always an instant), `repeat`, and a row-level
`updated_at` only; no notes, subtasks or comments. Plainspace's own web app edits items with a plain
read-merge-write `PATCH`, no precondition (`routes/items.ts:273-362`). Spaces
default to `sharingMode: 'open'`, so anyone with the link can join without an
account.

## Prior art

Checked Oct 2026 from vendor help pages as surfaced by web search (pages not
opened hands-on; treat single cells as approximate). Sources at the end.

| App                 | Shared                         | Per-user layer on shared tasks                                      | Assignment               | Others' tasks in my day view      | Invite                               |
| ------------------- | ------------------------------ | ------------------------------------------------------------------- | ------------------------ | --------------------------------- | ------------------------------------ |
| **Microsoft To Do** | Whole lists only               | My Day, reminders                                                   | One person               | No; "Assigned to me" feeds My Day | Link; same account type only         |
| **Todoist**         | Projects, comments             | View settings, personal labels, reminders aimed at one collaborator | Exactly one, on purpose  | Mine + unassigned                 | Name or email; free tier capped at 5 |
| **TickTick**        | Lists, comments                | Per-list "show in smart list" (4 options)                           | One                      | Configurable per list             | Link or email, owner approves        |
| **Google Tasks**    | Single tasks from Docs/Chat    | Assignee chooses which own list it lands in                         | One                      | Only mine                         | Doc / space membership               |
| **Sunsama, Motion** | In the source tool / workspace | Planner stays personal; Motion's "My Tasks" can't be assigned       | In shared workspace only | Only what I pull in               | Workspace invite                     |
| **Amazing Marvin**  | Opt-in shared lists            | Everything else                                                     | —                        | —                                 | Link; non-users act as "Anonymous"   |

**Take**

- One assignee per task (Todoist's "directly responsible individual").
- A personal layer on shared tasks: Microsoft's My Day and per-user reminders,
  Sunsama's and Motion's personal planner over a shared source.
- Today shows only my tasks; shared tasks enter my plan only when assigned to me.
- No-account link invites (Plainspace already has them; SP just doesn't show the link).
- Visible sync failures instead of silent ones.

**Deliberately don't**

- Multiple assignees, roles UI, permissions in SP.
- TickTick's per-list visibility setting: one calm default instead.
- Comments or activity feeds in SP: they stay in Plainspace.
- Sharing time tracked in v1.
- End-to-end-encrypted group sharing: group key management is still
  research-grade (Keyhive) and even Jazz moved permissions to a trusted server.

## Options considered

| Option                                           | Verdict                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Native shared projects in SuperSync**       | Rejected. Every load-bearing sync decision assumes one owner: `MAX_VECTOR_CLOCK_SIZE = 20` (members × devices overflow it), E2EE keyed to one user's password, `SYNC_IMPORT`/`BACKUP_IMPORT` drop concurrent ops (one member's restore would wipe the others), project delete-wins. Also contradicts the #10351 position on SP hosting shared data. |
| **B. Same-device profiles**                      | Out of scope. A different problem (#5189 part 1); OS accounts cover it.                                                                                                                                                                                                                                                                             |
| **C. Grow Plainspace into an SP-shaped tracker** | Rejected. Notes, subtasks and estimates on items are explicit Plainspace non-goals; its users are households and clubs who never install SP.                                                                                                                                                                                                        |
| **D. Move Plainspace to the plugin sync path**   | Not now. It is not less code (Plainspace is already on the generic engine) and changes synced provider keys (#8476).                                                                                                                                                                                                                                |
| **E. Close the seam (chosen)**                   | Fixes every reported pain, needs no SP persisted-model change and no server migration.                                                                                                                                                                                                                                                              |

## The contract: shared task, private work

A task in a shared project is **linked** (`issueType === 'PLAINSPACE'`). A
linked task stays shared wherever I file it; the shared project only decides
where new links come from. "Private" means _not sent to Plainspace_.

| SP field                        | Plainspace   | Direction                                           | Notes                                                           |
| ------------------------------- | ------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| `title`                         | `text`       | both while assigned to me                           | Over 500 characters: not pushed, task shows a sync error        |
| `isDone`                        | `checked`    | both while assigned to me                           | Exists                                                          |
| `dueWithTime` (scheduled time)  | `remindAt`   | both while assigned to me; pull only when recurring | § Scheduled time. The mapping exists today, pull only           |
| assignee                        | `assignedTo` | Phase 2, explicit action only                       | Not a task field in SP                                          |
| time, estimate, notes, subtasks | —            | private                                             | Notes and subtasks become my private breakdown of a shared task |
| tags, deadlines, Today order    | —            | private                                             |                                                                 |

### Scheduled time

The reported need: a due time set in SP should reach the people in the Space
(#9833). One field carries it, the task's existing schedule. Three rules:

1. **Plainspace shows my timed schedule.** The value sent is `dueWithTime`, or
   "no time" when the task has none. Rescheduling, dragging in the planner,
   planning a day without a time and unscheduling are all ordinary changes of
   that one value. Implemented with the engine's existing hook: a `dueDay`
   mapping with `mutuallyExclusive: ['dueWithTime']`
   (`compute-push-decisions.ts:101`) clears the remote time, no new rule.
2. **The assignee owns it.** It syncs only while the task is assigned to me
   (Decision 3). Today every linked task is assigned to me, so a pushed time
   reminds only me; others see it.
3. **Repeating tasks: Plainspace sets the time.** SP never pushes the time of a
   recurring item; local edits stay until the next occurrence overwrites them.
   No server guard: Plainspace's own web app allows editing it.

Cost: my timed plan for a shared task is visible to the Space. Date-only
times wait until Plainspace has them; inventing a clock time is a new setting
(declined in #9833). Dropped in rev. 3: rev. 2's separate shared time on the
deadline fields with "plan follows until I replan" seeding. It kept planning
private but needed a transitions table, a backfill and a second schedule in
the UI.

**Decided (Oct 21): a plan without a time clears the Plainspace time.**
Planning a shared task day-only, adding it to Today without a time, or
unscheduling it sends "no time". Rejected: leaving Plainspace's time in place.

- **One rule, no exception.** Keeping the old time would need a special case
  ("a day-only plan counts as unchanged") in the per-field decisions.
- **No stale reminders.** Plainspace's time is the assignee's reminder, i.e.
  mine. A kept "Fri 18:00" would remind me about a task I planned for Thursday
  or already did.
- **Both apps always agree.** No "SP says Thursday, the Space says Friday".
- **Only the owner loses it.** It happens only on tasks assigned to me;
  repeating tasks are pull only and unaffected.

Cost: "Add to Today" on a task someone gave a time removes that time for
everyone (unless Plainspace's time changed since my last poll: then it
wins, as for any field). A hard time
("campsite closes Fri 18:00") belongs in the title for now; Plainspace has no
deadline field. Revisit trigger: users report losing times others set. The
fix then is a confirm on that action, not a second sync rule.

## Sync protocol

The generic engine already does most of it; this release fills three gaps.

**What exists.** Per-field baselines in `issueLastSyncedValues`; before a push
the engine fetches the item and pushes only fields whose remote value still
equals the baseline; otherwise the remote wins (`compute-push-decisions.ts`).
That is the same last-writer-wins behaviour Plainspace's own web app has
(`items.ts:273-362`), so SP is not stricter than Plainspace itself.

**Gap 1: the pull ignores the baselines.** Replace Plainspace's whole-row
overwrite with a per-field pull: a field is pulled only when its remote value
differs from its baseline. CalDAV already does this for the same row-level
marker problem (`caldav-common-interfaces.service.ts:265-317`); move that into
one helper both providers call.

**Gap 2: edits made offline are dropped.** On each successful poll, a field
whose local value differs from its baseline while the remote still equals it
is pushed. The stored baseline is the queue: it survives restarts, and no
outbox is stored. Two devices doing this converge without coordination: the
second one's fetch sees the remote already equals its value. Skipped for
fields that can't be pushed (a recurring item's time).

**Gap 3: errors are swallowed.** `getMyTasks$` and `getById$` stop turning
errors into empty results. Everything derived from a poll, "no longer in your
list" in particular, is computed only from a successful response, never from
an offline or failed one.

**Creates** stay as they are: create, then link. Never retried automatically.
A task in a shared project that failed to share (offline, server error) is
picked up by "Share N unshared tasks" (Release 3), which is safe to repeat
because it only looks at unlinked tasks.

**Echoes are compared exactly.** The server stores the title verbatim and
answers a PATCH with the updated task; a pushed field counts as synced only
when the echo equals what was sent, character for character.

**Older servers.** Old-server detection is a 422 on a request carrying a new
field (`title`, `scheduledAt`); SP checks the title is 1–500 characters and not
blank before sending, so a 422 there means "too old", not "invalid". A server
from before the widened PATCH answers `{title}` alone with a 422 and
`{done, title}` with a 200 that ignores the title; the missing echo counts the
same. It is remembered per provider, in memory, for the session: SP stops
pushing that field and shows "Plainspace server too old for title/time sync"
once in the provider panel. Done keeps syncing as today. No capability
negotiation.

**409 means "couldn't sync" for that task**, never "too old": the server
refuses a change for this item's state (`repeat_requires_remind_at`: clearing
the time of a recurring item). The task shows _couldn't sync_ with the reason.

**Visible state.** In-memory, rebuilt on each poll, shown in the task detail
panel's Plainspace section (never in the task row template, a hot path):
_couldn't sync: reason · Retry_ and _no longer in your Plainspace list_. Per
provider: _reconnect_ on 401, _server too old_. The existing failure snack
stays. No pending-changes indicator, no header count.

## Deletion and lost access

Needs to be fixed before anything creates links automatically, because move-in
and bulk sharing raise the blast radius of today's delete-for-everyone.

| Event                                                   | Plainspace                                                                | Local                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Delete a linked task assigned to me                     | Deleted for everyone after the undo window (exists; confirm text says so) | Deleted locally; not kept in Recently deleted                                                        |
| Delete a task no longer assigned to me                  | Untouched (server refuses: not assigned to me)                            | Deleted; normal confirm, no "for everyone" warning                                                   |
| Delete the project                                      | Untouched (not a delete trigger, verified)                                | Tasks deleted locally                                                                                |
| Remove the provider                                     | Untouched                                                                 | Tasks unlinked, notes and time kept (exists)                                                         |
| Handed off, deleted, unassigned or lost access remotely | —                                                                         | Never deleted. Task, notes and time kept; state _no longer in your Plainspace list_; no further sync |
| Move the task out of the shared project                 | Untouched, stays linked                                                   | —                                                                                                    |
| "Only keep the latest" removes an older repeat copy     | Deleted for everyone at once: no confirm, no undo (#11016, chosen)        | Deleted locally                                                                                      |

A missing item is never read as a deletion: the server returns the same 404
for deleted, reassigned and lost-membership, by design, and "missing" is only
computed from a successful poll.

Delete is one action. There is no separate "delete my copy": the warning
appears only when the delete reaches Plainspace, i.e. the task is assigned to
me. A task that is no longer mine is deleted locally like any other task.

## Releases

Sizes are relative (S, M) and not commitments; each release has its own PRs.

### Release 0: fix what's broken, say what syncs (S, SP only)

1. **Reproduce #9988** (Android connect) from the supplied logs; fix or ask for
   what's missing. Answer the thread either way.
2. **Scoped token replacement.** A reconnect writes the new token only to
   providers whose current token equals the replaced one (same credential,
   so same host and account), one `IssueProviderActions.updateIssueProvider`
   op per provider. Closes #8616.
3. **Stop hiding errors** (Gap 3): a 401 shows _reconnect_ on the provider.
4. **Copy invite link** after sharing and in the project menu: the Space URL
   SP already builds (`getSpaceUrl$`). Plainspace sends visitors without an
   identity to the join page. A private Space shows its private notice
   instead; no server change.
5. **Say where data goes.** The share dialog states that titles, done state
   and scheduled times are stored on the Plainspace host. The wiki's
   "what syncs where" table is updated in the same PR as each release.

### Release 1: safe pulls, title round-trip, move-in (M)

Server: `PATCH /integration/tasks/:id` accepts optional `done`, `title` and
`scheduledAt` (`null` clears it), at least one present; field handling copied
from the web app's item `PATCH` (`items.ts:299-307`), including clearing
`notifiedAt` when the time changes. No migration. Ships `scheduledAt` now so
Release 2 is client-only.

SP:

1. **Per-field pull** (Gap 1), shared helper with CalDAV.
2. **Poll-time push** of offline edits (Gap 2).
3. **Title both ways**: `title: 'both'`; `pushChanges` sends it and checks the
   echoed value; older servers per § Sync protocol.
4. **Moving in shares** (#8790): add `moveToOtherProject` into a bound project
   (and `applyShortSyntax` with a `+Project` move) next to `addTask` in
   `autoCreateIssueOnTaskAdd$`. Moving out keeps the link.
5. **Visible state** per § Sync protocol.
6. **Refresh when I look**: a throttled full poll on window focus and app
   resume. No delta polling.

### Release 2: scheduled time both ways (S, SP only)

`dueWithTime: 'both'`, plus the `dueDay` mapping with
`mutuallyExclusive: ['dueWithTime']`; recurring items pull only. Closes #9833.

**Delivered** as planned, and **ships with Release 1** in the same tag
(maintainer decision, Oct 22). Three deviations:

- The `dueDay` mapping targets `scheduledAt` itself and always sends "no
  time", instead of clearing it through `mutuallyExclusive`: that hook only
  fires after a push of the day field, which Plainspace doesn't have. The time
  mapping comes first, and the engine decides a remote field once (now also in
  the poll's pending check), so a change with a time sends the time and a
  day-only plan sends "no time". Same rule, no separate baseline, and a clear
  now keeps the remote-changed check the `mutuallyExclusive` path skipped.
- "Pull only" for recurring items is decided per item: `getSyncConfig` gets
  the item as fetched, so a task that became recurring in Plainspace stops
  pushing its time without a restart.
- Older servers: titles and times arrived together (plainspace#41), so one
  "server too old" state covers both: a 422 on, or an ignored, title or
  `scheduledAt` turns both pull-only for the session. A 409 is per task:
  `repeat_requires_remind_at` shows "A repeating task needs its time in
  Plainspace", any other "Plainspace refused this change".

### Release 3: share existing tasks (S, SP only)

"Share N unshared tasks": a sequential loop over the same create-and-link path
for the unlinked root tasks of a shared project. Offered on the share success
screen and in the project menu whenever such tasks exist; it also covers
creates that failed earlier. Stops at the first 422 or 429; the server already
enforces the 500-item cap and the rate limit. Subtasks stay local. Depends on
§ Deletion being in place.

### Phase 2: hand a task to someone (M), #8648

Server: `PATCH` accepts `assigneeId` (a member, or `null` to release) for tasks
assigned to the caller, matching the vision doc's "you acting on your own
task"; `GET /integration/spaces/:id/members`.

SP:

1. **Task context menu → "Assign to… / Release to Space"** on linked tasks.
   Menu only, never in the task row template.
2. **After handing it off** the task is no longer mine: it is unscheduled
   locally and shows _no longer in your Plainspace list_, exactly like a
   remote reassignment. No live assignee name, no extra endpoint. Reassigned
   back to me, it syncs again.
3. **Not shared yet?** The menu entry offers to share the project first, then
   assign.

**Delivered** (plainspace#42, this repo's Phase 2 PR), with these deviations:

- **Not unscheduled locally.** A remote reassignment keeps the task
  untouched, so a handoff does too: it is only marked _no longer in your
  Plainspace list_ (the in-memory Release 1 state), and writes no op. An
  unschedule would also be a local edit that the poll-time push (Gap 2) sends
  as "no time" once the task is assigned back, clearing the Space's time.
- **Not shared yet** (item 3) is not built: the entries appear only on linked
  tasks still assigned to me. No assignee display, no further endpoints.
- **Members list leaves out the caller** and takes the Space id or slug, since
  SP knows neither its member id nor always the Space's UUID.
- **Older servers:** a 404 on the members list or a 422 on an
  `assigneeId`-only PATCH shows "Plainspace server too old to assign" once
  per attempt. No capability negotiation.

### Phase 3: only on evidence

Device-code connect (needs two endpoints, a code store and a consent screen;
none of the reported pains need it once #8616 and #9988 are fixed); live push
for integration clients; a "Waiting on" view with live assignees; plugin
migration (#8476); day-only schedules once Plainspace has a date-only time;
`clientRef` idempotent creates if duplicates are reported.

## Accepted gaps

Recorded instead of guarded, per AGENTS.md "Hardening needs evidence". Each
gets a fix only when it is reported.

- **Same-field race.** Someone edits the same field within one fetch→PATCH
  round trip: last writer wins, as in Plainspace's web app.
- **Both sides change one field between polls.** Plainspace's value wins with
  no conflict message.
- **Two of my devices edit one field offline.** If device B edits a field
  while offline from both SuperSync and Plainspace before device A's push of
  the same field completes, A's post-push write (field plus baseline, #11034)
  is newer and wins: SP converges on Plainspace's value, as above.
- **An unpushed edit meets my other device's stale pull first.** I edit a
  field Plainspace just changed (e.g. reopen a task a collaborator completed)
  while my device can't reach Plainspace, and my other device, not yet synced,
  pulls the old remote value. If that pull reaches my device before my push
  does, it is newer and wins: the edit is dropped and every device converges
  on Plainspace's value, as above. If my push runs first, the edit is kept
  (#11034).
- **Lost create response, or a crash between create and link.** One visible
  duplicate SP task (auto-imported), no data loss. Fix: `clientRef`.
- **Old self-hosted servers** keep done-only sync until they upgrade.
- **Titles and times that were local-only before this release** (a local
  rename, a title short syntax stripped at import, a local reschedule, or a
  day-only plan or Add to Today on a task with a Plainspace time) are pushed on
  the first successful poll after the update; the baseline can't tell them
  from an offline edit. The commonest trigger is the reminder dialog's "Add to
  today" (`dialog-view-task-reminders`, `isClearScheduledTime: true`), which
  always clears `dueWithTime` locally; plain Add to Today does the same for a
  timed task on another day (`shouldClearDueTimeForToday`). The first poll
  after the update then sends "no time", which removes the Space's time for
  everyone. **Decided (Oct 23):** accepted with a release note naming times and
  "Add to today". Revisit if users report lost times.
- **No cross-repo real-server E2E.** Contract drift is caught by Plainspace's
  integration tests and the shared `SPTask` type.
- **Delegated tasks** don't show their live title, done state or assignee in SP.
- **Moving many tasks in at once** (bulk move, multi-drag, all instances of a
  repeating task) shares each one: one create per task, and offline or rate
  limited one error message per task. Release 3's bulk share stops on the
  first 422/429.
- **Two devices moving the same task in** before either's link op syncs both
  create it: one visible duplicate item in the Space, no data loss. Fix:
  `clientRef`, like a lost create response.
- **A time removed in Plainspace, pulled by a released client.** v19.x pulls
  "no time" as `undefined`, which the op's JSON drops (#9776), so my other
  devices keep the old time while taking the new baseline. A Release 2 device
  that gets that op before its own poll then pushes the old time back to the
  Space. Transitional (needs a v19.x device in the fleet; #11039 pulls `null`
  from then on), and every guard found (e.g. no poll-time push of a time over
  a "no time" baseline) also blocks a legitimate offline time edit for good.
- **A stale time pushed back after a two-device split.** The two-device
  stale-pull case that #11042/#11046 fix for title and done (another device
  pulls an old value between an offline edit and its push) still applies to
  the time: the pulled old time wins over my edit while the baseline takes my
  pushed time, so the next poll pushes the old time back for everyone. The
  time is not carried with its baseline: carrying a due field through
  `updateTaskUi` would skip the planner and TODAY meta-reducer bookkeeping and
  needs its own design. My time edit is lost, visibly (a wrong time, no lost
  text). Revisit on a user report.
- **Mixed fleet.** A v19.x device on the same SuperSync account still
  overwrites a shared task's title, done state and time with Plainspace's copy
  (its whole-row pull, with the baseline) whenever the Space item changes. An
  edit made on an updated device that hasn't reached Plainspace yet is then
  lost on every device. Released behaviour, transitional; the release note
  asks users to update all devices. Revisit if reported.

## Sync and long-term cost

- **No SP persisted-model change, no server migration.** Membership derives
  from `issueType`/`issueProviderId`; baselines use `issueLastSyncedValues`;
  the scheduled time uses the existing `dueWithTime` mapping; sync state is an
  in-memory view-model (AGENTS.md sync rule 13).
- **Ops.** Pulls and pushes are single-task `updateTask` ops; create and link
  stay two ops; bulk share is a per-task loop (sync rule 6). New effects inject
  `LOCAL_ACTIONS`, so remote ops never re-trigger a push.
- **Integration API is a contract** with released SP clients and self-hosted
  Plainspace versions. Additive only: old clients keep sending `{done}`; new
  clients fall back per field on older servers.
- **Privacy.** Plainspace content is not end-to-end encrypted. Sharing is
  explicit and the dialog says so.
- **Unreproduced risks, filed as issues with a reproduction first** (sync rule
  15), not fixed in these PRs: the update poll lacking `skipDuringSyncWindow`
  (`poll-issue-updates.effects.ts:68-97`); concurrent `restoreTask` of a
  recurring task with differing `timeSpentOnDay`.
- PRs touching `issue-two-way-sync.effects.ts` follow the sync-PR review rule
  (fresh-context review pass, findings in the PR body).

## Testing

- **E2E with a stubbed server.** Plainspace has no E2E harness in SP, so per
  AGENTS.md's exemption the tests stub the integration API with a small
  stateful `page.route` fake using real `SPTask` shapes, like the GitHub
  provider's E2E (`github-sync-direction-9900.spec.ts`). The PR says why.
  Plainspace's own `integration.test.ts` covers the server side.
- **Release 0**: reconnect replaces the token only in providers that held the
  old one (a second host or account keeps its own); a 401 asks to reconnect;
  copy invite link.
- **Release 1**: title round-trip both ways; a remote edit no longer
  overwrites an unrelated local edit; offline edit, restart, reconnect, then
  pushed; two devices pushing the same edit converge; move-in creates; an older
  server (422) keeps done sync and shows "too old" once; offline never marks
  tasks "no longer in your list".
- **Release 2**: reschedule, planner drag, day-only plan and unschedule each
  reach Plainspace; a remote change lands in SP; a recurring task's local edit
  is not pushed and the next occurrence pulls; a task not assigned to me
  neither pushes nor pulls its time.
- **Release 3**: N unshared tasks become N items, subtasks stay local; a run
  stopped midway and repeated creates no duplicates; a 422 or 429 stops it with
  a message.
- **Phase 2**: assign, release, reassign back (syncs again).
- **Deletion**: each row of the deletion table.
- Unit specs for the shared per-field pull helper and the move-in effect.

## Not doing

Native multi-user in SuperSync, accounts or roles in SP, same-device
profiles, notes/subtasks/comments on Plainspace items, multiple assignees,
team or workload views, sharing time tracked, SP-hosted public links,
per-list visibility settings. Dropped in rev. 4 as unneeded: conditional
writes (`ifUpdatedAt`), `clientRef`, `capabilities`, `joinUrl`, delta polling,
`GET /tasks?ids=`, a server guard on recurring times, a pending-changes
indicator, a docker E2E harness.

## Open questions for the maintainer

1. **#3969.** Comment with the concrete scope and a tracking link; reopening
   the broad issue is optional.

## Sources

Vendor help pages, checked Oct 2026 via web search summaries:
[Microsoft To Do: assign tasks](https://support.microsoft.com/en-us/ToDo/assign-tasks-in-shared-lists),
[share a list](https://support.microsoft.com/en-us/todo/share-a-task-list);
[Todoist: assign tasks](https://todoist.com/help/articles/360007314279),
[reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU);
[TickTick: shared lists](https://help.ticktick.com/articles/7055781706355179520);
[Google Tasks: assigned tasks](https://support.google.com/tasks/answer/11549608?hl=en);
[Sunsama with teammates](https://help.sunsama.com/docs/using-sunsama-with-teammates);
[Motion: workspaces and My Tasks](https://help.usemotion.com/product-and-feature-guides/projects/the-projects-tab/managing-workspaces-private-public-and-my-tasks);
[Amazing Marvin: lists for non-users](https://help.amazingmarvin.com/en/articles/6348551-shared-lists-for-nonusers-of-marvin);
[Ink & Switch Keyhive](https://www.inkandswitch.com/project/keyhive/);
[Jazz: lessons from classic](https://jazz.tools/blog/what-we-learned-from-classic-jazz).

Plainspace server facts are from `super-productivity/plainspace` at `774071b`
(2026-10-12); SP code references are from `master` at `43269ba`.
