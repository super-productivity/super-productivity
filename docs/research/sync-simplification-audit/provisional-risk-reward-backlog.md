# Provisional sync simplification risk/reward backlog

- Status: post-audit derived triage; all entries remain unverified
- Date: 2026-07-17
- Source audit snapshot: baseline `5d02ec86…2651`, findings
  `83acd393…c8e9`, retained `ac42fde4…e4d`, verification
  `9dda34db…f18d`
- Authoritative verified queue:
  [verified-risk-reward.md](verified-risk-reward.md)

This document applies a readiness-adjusted risk/reward ordering to 25 groups
nominated from the 204 stable groups that did not enter the terminal Wave E
register. It is derived from [findings.md](findings.md),
[verification.md](verification.md), and [retained.md](retained.md). It does not
rank the complete 204-group universe, modify the frozen audit, verify a
candidate, authorize implementation, or claim exhaustive cross-cutting
verification.

## Reconciled universe

| Disposition at the end of the audit | Stable groups | Treatment here                                |
| ----------------------------------- | ------------: | --------------------------------------------- |
| Verified                            |             5 | Kept only in the authoritative verified queue |
| Rejected                            |             1 | Excluded                                      |
| Decision-required after Wave E      |             2 | Excluded                                      |
| Discovered/proposed, unverified     |           204 | 25 nominated and ranked; 179 remain unranked  |
| **Total**                           |       **212** | D1-normalized stable groups                   |

The 204 eligible groups were screened in three disjoint stable-ID ranges:
66 groups in `SSA-0001`–`SSA-0070`, 70 in `SSA-0071`–`SSA-0140`, and 68 in
`SSA-0141`–`SSA-0212`. Those passes nominated 25 candidates but did not assign
the same four bands to every omitted group or prove that no omitted candidate
could outrank the cutline. This was packet-level screening only. Source
consumers, history, tests, and revision hashes were not freshly re-verified.

## Ordering method

Within the nominated shortlist, the ranking uses only fields already recorded
in each immutable origin packet:

1. User-data protection, data-integrity protection, or removal of false test
   and architecture confidence.
2. Maintenance payoff, including bounded production/test deletion and removal
   of misleading contracts.
3. Stated behavioral risk, reversibility, and evidence confidence.
4. Required validation breadth, reviewer count, compatibility gates, and
   dependencies.
5. The fast-track D2–D4 non-admission register and retained-mechanism rules.

No synthetic numeric score was created. `Reproduced` and `supported` below are
the origin packet's evidence labels, not fresh verifier verdicts. Ranks are
readiness-adjusted: a high-value item with an unresolved decision or broad
validation gate can appear below a smaller but well-bounded candidate.

## Provisional ranked shortlist (25)

### Tier A — recommended next verification wave

These eight have the best current combination of user, test-integrity,
documentation, or maintenance value, bounded scope, reversibility, and
evidence. Their order is a verification priority, not an implementation
dependency graph.

| Rank | Candidate                                                                            | Expected reward                                                                                  | Packet risk / evidence                 | Verification burden                                                                 |
| ---: | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------- |
|    1 | `SSA-0045` / B12-C03 — Stop exporting full task objects from repair diagnostics      | High privacy value; closes three exportable user-content paths                                   | Low behavioral risk; reproduced        | Medium; sentinel export tests, repair/log suites, two privacy/sync reviewers        |
|    2 | `SSA-0173` / B35-C20 — Make owner-local task and reminder diagnostics privacy-safe   | High privacy value; removes five title/task/repeat payload logs                                  | Low behavioral risk; reproduced        | Medium; three owners, focused effects suites, sentinel, privacy/domain reviewer     |
|    3 | `SSA-0190` / B35-C37 — Remove generic values from exportable utility logs            | High preventive privacy value; removes a generic future-content footgun                          | Low behavioral risk; supported         | Small–medium; sentinel/date/sync-window suites and privacy/sync reviewer            |
|    4 | `SSA-0151` / B36-C01 — Delete the orphaned encryption E2E failure memo               | High documentation value; removes 525 stale, misleading lines                                    | Negligible runtime risk; reproduced    | Small; closure, Markdown/link checks, and fresh test-doc reviewer                   |
|    5 | `SSA-0068` / B16-C01 — Make the immediate-upload debounce failure test deterministic | High test-integrity value; replaces unreachable timing coverage                                  | Low risk; reproduced                   | Small; one spec, fake time, mutation checks, and timing-test reviewer               |
|    6 | `SSA-0026` / B09-C01 — Remove the unused compact log-entry codec half                | High maintenance value; about 160–180 source/test LOC and a false persisted-format model removed | Low, format-sensitive risk; reproduced | Medium; closure and codec/storage suites; origin assigns no reviewer count          |
|    7 | `SSA-0136` / B34-C02 — Finish the dead DeviceService cleanup                         | High maintenance value; about 160–200 source/test LOC removed                                    | Low runtime risk; reproduced           | Medium; device/upload/sync suites, build/typecheck, device-lifecycle reviewer       |
|    8 | `SSA-0135` / B34-C01 — Delete the obsolete standalone decompression helper           | High maintenance value; about 140–170 source/test LOC removed                                    | Low risk; reproduced                   | Medium; parser assertion inventory, compressed-route suites, server-boundary review |

### Tier B — strong reserves

These are promising, but their validation surface, security sensitivity, or
sync/test ownership is broader than Tier A.

| Rank | Candidate                                                                                | Expected reward                                                                                      | Packet risk / evidence                              | Main gate                                                                                 |
| ---: | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
|    9 | `SSA-0092` / B23-C04 — Allowlist provider-host diagnostic metadata                       | High privacy value and a simpler fixed allowlist                                                     | Medium security-sensitive risk; reproduced          | Sentinels, two privacy/provider reviewers, and serialization with B23-C03                 |
|   10 | `SSA-0072` / B16-C05 — Keep raw upload errors out of exportable logs                     | High privacy value across active upload paths                                                        | Medium privacy-sensitive risk; reproduced           | Upload/immediate-upload/error-meta suites and two privacy/provider reviewers              |
|   11 | `SSA-0120` / B28-C03 — Sanitize WebSocket errors before exportable logging               | High privacy value across close/reconnect/error paths                                                | Medium privacy-critical risk; reproduced            | Three-service canaries, both export forms, and two privacy/sync reviewers                 |
|   12 | `SSA-0139` / B33-C01 — Delete the unreachable cached-snapshot read and invalidation path | High maintenance value; about 120 source/test LOC and a false recovery path removed                  | Low behavioral risk; reproduced                     | Closure, snapshot suites, build/typecheck, and fresh server/C1 reviewer                   |
|   13 | `SSA-0002` / B05-C01 — Retire the superseded duplicate-ingestion APIs                    | High maintenance value; about 190–270 source/test/doc LOC and a known-racy alternative model removed | Medium test-helper risk; reproduced                 | Broad store/recovery/remote-apply/conflict/sync proof; origin assigns no reviewer count   |
|   14 | `SSA-0066` / B15-C04 — Delete the weaker duplicate gap-key refresh test                  | Medium test-maintenance value; about 55 test LOC removed                                             | Low risk; reproduced                                | Assertion-set diff, focused mutations, and fresh encryption-test reviewer                 |
|   15 | `SSA-0030` / B08-C01 — Remove the dead remote-rehydration facade chain                   | Medium-high maintenance value; about 65–95 source/test LOC removed                                   | Low risk; reproduced                                | Startup/hydrator/retry/wrapper closure; origin assigns no reviewer count                  |
|   16 | `SSA-0058` / B13-C01 — Delete orphaned PFAPI constants and legacy-only type aliases      | High maintenance value; about 90–105 production LOC removed                                          | Low risk after export closure; reproduced           | PFAPI compatibility coordination, package/build checks, and contract reviewer             |
|   17 | `SSA-0155` / B36-C05 — Delete page-object APIs left by obsolete encryption tests         | High test-maintenance value; about 245–255 test LOC removed                                          | Low runtime risk; reproduced                        | Closure, password scenarios, scheduled encrypted SuperSync, encryption-E2E reviewer       |
|   18 | `SSA-0142` / B33-C04 — Make the PostgreSQL vector-clock test execute production SQL      | High data-integrity/test-truth value                                                                 | No runtime risk; medium validation cost; reproduced | Real PostgreSQL integration, query mutations, and B33/B36 reviewer                        |
|   19 | `SSA-0047` / B12-C05 — Consolidate the #7330 diagnostic validator harness                | High test-maintenance value; about 170–230 test LOC removed                                          | Low implementation risk; reproduced                 | Assertion map, canonical/ValidateState/replay suites, two validation/sync reviewers       |
|   20 | `SSA-0034` / B08-C05 — Collapse superseded local-only hydration test permutations        | High test-maintenance value; about 180–240 test LOC removed                                          | Low risk; reproduced                                | Per-key mutation map across operation/snapshot/dispatch; origin assigns no reviewer count |

### Tier C — high payoff, gated

These remain visible because their potential payoff is substantial. Any
source-recorded admission prerequisite must be resolved before admission;
verification requirements run only inside a separately authorized wave. No
gate may be resolved through unrecorded verification outside a new amendment.

| Rank | Candidate                                                                                      | Expected reward                                                                                 | Packet risk / evidence                                | Gate type and requirement                                                                                                         |
| ---: | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
|   21 | `SSA-0209` / B36-C18 — Delete the legacy archive suite that only echoes its fixture            | High test-maintenance value; 445 test LOC and false coverage removed                            | Low–medium coverage risk; reproduced                  | Verification: import/export E2E; archive service, reducer, and data-repair suites; parent/subtask assertions; reviewer            |
|   22 | `SSA-0102` / B30-C04 — Table-drive provider retry-classifier specifications                    | Medium-high test-maintenance value; about 120–180 test LOC removed                              | Low risk; reproduced                                  | Verification: exact case/name/literal inventory, focused package specs/typecheck, test-quality reviewer                           |
|   23 | `SSA-0141` / B33-C03 — Consolidate snapshot fast-forward tests into active owners              | Very high maintenance value; about 900–1,100 test/config LOC removed                            | No runtime risk; medium validation cost; reproduced   | Verification: machine-readable scenario matrix, causal mutations, active service/route and normal package tests, B33/B36 reviewer |
|   24 | `SSA-0143` / B35-C01 — Replace the unsafe Android sequence-hint roadmap with a rejection fence | High preventive data-integrity value; removes a data-loss-prone recipe                          | Documentation-only but sync-critical; unverified      | Verification: two sync reviewers, exact-reference/link checks, and mandatory preservation of the rejection fence                  |
|   25 | `SSA-0087` / B22-C01 — Delete the impossible SuperSync disable-encryption path                 | High maintenance/security value; about 100–130 LOC and a destructive always-failing API removed | Security/sync-critical; medium validation; reproduced | Verification: closure/guards/E2E, two encryption/workflow reviewers, and preservation of every file-based disable path            |

## Tier A verification packets

### 1. SSA-0045 — Stop exporting full task objects from repair diagnostics

- **Revision:**
  `5ce3f82462290e2557c246139d24342aacc82d3ea0ed1d942107cc3351eabbc9`
- **Preserve:** repair results, summary counts, ordering, replay, and wire data.
- **Prove:** sentinel task titles cannot enter exported history; retain safe
  labels/counts/IDs and run the complete repair/log coverage.
- **Trade-off:** diagnostic payload detail is deliberately reduced.

### 2. SSA-0173 — Make owner-local task and reminder diagnostics privacy-safe

- **Revision:**
  `23150221dbb76bb3c4ca160d0c675e3faa08aa20d1b397ba71544d904d38bccf`
- **Preserve:** scheduling, dispatch, persistence, reminder delivery, repeat
  creation, and tag ordering.
- **Prove:** task titles, notes, reminder titles, and repeat payloads remain
  absent from exported logs across all three owners.
- **Trade-off:** five content-bearing debug messages disappear.

### 3. SSA-0190 — Remove generic values from exportable utility logs

- **Revision:**
  `757f9d9a748ff2f45686a1119cc0e731757b5cb14fc6e960f9fdec0bae6eebe9`
- **Preserve:** sync-window ordering, timeout/proceed behavior, formatting, and
  fallback values.
- **Prove:** generic values and value-bearing exceptions cannot reach exported
  logs; content-free phase/category diagnostics may remain.
- **Trade-off:** arbitrary formatting and operator payload detail is removed.

### 4. SSA-0151 — Delete the orphaned encryption E2E failure memo

- **Revision:**
  `2e4db0e7be318d4cbf8adb6f35dab1a6f5bd480b2d25153a0bd10c8b91f3ac4e`
- **Preserve:** current execution guidance in `e2e/CLAUDE.md`, live encryption
  scenarios, and every supported encryption contract.
- **Prove:** backlink, path, local-storage-key, and selector closure; Markdown
  links and the final diff remain clean.
- **Trade-off:** a 525-line obsolete failure memo disappears, leaving current
  executable owners as the authority.

### 5. SSA-0068 — Make the immediate-upload debounce failure test deterministic

- **Revision:**
  `6df55bc133102b81dddc43f69604cd8cac330b8779f0c2c9123755409c68a6dd`
- **Preserve:** the real 2,000 ms debounce boundary, rejected-promise handling,
  queue restoration, and status restoration.
- **Prove:** fake-time mutation checks fail when call timing or error recovery
  regresses; no wall-clock wait remains.
- **Trade-off:** none beyond replacing a misleading test implementation.

### 6. SSA-0026 — Remove the unused compact log-entry codec half

- **Revision:**
  `219cf80e1322d1fa422d9d86ee3aa0c2681e37f37551ee183046313cb0308ae7`
- **Preserve:** compact operation encoding, historical full-operation rows,
  lifecycle fields, IndexedDB storage, and file-sync envelopes.
- **Prove:** no package, dynamic, persisted, wire, or production consumer uses
  the whole-entry codec before deleting it and its direct tests.
- **Trade-off:** an unused alternative persisted-format model disappears.

### 7. SSA-0136 — Finish the dead DeviceService cleanup

- **Revision:**
  `70dbbe8fdb8ae198357b047188bfbef3b9a5785faee8808014ef58c421ed3aa1`
- **Preserve:** live device upsert and state initialization behavior.
- **Prove:** both target methods remain test-only after full closure; run
  device, upload, sync-service, and duplicate-precheck coverage.
- **Trade-off:** direct tests of the dead queries are removed with them.

### 8. SSA-0135 — Delete the obsolete standalone decompression helper

- **Revision:**
  `10a6e2e7cd16885b6f753ef8bba229a0ddf4ac32753bea5e51103600cacf5e27`
- **Preserve:** gzip parsing, request-size enforcement, invalid-input errors,
  Unicode behavior, and the live compressed request boundary.
- **Prove:** every unique assertion is retained by the integrated parser suite
  before deleting the standalone helper and tests.
- **Trade-off:** none if the assertion inventory closes cleanly.

## Exact revision registry for ranks 9–25

| Rank | Stable ID  | Origin  | Immutable revision                                                 |
| ---: | ---------- | ------- | ------------------------------------------------------------------ |
|    9 | `SSA-0092` | B23-C04 | `77734fe3b1b29989be623210544f8ddb7b88bd002cc59e015299677ff05fc4b2` |
|   10 | `SSA-0072` | B16-C05 | `466640e8678c7b432f94cc5ffb95d847d734288ff16bd234a7e1e9db6c6b2075` |
|   11 | `SSA-0120` | B28-C03 | `3aab82a0f96195288147cf8fe717ddde4952d0bce2bc9464409c665cb54bd775` |
|   12 | `SSA-0139` | B33-C01 | `5c3f0a71881d6a711372e2a973bf891b218757bf16d66bdab68f20021b61fbc3` |
|   13 | `SSA-0002` | B05-C01 | `a21ee57393756742748ade8d994826239756cd72b48069d904c1a94f8b7a324b` |
|   14 | `SSA-0066` | B15-C04 | `f672d40f8a0a056bb1d24de50f996df8875644cb2fba703f56447b3e4217d673` |
|   15 | `SSA-0030` | B08-C01 | `a360c8019486e74642c0fb45072dba3b448f211888832191f5727c8564fa6528` |
|   16 | `SSA-0058` | B13-C01 | `df039e9b1843346331007c282396a26886943c8c44c51f6ed0fd4bf75bc4cbfc` |
|   17 | `SSA-0155` | B36-C05 | `6fa4a8556c0704785572d231b42338cac69582a52714888493151269d4298295` |
|   18 | `SSA-0142` | B33-C04 | `86b186bf0d756b29e6ee6b24b9c641d5f5bc70902edb8f3e248c3c787644bdd0` |
|   19 | `SSA-0047` | B12-C05 | `f01857a7d6a305ecd82c5b538c86410a63df1d04af786978454f30929155423b` |
|   20 | `SSA-0034` | B08-C05 | `18392a332fc8db1f618aae3ac128dd8348e1e52a71e957c2b68b76c0d6916371` |
|   21 | `SSA-0209` | B36-C18 | `b4895172386076789b23db51354a9bc8e89bc4c056f0259c2b6dea5bfaa7ca5a` |
|   22 | `SSA-0102` | B30-C04 | `38eac966b43dd48a255ef7883766f5312b26b17cd50d5fa8f30808ab41081684` |
|   23 | `SSA-0141` | B33-C03 | `304d587e986b8d45e6b9b9eca27cb660cc0acee662b1e464a6c82cf7384b74cd` |
|   24 | `SSA-0143` | B35-C01 | `be4fcefe437b1d10105885883aab2e8ca4e68666a790ea27a381ee1b671143bb` |
|   25 | `SSA-0087` | B22-C01 | `d27e6079df3c9b422ed82b7414ed09f2ff79496b9c78c05b3685be64d6adc20f` |

## Reviewer and validation registry

This registry carries forward the origin packet's reviewer wording and the
main source-recorded gate. “None assigned” means the origin says `none yet`; it
does not waive fresh review. Any future amendment should assign one fresh
domain reviewer to ranks 6, 13, 15, and 20 before admission.

| Rank | Origin reviewer requirement             | Mandatory validation or dependency                                                                                                                                  |
| ---: | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | Two fresh privacy/sync reviewers        | Sentinel-title exclusion, core log export, full data-repair specs, and modified-file checks                                                                         |
|    2 | Fresh privacy/reminder/repeat reviewer  | All three owners, focused reminder/tag/repeat effects, and exported-log sentinel                                                                                    |
|    3 | Fresh privacy/sync reviewer             | Sentinel log spies, locale-date and day-change/sync-window specs, and modified-file checks                                                                          |
|    4 | Fresh test-doc reviewer                 | Backlink/path/key/selector closure, Markdown-link scan, and `git diff --check`                                                                                      |
|    5 | Fresh timing-test reviewer              | Fake time before/at 2,000 ms, rejection handling, queue/status restoration, and modified-file check                                                                 |
|    6 | None assigned (`none yet`)              | Tracked/export/dynamic closure; codec, historical-row, file-adapter, and compact-operation suites                                                                   |
|    7 | Fresh device-lifecycle/server reviewer  | Device, upload, sync-service, duplicate-precheck, server build/typecheck, and modified-file checks                                                                  |
|    8 | Fresh server-boundary reviewer          | Preserve unique Unicode/invalid-base64 assertions; decompression/route specs, server build/typecheck, modified files                                                |
|    9 | Two fresh privacy/provider reviewers    | Both log exports and sentinel fields; serialize with B23-C03 in the credential store                                                                                |
|   10 | Two fresh privacy/provider reviewers    | Both exports, safe category/status retention, and upload/immediate-upload/error-meta specs                                                                          |
|   11 | Two fresh privacy/sync reviewers        | Close/reconnect/auth/incomplete/generic canaries, both exports, WebSocket/download/wrapper/logger specs, B13 catch                                                  |
|   12 | Fresh server/C1 reviewer                | Symbol/export/reflection closure, snapshot service specs, package build/typecheck, and modified-file checks                                                         |
|   13 | None assigned (`none yet`)              | Git/computed closure; store, simulated-client, recovery, remote-apply/conflict, targeted and scheduled sync suites                                                  |
|   14 | Fresh encryption-test reviewer          | Assertion-set subset, focused download spec, and mutations for refresh, retry, key application, and fail-closed errors                                              |
|   15 | None assigned (`none yet`)              | Static method closure plus hydrator, DataInit, retry-integration, and sync-wrapper specs                                                                            |
|   16 | Fresh contract reviewer                 | Static/export/serialized-name closure, TypeScript build, sync-shell and backup-compatibility specs                                                                  |
|   17 | Fresh encryption-E2E reviewer           | Symbol/reflection closure, page-object typecheck, password scenarios, scheduled encrypted SuperSync; coordinate B22-C01                                             |
|   18 | Fresh database-test/B33/B36 reviewer    | Isolated PostgreSQL integration, active download spec, WHERE/aggregation mutations, and modified-file checks                                                        |
|   19 | Two fresh validation/sync reviewers     | Assertion map, canonical validator, `ValidateState`, and real #7330 replay/convergence suites                                                                       |
|   20 | None assigned (`none yet`)              | Every local-only key across operation payload, snapshot, and dispatch, plus hydration/local-only utility specs                                                      |
|   21 | Fresh archive/compatibility reviewer    | Legacy import/export E2E; archive service, reducer, data-repair; both parent/subtask sides; keep B36-C14 separate                                                   |
|   22 | One test-quality reviewer               | Exact case-name/literal inventory, focused package specs/typecheck, and modified-file checks                                                                        |
|   23 | Fresh B33/B36 test reviewer             | Machine-readable scenario matrix; mutations for causal predicate, effective cursor, gap baseline, and response; active service/route specs and normal package tests |
|   24 | Two fresh sync reviewers                | Cursor authority, exact references, Markdown/links, and preservation of an explicit rejection fence                                                                 |
|   25 | Two fresh encryption/workflow reviewers | SuperSync-disable closure, dialog/guard cases and scheduled E2E; preserve every file-based disable method/dialog/test                                               |

## Proposed next verification step

If a new execution amendment is authorized, admit Tier A only: eight
candidates and nine reviewer runs. Assign two privacy/sync reviewers to
`SSA-0045`; assign one packet-domain reviewer to each other candidate, including
the currently unassigned `SSA-0026`. The remaining domains are
privacy/reminder/repeat, privacy/sync, test-doc, timing-test,
format/codec, device-lifecycle/server, and server-boundary. Any candidate later
classified as sync-critical still requires two fresh reviewers; shrink the
shortlist or raise the explicitly authorized run budget rather than weakening
that rule.

This proposal does not authorize those runs. It also does not establish an
implementation order. A new dependency graph should contain only candidates
that successfully complete fresh verification.

## Packet-triage cutline

The three packet screenings nominated the following 25 groups. The outside
count is an arithmetic reconciliation, not candidate-level comparison evidence
or a claim that every omitted group has the same reason for omission.

| Stable-ID packet range | Eligible | Selected | Outside cutline | Selected stable IDs                                  |
| ---------------------- | -------: | -------: | --------------: | ---------------------------------------------------- |
| `SSA-0001`–`SSA-0070`  |       66 |        9 |              57 | 0002, 0026, 0030, 0034, 0045, 0047, 0058, 0066, 0068 |
| `SSA-0071`–`SSA-0140`  |       70 |        8 |              62 | 0072, 0087, 0092, 0102, 0120, 0135, 0136, 0139       |
| `SSA-0141`–`SSA-0212`  |       68 |        8 |              60 | 0141, 0142, 0143, 0151, 0155, 0173, 0190, 0209       |
| **Total**              |  **204** |   **25** |         **179** | —                                                    |

## Explicit routing and exclusions

- The current five verified candidates stay in
  [verified-risk-reward.md](verified-risk-reward.md); they are not duplicated
  here. `SSA-0167` remains rejected, while `SSA-0043` and `SSA-0188` remain
  decision-required after Wave E.

| Routing outside the ranked shortlist         | Stable IDs / origins                                                                                  | Required treatment                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility-gated                          | `SSA-0037` / B07-C03                                                                                  | Do not admit until the stale SQLite rollout branch is explicitly rebased or retired; retain A6-PW-015 and issue routing.                                      |
| Missing combined packet/public closure       | `SSA-0091` / B23-C03 plus alias B30-C01                                                               | Produce one immutable combined packet and close the public/out-of-tree surface before admission.                                                              |
| Atomic enforcement plan required             | `SSA-0021` / B01-C01 with `SSA-0114` / B37-C01                                                        | Keep replacement and enforcement atomic and under the existing issue; neither half is an independent cleanup.                                                 |
| Assertion ownership incomplete               | `SSA-0078` / B20-C02                                                                                  | Complete the assertion-owner inventory and decomposition before considering its large test deletion.                                                          |
| Behavior-change decision required            | `SSA-0168` / B35-C15                                                                                  | Obtain a maintainer decision and two sync/plugin reviewers for changed persisted-operation and plugin-event provenance.                                       |
| High-payoff gated reserve                    | `SSA-0008` / B06-C02                                                                                  | First complete `SSA-0007`; then preserve both adapter suites, migration, dual-backend remote apply, scenario counts, and engine-specific lifecycle/isolation. |
| Materially challenged privacy reserve        | `SSA-0212` / C8-N01                                                                                   | Characterize runtime reachability and alert/issue behavior before admission; then require privacy/error-boundary review and sentinel tests.                   |
| Correctness/hardening workstream             | `SSA-0033` / B08-C04; `SSA-0036` / B07-C02; `SSA-0039` / B10-C02                                      | Route through bugfix or hardening work, not behavior-preserving simplification admission.                                                                     |
| Already-tracked evidence                     | `SSA-0006` / B05-C05; `SSA-0022` / B01-C02; `SSA-0080` / B20-C04; `SSA-0114`–`SSA-0116` / B37-C01–C03 | Keep under existing A5/A6/issue ownership. The links are routing evidence, not fresh verification.                                                            |
| Source-named capacity reserves below cutline | `SSA-0014` / B03-C02; `SSA-0129` / B29-C04                                                            | Keep visible as reserves without inventing a new common value band; coordinate SSA-0129 with, but keep it separate from, SSA-0078.                            |
| All other omitted groups                     | Remaining groups outside the shortlist                                                                | Retain their packet-specific consumer, format, scenario, reviewer, compatibility, and existing-work gates.                                                    |

High-LOC test proposals remain unverified; deletion size alone does not
outweigh incomplete assertion ownership or validation cost. The 179 groups
outside the shortlist remain exactly `discovered/proposed, unverified`. The
25 selected groups are ordered, but the cutline is not a complete value ranking
of all 204 groups: omission is neither rejection nor proof of lower reward.

## Provenance and frozen boundaries

- Findings SHA-256:
  `83acd393736396f8b9de33b961dbab82347443fd8fa9e9f410cb5fc5aab0c8e9`
- Verification SHA-256:
  `9dda34dbcba5390297de172dcfd1eacc1bc27e32ed174f3245298567d563f18d`
- Retained-register SHA-256:
  `ac42fde4d895e1993561039e0a7169696f9db796124dbc40f5704907da9dee4d`
- D1 mapping SHA-256:
  `4904a4cbf41d6b1c328e5f63e27f0d12242f1fa10c31edf654b617833cf4aa2a`

Do not edit the frozen plan or audit artifacts to reflect this derived
ordering. Future verification and implementation outcomes belong in new
execution records linked back to the immutable stable ID and revision.
