# Reading a published snapshot for attachments

`PluginAPI.readPublishedSnapshot()` returns a scoped projection of the published
primary. It uses `readPublishedPluginSnapshot` and
`projectPublishedPluginSnapshot`. The method is available to the direct API and
iframes. It does not start synchronization or cleanup.

## Why ordinary task reads are insufficient

Local state may contain changes that have not been published yet. Completing
normal synchronization is not a publication receipt: handled errors and skipped
cycles may also complete without throwing. UI archive reads may return an empty
array on error. That behavior serves the UI, but does not establish that a task
is absent before physically deleting an external file.

In v2, the primary `sync-data.json` contains the complete `state`, `archiveYoung`,
`archiveOld` and `vectorClock`. `recentOps` contains operations already represented
in that snapshot. Reading v2 does not require replaying those operations separately.

## Read contract

1. The reader captures the active provider, local config/sync epochs and a copy
   of the private configuration. It does not expose that configuration to callers.
2. The reader checks that `sync-ops.json` is absent. Only
   `RemoteFileNotFoundAPIError` establishes absence. Other errors reject the read.
   An existing split head also rejects the read.
3. The reader downloads only the primary `sync-data.json`. It uses the normal
   decryption and decompression path with the provider configuration's encryption
   intent. It does not use `.bak`, adapter caches, repair or migration.
4. The projector requires `taskArchiveSnapshotVersion: 1` and validates the
   supported schema, v2 envelope, clock, active tasks, both archives and the
   plugin-data array. A missing archive is not an empty archive. Duplicates and
   inconsistent `ids`/`entities` also cause rejection.
5. The projector returns only task IDs, location and `isDone`, plus strings from
   the caller plugin's namespace. An archived task without `isDone` gets `null`,
   rather than an assumption of completion. Own compressed strings are decoded
   strictly. A decoding failure does not mean metadata is absent. Other plugins'
   values are neither decoded nor returned.
6. The reader rechecks the primary revision, absence of a split head and local
   configuration. Any change rejects the read. Transport and decoding errors are
   hidden behind a generic message without remote payloads or credentials.

```text
capture configuration -> exclude split -> read primary
                                               |
return projection <- repeat checks <- validate tasks and both archives
```

The result contains `format: 'file-v2'`, `revision`, `clock`, `tasks` and
`pluginData`. An empty key identifies the plugin's legacy root entry. Values
preserve their original Plugin API string representation after decoding.

## Guarantee boundaries

- This observes a snapshot at read time. It is not a WebDAV lock or independent
  authorization to delete a file.
- The reader requires the writer's coherent-capture marker. It does not
  recalculate operation history or establish the cutoff's provenance independently
  of the writer. A marked publication captures active state and archives at one
  cutoff under `OPERATION_LOG -> TASK_ARCHIVE`. Empty pending sets produce no
  upload; known split uploads retain the unmarked raw-state path. A setting change
  after the hint may leave v2 unmarked until a later upload with pending
  operations. The [contract and reproduction](sync-and-op-log/file-snapshot-archive-cutoff.md)
  cover task restoration after capture. The writer marker is required;
  unverified archive-task normalization, raw uploads and full-state uploads do
  not receive it. An older writer that rebuilds the envelope by enumerating its
  fields drops the marker. The reader rejects such publications. The marker
  proves the capture path, not permission to delete a particular object.
- Revision checks detect ordinary primary replacement. They do not turn a weak
  ETag or best-effort provider into atomic CAS.
- Local epochs are not cross-client publication receipts. Credential caches may
  conceal configuration changes in another context. A future protocol must
  therefore verify a published dataset identifier and its causal connection to
  a particular intent, rather than derive identity from epochs.
- An unfinished or unknown PUT must not be classified as orphaned by age.
  Object ownership and PUT/DELETE races require a separate protocol.
- Split v3, SuperSync and single-file providers are not supported. The reader
  does not change the owner's chosen synchronization format.
- Rejection means completeness is unproven. It never means there are no tasks.
  The reader performs no remote writes and does not change application state or
  synchronization acknowledgements.

## Boundary with the cleanup protocol

The reader does not implement attachment cleanup or confirm a particular local
write. It does not add a public synchronization trigger. Its contract does not
depend on APIs that may be introduced by other changes.

A separate plugin protocol must define object ownership, dataset identity,
publication of a particular request and races with unfinished operations. For
example, a random nonce in an own entry lets the plugin check an exact published
request. A nonce alone does not authorize DELETE: the protocol must bind the
request to the expected store, validate the current attachment binding and exclude
competing operations. A local vector clock or completed sync does not prove
these conditions. Concurrent requests may supersede each other through LWW; the
losing cleanup pass must refuse to proceed.

After a full-state upload, an ordinary upload of a new operation may be needed
before the primary receives a verifiable marker. A missing marker does not stop
normal Super Productivity synchronization. The reader rejects that primary.
Even a successful read does not prevent revision changes or provide an atomic
deletion protocol. This API alone must not enable automatic cleanup.

## Reproducible checks

```sh
npm run quiet -- checkFile src/app/plugins/plugin-published-snapshot.ts src/app/plugins/plugin-published-snapshot.spec.ts src/app/plugins/plugin-published-snapshot-reader.ts src/app/plugins/plugin-published-snapshot-reader.spec.ts
npm run quiet -- test:file src/app/plugins/plugin-published-snapshot.spec.ts --include src/app/plugins/plugin-published-snapshot-reader.spec.ts
```

The projector is tested against data shapes from the previous release's frozen
fixture. A separate test mutates the source tasks, archives, clock and plugin data
during asynchronous decoding and verifies one captured cutoff. Transport tests
use the actual codec with test strings, encryption and compression. The provider
in these unit tests is an isolated fixture.

```sh
npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-plugin-published-snapshot.spec.ts --retries=0
```

Two end-to-end scenarios use real WebDAV and an installed iframe plugin: a plain
primary and an encrypted primary. They verify an active task, an archived task,
decoding an own string and isolation between two plugin namespaces. A corrupt
primary despite a valid backup, and a present split head, must cause rejection.
Successful reads use only read-only HTTP requests. Projector unit tests cover the
old archive separately. These scenarios do not test Dropbox, OneDrive, a
cross-client publication protocol or file deletion. The cleanup protocol requires
separate acceptance before it is enabled.
