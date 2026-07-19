# Sync simplification audit baseline

Status: frozen and independently reproduced by A1R3; Wave A complete,
including the authorized read-only external issue reconciliation  
Date: 2026-07-16  
Baseline ID: `9b4481332dd635dce29da3774d1b8601ea213467f07dfc7fb0417f36328c3135`

## Repository fingerprint

| Field | Value |
| --- | --- |
| Commit | `104043e2d220336d37c96623229640233093f045` |
| In-scope status | `?? docs/plans/2026-07-16-sync-simplification-audit.md` |
| Tracked diff SHA-256 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| In-scope untracked file | `docs/plans/2026-07-16-sync-simplification-audit.md` |
| Untracked file SHA-256 | `bbed7c26e71036abab0bbe984f99669094a0731eb3fb47b512e833176f3a9393` |
| Scope records | 1,442 |
| Scope-manifest SHA-256 | `7d38cfa9f7a06d9f4da3be822c715ee01e418956a71251798cede66fbb1144bb` |

The tracked diff hash is from:

```sh
git diff --binary --full-index --no-ext-diff HEAD -- . | sha256sum
```

The only drift exclusion is `docs/research/sync-simplification-audit/**`.
It did not exist when the repository fingerprint was captured and contains only
the five coordinator-owned audit artifacts. Source, tests, configuration,
existing documentation, the plan, Git state, services, and external systems are
not excluded.

The baseline ID is SHA-256 over these bytes:

```text
"A1-v1" NUL
commit NUL
exact porcelain-v1-uall bytes NUL
tracked-diff SHA-256 NUL
sorted("path" NUL "sha256" LF) for each in-scope untracked file NUL
scope-manifest SHA-256
```

## Manifest construction

The canonical universe is `git ls-files -co --exclude-standard -z`. Paths are
UTF-8, bytewise sorted, and hashed as `path + LF`, including the final LF.
The exact merged path list is the first column of
[`ownership.tsv`](ownership.tsv).

The direct seed and closure were split because the 845-file lower bound could
not fit one 60-file inspection assignment:

| Slice | Scope | Files | Path-list SHA-256 | Physical LOC |
| --- | --- | ---: | --- | ---: |
| A1-M1 | Four sync/server packages plus app op-log and sync shell | 733 | `e9b8d804d681f0776e935c8a7b940af60a185cf5e1189970303f99306299a1f0` | 249,112 |
| A1-M2 | App/root-store/platform import, registration, action, provider, and serialized-string closure | 512 | `e42c80ba1236ff56c18ea27b88bf9b746e5bdc3a8fee514239fb05f25b29ab82` | 167,311 |
| A1-M3 | Sync E2E closure, canonical docs, lint, CI, and root build/runtime selection | 197 | `d72096920baf37492990e82bcec994f1089d9069d930c99e43b8bf1b077501a2` | 64,572 |
| **Merged** | Deduplicated union | **1,442** | **`7d38cfa9f7a06d9f4da3be822c715ee01e418956a71251798cede66fbb1144bb`** | **480,995** |

The sole LOC-target exclusion is the tracked vendored/minified
`packages/super-sync-server/public/simplewebauthn-browser.min.js` (363
physical lines). It remains in the manifest and retain inventory. Immutable SQL
migrations, snapshots, compatibility code, auth/account perimeter code, and
operational material remain in the denominator; later auditors may classify
them retained but may not silently remove them.

### A1-M1 exact seed procedure

```sh
git ls-files -co --exclude-standard -- \
  packages/sync-core \
  packages/sync-providers \
  packages/shared-schema \
  packages/super-sync-server \
  src/app/op-log \
  src/app/imex/sync |
  LC_ALL=C sort
```

| Surface | Production TS files / LOC | Test TS files / LOC | Docs files / LOC | Other files / LOC |
| --- | ---: | ---: | ---: | ---: |
| `packages/sync-core` | 28 / 3,954 | 12 / 4,675 | 1 / 73 | 5 / 83 |
| `packages/sync-providers` | 50 / 7,249 | 22 / 6,798 | 0 / 0 | 5 / 208 |
| `packages/shared-schema` | 12 / 1,054 | 5 / 1,136 | 0 / 0 | 3 / 59 |
| `packages/super-sync-server` | 50 / 14,812 | 60 / 31,159 | 16 / 5,597 | 78 / 7,321 |
| `src/app/op-log` | 145 / 42,639 | 164 / 102,636 | 0 / 0 | 6 / 477 |
| `src/app/imex/sync` | 31 / 6,968 | 21 / 10,600 | 0 / 0 | 19 / 1,614 |
| **Total** | **316 / 76,676** | **284 / 157,004** | **17 / 5,670** | **116 / 9,762** |

A TypeScript AST pass found 134 external incoming files, 149 external outgoing
targets, and a 251-file union. Its path-set hash was
`0ed16ed1115d5cf3465563f207839aae224f37b486ccbe6d6f5f2ae8be72662d`.
All relative imports resolved.

### A1-M2 closure rules

The executable repair recipe was independently challenged after two validators
got 218 primary matches instead of 222. The difference was four tracked legacy
PFAPI JavaScript files hidden by `.gitignore:76` (`src/app/**/*.js`) from
default positional `rg`. The repaired recipe reads the Git universe directly,
which correctly retains them without admitting arbitrary ignored output.

The closure includes:

- all `src/app/root-store/meta/**`;
- primary exact sync/package/action/provider/vector-clock terms;
- both directions of imports between M1 and M2, with M1-to-M2 domain targets
  terminal unless independently admitted;
- byte-delimited sync/op-log/vector-clock/provider path families;
- unambiguous operation-log, clean-slate, file-sync, and WebSocket evidence;
- replay/hydration/SYNC-SAFE evidence in effects and matching specs;
- explicit route, logical-day, Android, Electron, and iOS registration or
  serialized bridge boundaries;
- same-stem tests and Angular resources for active files.

Intermediate reproduced sets:

| Set | Count | SHA-256 |
| --- | ---: | --- |
| M2 universe | 2,322 | `2cec1ab3a0dab2d0786d4dfde565fcb045e96adf80d0ac923bf70d58d16e3162` |
| Root-meta seed | 46 | `3383e395fd8028b0df3f75769d2fbef861c2f816facbb86dc12b8651a4fb8511` |
| Primary | 222 | `050cedb0ec5afd33f3c81d9f65bdbe51ca29eebdc08a1df8eac6d41f90f3193c` |
| Import union | 247 | `7b08072fa222a41e564d2495023ad08beef0644b5f6da4e6a93153fad7a17735` |
| Path admissions | 44 | `760ee810cdd8fe948999e43b1fa981e8854a7f6d7d8de2873d47948a0ac498ac` |
| Supplemental admissions | 38 | `a0785c8f7e55be4b30eccc1afe856732a3402459b2694c452044a460f0aefceb` |
| Explicit boundary edges | 50 | `5ee9be15ef26ef5b35896399f77dd9336c0842f22ec46ec20e9a0f692af93e7b` |
| Companions/resources | 136 | `b4eb5ca7fb0364a1a0d0476abbd116a62f1fc1721ba0255146b590686c716552` |
| Excluded supplemental noise | 97 | `f06cb8f44bc8ff893b3663ba923fd24112bbf9d986ca404e61dc75a0e4d78293` |

The nine validation slices, A1R, and A1R2 found 58 closure omissions in total: build and
frontend registrations, direct consumers/sidecars, serialized-shape and
logical-day dependencies, Angular resources, and existing proving tests.
Revisions 2–6 added their complete source/test/resource closure. They also
removed seven independently reproduced lexical false positives: one
locale-only spec, three non-sync plugin OAuth bridge/storage files, two
idle-only break-service files, and one local-only plugin secret store. M2 now
contains 331 production/source files (75,857 LOC), 178 test files (91,192 LOC),
and three config/platform metadata files (262 LOC). The original executable
recipe and its intermediate hashes describe the pre-validation candidate set;
the authoritative revised manifest is the exact first column of
`ownership.tsv`. A1R must independently reproduce the closure amendments and
challenge them rather than trust this summary.

### A1-M3 exact composition

- 90 top-level `e2e/tests/sync/*.spec.ts` files and 255 executable static
  tests: 253 `test(...)` declarations plus two aliased `base(...)` tests in
  `import-sync.spec.ts`;
- 34 transitive E2E fixture/page/helper/config files;
- all 22 `docs/sync-and-op-log/**` files and 16 explicit ADR/plan/E2E docs;
- all 11 `eslint-local-rules/**` files plus `eslint.config.js`;
- seven CI/action files and 16 root build/runtime selection files.

| Category | Files | Physical LOC |
| --- | ---: | ---: |
| Sync E2E specs | 90 | 33,047 |
| E2E harness/config | 34 | 10,475 |
| Documentation/ADR/plans | 38 | 16,199 |
| Sync lint rules/config | 12 | 1,992 |
| CI/workflow selection | 7 | 1,528 |
| Scripts/root build config | 16 | 1,331 |

## Query lexicon and closure

Primary expression:

```regex
(@sp/sync-(core|providers)|@sp/shared-schema|src/app/op-log|/op-log/|SuperSync|SUPER_SYNC|super-sync|supersync|WebDAV|WEBDAV|webdav|SyncProvider|SYNC_PROVIDER|syncProvider|sync-config|syncConfig|PersistentAction|persistentAction|PERSISTENT_ACTION|LOCAL_ACTIONS|ALL_ACTIONS|skipDuringSyncWindow|OperationLog|operationLog|operation-log|op-log|VectorClock|vectorClock|vector-clock|SYNC_IMPORT|BACKUP_IMPORT)
```

Supplemental expression:

```regex
(?i)(operation log|replay|hydration|clean[-_ ]slate|file[-_ ]based[-_ ]sync|nextcloud|dropbox|onedrive|snapshot|conflict|repair|quota|websocket)
```

Closure follows static exports/imports, literal dynamic imports/require calls,
package aliases/barrels/build entries, DI/effect/token/meta/entity/provider
registrations, exact serialized action/entity/provider/schema/full-state/wire
strings, co-located tests and Angular resources, and the sync E2E import graph.
Generic registered domain files are terminal perimeter unless another exact edge
admits them. Name-only false positives such as RxJS replay, UI snapshots,
calendar/issue-provider sync, release metadata, plugin-dev `sync-md`, and
unreferenced platform assets require an independent edge.

## Frozen continuation ceilings

Because the final manifest exceeds 900 paths:

- Wave A continuation ceiling: **26 runs** (raised from 25 by explicit user
  approval after A1R2 found five same-stem test omissions).
- Waves B and C combined ceiling: **78 runs**, including their 46 seed runs and
  manifest-derived continuation capacity.

Exceeding either ceiling requires explicit user approval. D1, D2-D4, Wave E,
and Wave F capacities are frozen only at their prescribed later phase gates.

## Primary-domain ownership

A3 assigned all 1,442 manifest paths by deterministic first-match rules. The
complete path-level assignment is `ownership.tsv`; counts reconcile with zero
unmatched paths:

```text
B01 32  B02 8   B03 8   B04 21  B05 8   B06 6   B07 9   B08 12
B09 9   B10 28  B11 18  B12 15  B13 13  B14 20  B15 2   B16 8
B17 6   B18 9   B19 24  B20 5   B21 9   B22 50  B23 26  B24 14
B25 25  B26 9   B27 20  B28 16  B29 48  B30 30  B31 22  B32 15
B33 17  B34 85  B35 481 B36 185 B37 45  B38 84
```

The largest owners require stable child slices in Wave B: B34 server
lifecycle/auth, B35 app/platform perimeter, B36 test topology, and B38
database/operations. Test paths remain B36 primary and cross-link to their
behavior owner; provider package paths remain provider-domain primary and
cross-link to B30 shared infrastructure.

## Dependency and API map (A3)

A TypeScript AST pass covered 1,204 code files and 6,484 resolved
manifest-internal edges.

- Cross-surface directions: app→shared-schema 9, app→sync-core 55,
  app→sync-providers 55, providers→sync-core 27, server→shared-schema 15,
  server→sync-core 2.
- No forbidden sync-core/shared-schema direction or non-public `@sp/*`
  specifier was found. Provider package exports and tsconfig aliases both expose
  the same 13 focused subpaths.
- Public surface counts: sync-core root 101 named re-exports; shared-schema 62;
  provider subpaths 117 visible declarations; app `sync-exports.ts` 44
  re-exports used by 19 manifest consumers.
- Five strongly connected components remain: Dropbox↔DropboxApi;
  archive-model↔time-tracking-model; a 19-node reducer/model/load registry; a
  21-node app sync/config/encryption/orchestration component; and
  plugin-service↔plugin-bridge.
- High fan-in: operation types 177, op-log store 97, sync-core index 90,
  provider constants 68, operation-log constants 57, `LOCAL_ACTIONS` 53,
  lock service 51. High fan-out: feature-store registration 61,
  operation-log-sync 43, sync wrapper 39, conflict resolution 35, entity/model
  registries 30 each.
- Registries: 21 shared entity strings (18 configured state entities plus
  ALL/MIGRATION/RECOVERY), 17 ordered meta-reducers, centralized feature-effect
  registration, and four unconditional plus three platform-conditional
  providers.

A3 routing signals: the server recovery script deep-imports sync-core source
despite a public decrypt export; Dropbox is the only provider-package SCC; the
large app SCC warrants seam-by-seam review but not package extraction;
Electron/app imports cross in both directions and need IPC compatibility
review; and app `sync-exports.ts` is a second compatibility surface whose
consumers/deprecated aliases should be audited before widening it.
