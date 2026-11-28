## Task and archive cutoff for file uploads

`taskArchiveSnapshotVersion: 1` in a published v2 envelope means the writer
captured active state and both archives at one cutoff without replacing damaged
task sections. Not every publication requires it, and it adds no such guarantee
to split format. A consumer that needs proof of an absent owner must refuse
unmarked reads. The marker alone does not authorize deletion: the consumer must
also validate the data shape and its ownership protocol.

For this cutoff, `OperationLogUploadService` acquires locks in the order
`UPLOAD -> OPERATION_LOG -> TASK_ARCHIVE` and calls
`getStateSnapshotWithArchiveIntegrity()`. Active state and archives are captured
before remote upload requests. Do not wait for operation-write flushing or
archive effects to finish while holding this pair of locks.

This matters when an archived task is restored during upload. If active state is
captured without the task, the task is then restored, and the archive is read
afterwards, the published file omits the task from both sections. A plugin entry
referencing that task may remain.

This is an incomplete published cutoff, not proof of permanent task data loss.
The restoration may remain a local unpublished operation; the next ordinary sync
publishes it and returns the task to active state. The earlier snapshot therefore
cannot establish task absence for external deletion. The common cutoff and its
provenance marker support verified reads of published data. They do not replace
attachment ownership or acknowledgement of a particular cleanup request.

The internal `CapturedFileState` passes state and archives through the existing
opaque `uploadOps` argument. The adapter uses those archives without rereading
IndexedDB. The wrapper is not serialized. Archives retain their existing top-level
wire fields; their contents need not be nested again in `state`. File version,
persisted-model schema and the public provider signature do not change.

The v2 envelope gains optional `taskArchiveSnapshotVersion: 1`. Only an explicit
capture that did not replace damaged archive tasks with an empty section receives
it. Normal UI and sync normalization remain available, but such a publication
does not receive the marker. The marker describes the snapshot's capture path.
Readers must separately validate task and archive shapes; the marker alone does
not prove completeness of an arbitrary downloaded file. An existing IndexedDB
row without `data` is also not an absent archive: capture checks row existence
through `hasArchiveYoung` and `hasArchiveOld` under the same lock. The marker does
not acknowledge unapplied operations in another active tab. The contract relies
on the ordinary second-tab startup protection; bypassing it is unsupported.
An older client can read the additional field; its normal writer rebuilds the
envelope without inheriting the marker from an earlier primary or backup.

### Cost of ordinary split uploads

The synchronous app-only hint `requiresTaskArchiveSnapshot()` does not discover
the format over the network. Explicit v2 settings require capture. Explicit split
settings and already-discovered v3 with no explicit setting retain the previous
raw active-state cutoff under `OPERATION_LOG`. Ordinary split appends do not read
archives. Compaction reads them through the previous `resolveFileState` fallback,
without a new common-cutoff guarantee or marker. This helper does not change the
public providers-package interface.

Unknown format and an absent hint require capture. The first automatic v3
discovery may therefore incur an extra archive read. With no pending operations,
the uploader reads neither active state nor archives.

The hint does not pin the format for the duration of the upload. If the setting
changes from split to v2 after the hint, the writer may publish a raw v2 snapshot
without the marker. A proof consumer rejects it. The next ordinary v2 upload with
pending operations performs capture. This limits proof availability; it does not
produce false consistency evidence.

Direct adapter calls without capture and separate full-state uploads retain the
previous archive-read path. The helper's presence gives them no common-cutoff
guarantee. An ordinary upload's common cutoff does not prove logical completeness
of files published by another client, nor authorize a plugin to physically delete
attachments.

### Verification

```sh
npm run quiet -- test:file src/app/op-log/sync/operation-log-upload.service.spec.ts --include src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts --include src/app/op-log/sync-providers/wrapped-provider.service.spec.ts
npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-archive-restore-cutoff.spec.ts --retries=0
npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-snapshot-integrity.spec.ts --retries=0
```

The end-to-end scenario uses real reducers, archive effects, IndexedDB and a
WebDAV file. A barrier delays the return of an already-completed capture callback;
the scenario then restores the task and inspects the published primary. It must
fail without the common cutoff and pass with it. The second scenario verifies
owner preservation during a young-to-old move; that scenario passing does not
itself establish a separate archive-move bug.

Сценарий переноса young → old устанавливает часы Playwright до загрузки приложения.
Затем он меняет системное время без выполнения таймеров за 22 дня. Поздняя установка
часов заменяет глобальные функции таймеров, когда нативные интервалы уже работают.
Последующая отмена может оставить нативный callback, который вызывает закрытое
действие RxJS. Проверка runtime-ошибок остаётся включённой: правильный порядок
установки часов исключает смешение таймеров, а не скрывает ошибки сценария.
