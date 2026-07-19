# Verified sync simplification priorities

- Status: post-audit derived decision guide
- Date: 2026-07-17
- Source audit snapshot: baseline `5d02ec86…2651`, findings
  `83acd393…c8e9`, retained `ac42fde4…e4d`, verification
  `9dda34db…f18d`

This document orders only the five candidates that reached a clean Wave E
`verified` disposition. It is derived from [verification.md](verification.md),
[findings.md](findings.md), and [retained.md](retained.md); it is not part of
the frozen audit baseline and does not change any candidate's evidence or
disposition.

## Scope and limits

- Five verified candidates are ranked for implementation planning.
- One rejected and two decision-required candidates are listed separately and
  are not implementation candidates.
- The remaining 206 origins / 204 stable groups remain
  `discovered/proposed, unverified` and are not ranked.
- The ordering is qualitative. It does not invent a synthetic score that the
  audit never measured.
- Audit verification is not implementation authorization. Each implementation
  still needs a separately approved change and its required tests.

## Ordering method

Candidates are compared in this order:

1. Behavioral risk and reversibility.
2. User/data-protection payoff and maintenance benefit.
3. Evidence confidence.
4. Validation cost and blast radius.
5. F1 dependency and integration constraints.

All five have reproduced evidence and low behavioral risk. Their order is
therefore driven mainly by privacy payoff, validation cost, compatibility
sensitivity, and dependency sequencing.

N42 and N211 share the same overall risk/reward tier. Their `4a`/`4b` labels
follow F1's recommended integration sequence; they do not claim a measured
benefit or confidence difference between the two candidates.

## Risk/reward matrix

| Priority | Candidate                                                         | Reward                                          | Risk and cost                                                        | Why it belongs here                                                                                                                        |
| :------: | ----------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
|    1     | `SSA-0025` / N25 — stop retaining decrypted JSON samples          | High privacy payoff; medium maintenance benefit | Low behavioral risk; medium validation                               | Removes plaintext retention from error objects while preserving recovery and routing. It has the clearest direct user-data benefit.        |
|    2     | `SSA-0009` / N09 — remove duplicate final-upgrade mock assertions | Medium maintenance benefit                      | Low behavioral risk; small validation                                | A small, reversible test-only deletion backed by the real IndexedDB descriptor test and version-threshold coverage.                        |
|    3     | `SSA-0202` / N202 — remove unused SuperSync E2E helper APIs       | Medium maintenance benefit                      | Low behavioral risk; small validation                                | Removes 13 unused unpublished helpers and is isolated from production and the application integration harness.                             |
|    4a    | `SSA-0042` / N42 — remove unused legacy database writers          | Medium maintenance benefit                      | Low behavioral risk; medium validation; compatibility-sensitive area | The methods are unused, but the surrounding legacy migration and recovery boundary justifies later integration and broader validation.     |
|    4b    | `SSA-0211` / N211 — remove definition-only integration APIs       | Medium maintenance benefit                      | Low behavioral risk; medium validation; widest test-harness surface  | Removes 17 APIs, but must retain call-history storage and the awaited zero-latency ordering boundary across five direct harness consumers. |

The matrix has no high-risk verified row. That is a result of fast-track
admission deliberately preferring a smaller low-risk shortlist, not evidence
that the broader findings register is low risk.

## Ranked implementation notes

### 1. SSA-0025 — decrypted JSON sample retention

- **Revision:**
  `79a3da4fd738460559d70b974ef52eb8093cc3c9cfc07b7145fe5a8f32a98ff4`
- **Reward:** removes an unnecessary plaintext snippet from a diagnostic error
  object and reduces the chance of user data entering exported diagnostics.
- **Guardrails:** preserve `JsonParseError` identity, safe message, numeric
  parse position, fail-closed parsing/decryption, `.bak` recovery, wrapper
  routing, and force-overwrite behavior.
- **Required proof:** error/encryption/wrapper/file-adapter recovery specs plus
  a sentinel showing plaintext is absent from own properties, JSON
  serialization, and exported logs.
- **Dependency:** must precede N42 and N211 in the integrated roadmap because
  of shared wrapper/file-adapter evidence boundaries.

### 2. SSA-0009 — duplicate IndexedDB upgrade test

- **Revision:**
  `1dd864b5c919289ea9624bb3547d6332f23a48cf9b5f3621aee7f4623c914ff9`
- **Reward:** removes a duplicated mocked representation of the final schema
  and its maintenance burden.
- **Guardrails:** retain every historical threshold test, v7 metadata seeding,
  v10 downgrade protection, and the real v0-to-current descriptor check.
- **Required proof:** both focused upgrade specs and a mutation check showing
  the real descriptor guard fails when a store or index drifts.
- **Dependency:** should precede N42 so the destination-schema evidence is
  stable before changing the legacy source bridge.

### 3. SSA-0202 — unused SuperSync E2E helpers

- **Revision:**
  `1a69b3ad2f75e847a37ac3cfdaea416cf9ca0c37cd00a087000e214b28ea6d5a`
- **Reward:** removes 13 unused exports and reduces the apparent E2E helper
  vocabulary without deleting any scenario.
- **Guardrails:** delete only the verified symbols and imports made unused;
  retain every helper with a live scenario consumer.
- **Required proof:** check both helper files, compile/list E2E discovery, and
  confirm no barrel, namespace, dynamic, or external harness consumer appears.
- **Dependency:** isolated; it may be developed in parallel with N25 and N09.

### 4a. SSA-0042 — unused LegacyPfDbService writers

- **Revision:**
  `68dff22a1f2ee21c97156cfb977ff5adb4209cd20bbad3f75d6f414d73f3b902`
- **Reward:** removes two dead internal methods and their direct-only tests.
- **Guardrails:** retain every legacy database name, version, store, key, read,
  generic save, metadata/client-ID path, migration lock, archive migration,
  reminder cleanup, and recovery path.
- **Required proof:** legacy service, startup, reminder, archive migration, and
  operation-log migration/recovery tests.
- **Dependency:** integrate only after N25 and N09, then rerun the shared
  wrapper and persistence-compatibility evidence.

### 4b. SSA-0211 — definition-only integration harness APIs

- **Revision:**
  `d75667b114fd1b86c1661d888f6dd672b64c480601f6b8a2b6c022ea38fc312a`
- **Reward:** removes 17 unused test APIs and stale example text from five
  helper files.
- **Guardrails:** retain provider CAS/error behavior, live `getCallsTo`, its
  call-history storage, reset behavior, ready-by-default behavior, and the
  awaited zero-latency asynchronous boundary.
- **Required proof:** check all five helper files, run TypeScript discovery,
  and run the five direct file-based-sync integration consumers.
- **Dependency:** integrate after N25; it remains independent of N42 once that
  edge has been satisfied.

## Development and integration order

The risk/reward ranking and F1 dependency graph permit this execution shape:

1. Develop N25, N09, and N202 independently.
2. Integrate them sequentially as N25 → N09 → N202.
3. After N25 and N09 are integrated, develop N42 and N211 independently.
4. Integrate N42, rerun legacy migration/recovery evidence, then integrate
   N211 and rerun its five direct integration suites.

Keep every stable ID in its own reviewable implementation slice. Do not bundle
the rejected or decision-required records into these changes.

## Explicitly excluded from the ranking

| Candidate            | Disposition       | Reason                                                                                                         |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `SSA-0167` / B35-C14 | Rejected          | Its immutable packet missed a second exportable calendar-content log. A wider two-sink proposal is unverified. |
| `SSA-0043` / B12-C01 | Decision-required | Static evidence was favorable, but the verifier did not complete the mandatory after-baseline reproduction.    |
| `SSA-0188` / B35-C35 | Decision-required | The fresh verifier session returned neither a terminal report nor an after-baseline reproduction.              |

The other 206 origins are research inventory, not an ordered implementation
queue. Ranking them would require a separate evidence pass that assigns the
same four bands and resolves compatibility, consumer, and validation gaps
without modifying the frozen audit records.

## How to use this document

- Use this file for prioritization and sequencing only.
- Use `verification.md` for authoritative verifier evidence and F1 edges.
- Use `findings.md` for the immutable candidate packet and revision hash.
- Use `retained.md` for boundaries that must survive implementation.
- At implementation time, run `npm run checkFile <filepath>` for every changed
  TypeScript file and the candidate-specific tests listed above.
- Record implementation PRs and outcomes in a new document or issue; do not
  rewrite the frozen audit artifacts.
