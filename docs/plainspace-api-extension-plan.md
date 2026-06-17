# Plainspace API extension plan — to enable the Super Productivity integration

**Audience:** the Plainspace server team (`Johannesjo/spaces`, `packages/server`).
**Author:** drafted from the SP side while wiring PR #8424 (SP ↔ Plainspace).
**Status:** proposal — three small PAT-authed endpoints + one optional polling
enhancement. No breaking changes; all additive.

> **Why this exists.** SP's Plainspace integration (PR #8424) was built against an
> _assumed_ API and is currently mock-backed. Connecting it to the real backend
> revealed that the live `/api/integration` surface supports only **read my
> assigned tasks** and **toggle done** — which covers SP's "import my tasks +
> sync completion" path, but **not** the two features in the PR's final commits:
> the **claim pool** (claim an unassigned task) and **Share on Plainspace**
> (create a space from SP). Those need new server endpoints. This document
> specifies them, grounded in the existing code so they drop into the current
> patterns.

---

## 1. What the SP client needs, and what exists today

| SP feature                             | SP API call (client)                                   | Real endpoint today                | Gap                                                |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------- | -------------------------------------------------- |
| Verify token / identity                | `getMe$`                                               | `GET /api/integration/me`          | ✅ exists                                          |
| Import my assigned tasks               | `getMyTasks$`                                          | `GET /api/integration/tasks`       | ✅ exists (filter client-side by space)            |
| Refresh one task                       | `getById$`                                             | `GET /api/integration/tasks/:id`   | ✅ exists                                          |
| Push completion back                   | done write-back                                        | `PATCH /api/integration/tasks/:id` | ✅ exists                                          |
| **Push scheduled time**                | `patchTask$ { scheduledAt }`                           | `PATCH /api/integration/tasks/:id` | ⚠️ **extend** (accept `scheduledAt`)               |
| **Read scheduled time**                | `getMyTasks$`/`getById$` → `scheduledAt`/`isRecurring` | `serializeSPTask`                  | ⚠️ **extend** (expose `scheduledAt`/`isRecurring`) |
| **Claim pool (list unclaimed)**        | `getUnclaimedTasks$`                                   | —                                  | ❌ **new endpoint**                                |
| **Claim a task (self-assign)**         | `claimTask$`                                           | —                                  | ❌ **new endpoint**                                |
| **Share on Plainspace (create space)** | `createSpace$`                                         | —                                  | ❌ **new endpoint**                                |
| Efficient polling                      | poll loop                                              | full refetch only                  | ⚠️ optional: `?updatedSince=`                      |

All three new endpoints reuse the existing `apiTokenMiddleware`, the
`loadIntegrationScope()` helper, and the `SPTask` DTO already defined in
`integration.ts`. No new auth machinery.

### Recap of the existing integration model (for context)

`apiTokenMiddleware` resolves a `pat_…` bearer token to a verified email
(blind-indexed `emailLookup`). `loadIntegrationScope(emailLookup)` then finds
every `members` row for that email where `emailVerified = true` and
`tosVersion = TOS_VERSION`, yielding the set of projects the token may act in.
A single PAT therefore spans **all** of the caller's Spaces — keep that property
for the new endpoints.

---

## 2. New endpoint 1 — Claim a task (self-assign)

```
POST /api/integration/tasks/:taskId/claim
Authorization: Bearer pat_…
→ 200 { task: SPTask }
```

Assigns an **unassigned**, not-deleted task to the caller's member in that task's
project — the server-side of SP's "Claim" button. Mirror the assignment path in
`routes/items.ts` (the `item.assigned` branch) and the transactional pattern in
the existing `PATCH /api/integration/tasks/:taskId`.

**Logic**

1. Load scope. If empty → `404 { error: 'Task not found' }`.
2. Look up the item by id, restricted to `scope.projectIds`, `isNull(deletedAt)`.
   Not found → `404`.
3. Resolve the caller's member for that project:
   `member = scope.memberByProjectId.get(item.projectId)`. Missing → `404`.
4. **Atomic claim** (handles the race where two members claim at once — same
   conditional-update pattern as the verification-code claim in `projects.ts`):

   ```ts
   const [claimed] = await tx
     .update(items)
     .set({ assignedTo: member.id })
     .where(
       and(
         eq(items.id, taskId),
         eq(items.projectId, item.projectId),
         isNull(items.assignedTo), // only if still unclaimed
         isNull(items.deletedAt),
       ),
     )
     .returning();
   if (!claimed) return c.json({ error: 'Task already claimed' }, 409); // lost the race / already assigned
   ```

5. `recordActivity(tx, { action: 'item.assigned', targetType: 'item',
targetId: taskId, memberId: member.id, meta: { text: item.text,
assignedTo: member.id, source: 'sp' } })`.
6. After commit: `sseManager.broadcast(projectId, 'item.updated',
{ item: serializeItem(claimed), memberId: member.id })` and the `activity`
   broadcast — exactly like the PATCH handler, so open web clients see the claim
   live.
7. **Do not** enqueue an `assignmentNotifications` row: claiming is a
   self-assignment, and that table already excludes self-assignments by design
   (see the comment on `assignmentNotifications` and the `assignee !== member.id`
   guard in `items.ts`). Pinging yourself about a task you just claimed is noise.
8. Return `{ task: serializeSPTask(claimed, list, proj, origin) }` (fetch `list`
   - `proj` as the PATCH handler does, or inside the tx).

**Status codes:** `200` claimed · `409` already assigned (to anyone, incl. you) ·
`404` unknown task / not a member / deleted · `401` bad token.

> **Design note — why claim is its own endpoint, not `PATCH …{ assignedTo }`.**
> Exposing arbitrary `assignedTo` over a PAT would let SP assign tasks to _other_
> members, which the integration's security model deliberately forbids (a PAT
> acts only as its own member). `claim` is the one safe, self-scoped assignment:
> it can only ever set `assignedTo = me`, and only from unassigned. This matches
> the asymmetry in `docs/plans/2026-06-02-super-productivity-integration.md`
> ("never let SP dictate assignment into a third party").

---

## 3. New endpoint 2 — List claimable (unassigned) tasks

```
GET /api/integration/claimable-tasks            → { tasks: SPTask[] }
GET /api/integration/claimable-tasks?projectId=<uuid>   (optional filter)
```

The read side of the claim pool: unassigned, not-done, not-deleted items in the
projects the caller is a member of. Same `SPTask` DTO as `/tasks`, so SP's mapper
is unchanged. Structurally identical to the existing `GET /tasks`, with the
assignment predicate inverted:

```ts
const scope = await loadIntegrationScope(emailLookup);
if (scope.memberRows.length === 0) return c.json({ tasks: [] });

const rows = await db.query.items.findMany({
  where: and(
    inArray(items.projectId, projectIdFilter ?? scope.projectIds),
    isNull(items.assignedTo), // unclaimed
    eq(items.checked, false), // not done
    isNull(items.deletedAt),
  ),
});
// then the same list/project hydration + serializeSPTask loop as GET /tasks
```

- `?projectId=` (when present) **must** be intersected with `scope.projectIds`
  so it can't be used to probe foreign projects. SP passes its bound
  `spaceId` here to avoid over-fetching unclaimed tasks from unrelated Spaces.
- Visibility is membership-based and independent of `sharingMode`: members of a
  `private` Space still see its unclaimed items (sharingMode gates _joining_,
  not member visibility).

> **Cheaper alternative if you'd rather not add a path:** a query param on the
> existing endpoint — `GET /api/integration/tasks?scope=claimable` (default
> `scope=assigned`). The dedicated path keeps `/tasks` semantics crisp and reads
> better client-side; either is fine. (This is also the natural place the
> `?updatedSince=` param from §6 would live.)

---

## 4. New endpoint 3 — Create a space (Share on Plainspace)

```
POST /api/integration/spaces
Authorization: Bearer pat_…
Body: { name: string, purpose?: string, displayName?: string }
→ 201 { project: { id, slug, name, purpose, sharingMode }, memberId }
```

Provisions a new Space owned by the PAT's email and returns the ids SP binds its
provider to (`PlainspaceCfg.spaceId = project.id`, link via `project.url`).
Mirror the `POST /api/projects` transaction in `routes/projects.ts`, minus the
email-code gate.

**Logic**

1. Decrypt the PAT's email: `decryptStoredEmail(row)` is already done in
   `apiTokenMiddleware`; expose it via `c.get('apiTokenEmail')` (the middleware
   sets it). Normalize with `normalizeEmail`.
2. Validate body with a new `CreateSpaceViaTokenSchema` (zod, in
   `packages/shared/src/validation.ts`):
   `name 1..MAX_PROJECT_NAME_LENGTH`, `purpose ≤ MAX_PURPOSE_LENGTH default ''`,
   `displayName 1..MAX_DISPLAY_NAME_LENGTH` (default to the email local-part if
   omitted). `safeParse` failure → `422` with `details: error.flatten()`.
3. Transaction (mirrors `projects.ts`):
   ```ts
   const slug = nanoid(SLUG_LENGTH);
   const [project] = await tx
     .insert(projects)
     .values({ slug, name, purpose })
     .returning();
   const [member] = await tx
     .insert(members)
     .values({
       projectId: project.id,
       tokenHash: hashToken(nanoid(TOKEN_LENGTH)), // web-session token; unused by SP, see note
       displayName,
       ...encryptedEmailFields(memberEmail),
       emailVerified: true, // the PAT already proves email ownership
       color: MEMBER_COLORS[0],
       avatarIndex: 0,
       isCreator: true,
       role: 'admin',
       tosVersion: TOS_VERSION,
       tosAcceptedAt: new Date(),
     })
     .returning();
   await ensureProjectDefaults(tx, { projectId: project.id, memberId: member.id });
   ```
4. Return `201 { project: serializeProject(project), memberId: member.id }`.

**Why no email-verification code here.** `POST /api/projects` gates creation on a
6-digit emailed code _or_ a `proofToken` from an existing Space (see
`resolveProofEmail` / `proofVerified`). A valid PAT is a strictly stronger proof
of the same email ownership — it was minted (`api-tokens.ts`) only after that
email was verified inside a Space. So `emailVerified: true` and skipping the code
is consistent with the existing `proofToken` shortcut, not a new trust
assumption.

**The new member's token.** SP does **not** need the returned web-session
`token`: because the new member shares the PAT's `emailLookup`, is
`emailVerified`, and carries the current `tosVersion`, `loadIntegrationScope`
**immediately** includes the new Space for the same PAT. So the existing PAT can
read/claim/patch in the new Space with no re-auth. Returning `memberId` is enough;
omit the session token (or return it for parity — your call).

**Rate limiting.** `POST /api/projects` is IP-rate-limited + code-gated. This
endpoint has neither, so add a per-email cap to stop a leaked PAT from mass-
creating Spaces — e.g. `checkRateLimit('create-space-token:' + apiTokenId, N,
window)` (reuse `lib/rate-limit.ts`). Suggest something conservative (e.g. 10 /
hour).

**Status codes:** `201` created · `422` validation · `429` rate-limited ·
`401` bad token.

---

## 4b. Scheduled time — expose `scheduledAt` / `isRecurring`, accept `scheduledAt`

SP syncs a task's **scheduled time** (`task.dueWithTime`) to a Plainspace item's
existing `remindAt` column. This is **not a new endpoint** — it extends the
`SPTask` DTO (read) and the existing `PATCH /tasks/:id` (write). No new tables;
`items.remindAt` + `items.repeat` and the whole reminder/repeat machinery already
exist. The DTO uses **SP-facing names** that map to those columns:

| DTO field (`SPTask`)          | DB column              | Meaning                                        |
| ----------------------------- | ---------------------- | ---------------------------------------------- |
| `scheduledAt: string \| null` | `items.remindAt`       | ISO instant the task is scheduled for, or null |
| `isRecurring: boolean`        | `items.repeat != null` | whether it repeats (cadence stays server-side) |

### Read — add `scheduledAt` + `isRecurring` to `serializeSPTask`

```ts
return {
  // …existing fields…
  scheduledAt: item.remindAt ? item.remindAt.toISOString() : null,
  isRecurring: item.repeat != null,
};
```

So `getMyTasks$`/`getById$`/`claimable-tasks` all carry them. `isRecurring` is the
yes/no flag SP needs to surface recurrence; the rule itself never crosses the wire.

### Write — accept `scheduledAt` on `PATCH /tasks/:id`

Today the integration PATCH only accepts `{ done: boolean }`. Widen its body
schema to also accept `scheduledAt` (mapped to the `remindAt` column):

```
PATCH /api/integration/tasks/:taskId
Body: { done?: boolean, scheduledAt?: string | null }   // ISO instant, or null to unschedule
```

- Apply the **same `remindAt`/`repeat`/`anchor` invariants** the in-app PATCH uses
  (`applyRepeatUpdate` in `items.ts`): clearing `scheduledAt` (→ `remindAt = null`)
  cascades to `repeat:null`; re-scheduling a repeating item re-anchors the rule.
  SP never sends a rule, so a `scheduledAt`-only PATCH on a repeating item hits
  exactly the "re-anchor existing rule" branch.
- Still **member-scoped**: the PAT can only patch items in `scope.projectIds`,
  and only ever its own caller's item — same guard as the done write-back. SP
  setting `scheduledAt` is self-scoped scheduling, not assignment.
- Validation: reject a `scheduledAt` that isn't a valid ISO instant or `null`
  (`422`).

### Recurrence — server stays authoritative, SP just tracks `scheduledAt`

Deliberately **no rule translation** between Plainspace `RepeatRule` and SP's
`TaskRepeatCfg` (different execution models — Plainspace = one persistent row the
sweep advances; SP = a template that spawns instances — and SP's recurrence is
mid-refactor). Instead:

- **Plainspace → SP:** a repeating item imports as a single ordinary SP task with
  `dueWithTime = scheduledAt` (the next occurrence); `isRecurring` flags it. When
  the sweep advances `remindAt`, SP's poll re-pulls the new `scheduledAt` and
  reschedules the same task. SP needs zero knowledge of the rule.
- **SP → Plainspace:** SP only ever PATCHes a concrete `scheduledAt` (never a
  rule). An SP-recurring task pushes each occurrence as a one-off; Plainspace
  keeps owning any rule it created.

> Behavior to expect (not a bug): completing an imported **recurring** task in SP
> write-backs `done`, the sweep then advances + un-checks the item, and SP's next
> poll reopens it at the new time. Correct for a recurring item; the
> done-write-back ↔ scheduledAt-re-pull interaction wants an idempotency test.

### Client scope in PR #8424

The SP side imports `scheduledAt → dueWithTime` on task add (schedule shows in the
app, with `isRecurring` available to flag recurrence) and pushes
`dueWithTime → scheduledAt` (incl. `null` on unschedule), mirroring the done
write-back. The recurrence-tracking poll extension (re-pull an advanced
`scheduledAt`) is a documented follow-up. `dueDay` (date-only SP scheduling) is
intentionally **not** synced — `scheduledAt` always carries a time, so mapping a
day-only task would fabricate one.

---

## 5. Onboarding caveat (important for the SP "Share" UX)

A PAT can only be minted from **inside an existing Space**
(`POST /api/projects/:slug/auth/api-tokens` requires a logged-in, email-verified
member). Therefore:

- **Creating an _additional_ Space from SP** (the user already has a PAT) →
  fully covered by §4. ✅
- **Creating a user's _first_ Space from SP** (no Space, no PAT yet) → **not**
  possible with PAT-only, because there's nothing to mint a PAT from. This is the
  chicken-and-egg the **device-code flow** in
  `docs/plans/2026-06-02-super-productivity-integration.md` ("Auth: device-code,
  not copy-paste") is meant to solve. Until that lands, SP should gate "Share on
  Plainspace" behind "paste a PAT" (i.e. the user is already a Plainspace member)
  and word the empty state accordingly.

Recommend scoping device-code as its own follow-up (the SP doc already proposes
the `POST /api/integration/device-code` + `…/device-token` pair). It is the
single biggest UX unlock but is independent of the three endpoints above.

---

## 6. Optional — efficient polling (`?updatedSince=`)

Already flagged in the SP-integration brainstorm under "Where this work lives".
Not required for correctness; worth it once many tasks sync.

- Add an `updatedAt timestamptz` column to `items` (`defaultNow()`, bumped on
  every mutating write — check/uncheck, assign, edit, restore). One migration +
  touching the existing item writes to set it.
- Accept `GET /api/integration/tasks?updatedSince=<ISO>` → `and(…, gt(items.updatedAt, since))`.
- Add `updatedAt` to the `SPTask` DTO so SP can store a high-water mark.

SP would then poll with its last-seen timestamp instead of refetching the full
assigned set each interval. Defer until the read volume justifies it.

---

## 7. Shared types to add (`packages/shared/src/types.ts`)

```ts
// response of POST /api/integration/tasks/:id/claim
export interface SPClaimTaskResponse {
  task: SPTask;
}

// response of GET /api/integration/claimable-tasks  (can reuse SPTasksResponse)
export type SPClaimableTasksResponse = SPTasksResponse;

// response of POST /api/integration/spaces
export interface SPCreateSpaceResponse {
  project: Pick<Project, 'id' | 'slug' | 'name' | 'purpose' | 'sharingMode'>;
  memberId: string;
}
```

And in `packages/shared/src/validation.ts`:

```ts
export const CreateSpaceViaTokenSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  purpose: z.string().max(MAX_PURPOSE_LENGTH).default(''),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
});
```

`SPTask` itself is unchanged (add `updatedAt` only if §6 is taken).

---

## 8. Tests (mirror `routes/integration.test.ts`)

`integration.test.ts` already has the harness (PAT minting + `app.request`).
Add, in the same style:

**claim**

- claims an unassigned task → `200`, row `assignedTo === myMember`, `item.assigned`
  activity row written, SSE `item.updated` emitted.
- claiming an already-assigned task → `409`, row unchanged.
- claiming a task in a project I'm **not** a member of → `404` (isolation).
- two concurrent claims → exactly one `200`, one `409` (atomic-update race).
- self-assignment does **not** insert an `assignmentNotifications` row.

**claimable-tasks**

- returns only `assignedTo IS NULL AND checked = false AND deletedAt IS NULL`
  within my projects; excludes mine/others'/done/deleted.
- `?projectId=` outside my scope returns `[]` (no foreign-project probe).

**create-space**

- `201`; `projects` + creator `members` + default `lists`/`scratchpads` rows
  exist; **the same PAT** can immediately `GET /tasks` scoped to the new project.
- validation failure → `422`; over-limit → `429`.

---

## 9. How SP consumes each (so the contract is mutually legible)

All isolated in SP's `PlainspaceApiService` (one file) — see
`docs/plainspace-integration-plan.md`:

| SP method                   | Endpoint                                     | Notes                                           |
| --------------------------- | -------------------------------------------- | ----------------------------------------------- |
| `getMe$` / `testConnection` | `GET /me`                                    | identity + space list                           |
| `getMyTasks$`               | `GET /tasks`                                 | client-filters `task.projectId === cfg.spaceId` |
| `getById$` / poll           | `GET /tasks/:id`                             | freshness for imported tasks                    |
| done write-back             | `PATCH /tasks/:id { done }`                  | on SP task complete/reopen                      |
| scheduled-time sync         | `PATCH /tasks/:id { scheduledAt }` + read    | `dueWithTime ↔ scheduledAt` (§4b)               |
| `getUnclaimedTasks$`        | `GET /claimable-tasks?projectId=cfg.spaceId` | claim pool feed                                 |
| `claimTask$`                | `POST /tasks/:id/claim`                      | then `addTaskFromIssue` imports it              |
| `createSpace$`              | `POST /spaces`                               | bind provider `spaceId = project.id`            |

Two **client-side** fixes SP must make when going real (server unaffected, noting
for completeness): send `Authorization: Bearer <PAT>` on every call (the PAT
lives in `PlainspaceCfg`, not a mock account), and use `SPTask.url` directly for
"open in Plainspace" instead of constructing `…/spaces/:id/tasks/:id` (the real
link is `itemUrl` = `{origin}/{slug}/item/{id}`).

---

## 10. Out of scope (separate plans)

- **Device-code auth** (`/api/integration/device-code` + `/device-token`) — the
  real onboarding fix; see §5 and the SP brainstorm doc.
- **SP → Plainspace promotion** (assign an SP task to someone → seed a Space +
  invite) — the dominant flow in the product vision, larger than this PR's needs.
- **Assignee/“waiting-on” surfacing**, presence, comments, attachments.
- Per-occurrence reminders / repeat rules over the integration channel.

---

## 11. Summary — minimum to unblock SP PR #8424

1. `POST /api/integration/tasks/:taskId/claim` (§2) — **required** for the claim pool.
2. `GET /api/integration/claimable-tasks` (§3) — **required** for the claim pool.
3. `POST /api/integration/spaces` (§4) — **required** for "Share on Plainspace"
   (additional Spaces; first-Space onboarding waits on device-code, §5).
4. `scheduledAt`/`isRecurring` on `serializeSPTask` + `scheduledAt` on
   `PATCH /tasks/:id` (§4b) — **required** for scheduled-time sync. No new
   endpoint/table; extends the read DTO + PATCH via the in-app `applyRepeatUpdate`
   path (DTO `scheduledAt` ↔ db `remindAt`).
5. `?updatedSince=` + `items.updatedAt` (§6) — **optional**, polling efficiency.

All three required endpoints are ~1 handler each, reuse `apiTokenMiddleware` /
`loadIntegrationScope` / `serializeSPTask` / `recordActivity` / `sseManager`, and
add no new tables. Estimated surface: one new file or ~150 lines appended to
`routes/integration.ts`, a handful of shared-type lines, and the tests in §8.
