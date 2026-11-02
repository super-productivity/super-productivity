# Legacy Local Migration Retirement Notice

- **Status:** Planned; approved retirement timing, announcement draft only. Runtime migration remains enabled.
- **Owner / tracking:** Maintainer release handoff, S8; no publication or removal PR assigned yet.
- **Last verified:** 2026-09-26 against `9177c3afed6429934632b23de936cda8c6603fde`.
- **Completion / removal:** Delete this plan once the announcement is published, the separate retirement implementation is verified and released, and bridge/import guidance is maintained in the [User Data reference](../wiki/3.06-User-Data.md#legacy-local-data-migration-retirement).

## Approved Scope

Automatic in-place local pfapi/v16-to-op-log migration retires in the **first release after 2027-01-23**, not on that date itself. Prepare the notice now; do not disable migration in this change. Preserve supported older JSON backup imports. Remote sync formats and server/provider migration are outside this retirement.

## Release-Note Draft — Advance Announcement

Automatic migration of local data from Super Productivity v16 or older will retire in the **first release after January 23, 2027**. Migration still works today: opening a current release with your old local data lets the app migrate it to the current storage format.

After retirement, if your local data is still in the old format, first run the last release that supports automatic migration, let migration finish, and then upgrade to the latest release. We will provide that bridge release's version and download instructions when it is known. If your local data has already migrated, you do not need this extra step.

Supported older JSON backup files will still be importable through **Import from file**. The already unsupported V1 backup format remains unsupported. This change concerns local data stored on your device or in your browser; it does not retire remote sync formats.

## Publication Handoff

1. Review the advance announcement and wiki note together. Publish through the normal release process; this task creates only a local draft and commit. The wiki is published by CI after integration, so coordinate its timing with the announcement.
2. At publication, confirm whether the bridge release is known. If it is not, retain the explicit promise to supply details later; do not invent a version or label today's release as the final bridge.
3. Before the retirement release, identify and verify the last release supporting in-place migration and the first release after 2027-01-23. Supply their exact versions, bridge download/install instructions for supported platforms, and a verified browser-data migration route. Verify the bridge against actual legacy profiles; package/profile differences must not send users to an empty profile.
4. For the retirement release notes, change the draft's future tense to describe the shipped behavior, include the verified bridge details, and update the wiki's retirement note and Disaster Recovery text together. Keep the JSON-import distinction and link to the [restore guide](../wiki/2.02-Restore-Data-From-Backup.md).
5. Record the publication and separate implementation tracking references here until the completion condition is met. No publication, runtime removal, or release version is claimed by this draft.

## Separate Implementation Handoff

Implement retirement in a later change tied to the first release after 2027-01-23:

- Retain a **non-destructive legacy-data detector** and show bridge/import guidance when unmigrated local data is present. Do not silently treat it as a fresh install, overwrite/delete the legacy database, or mark it skipped without an explicit user choice. An unreadable database must not be treated as absent.
- Audit startup migration, archive migration, and legacy recovery together. Removing the startup call alone leaves other local migration paths. Keep normal operation-log hydration, schema migrations, and remote sync behavior intact.
- Preserve JSON file imports, legacy backup conversion, default model slices, validation/repair, and the ability to import pre-migration backups. The existing V1 exclusion is unchanged.
- Verify through E2E tests seeded with actual legacy-data fixtures: unmigrated local data produces actionable guidance and remains intact across restart; the bridge migrates active and archived data before a subsequent upgrade; supported legacy JSON imports still restore data; fresh and already-migrated installs start normally. Cover partial old model slices and unreadable legacy storage without treating them as empty data. Do not replace these checks with a mocked detector test.

## Verified Code and Fixture References

- Local startup: [OperationLogMigrationService](../../src/app/op-log/persistence/operation-log-migration.service.ts) checks for existing op-log state, detects usable legacy data, downloads a pre-migration backup, and creates the genesis state. [LegacyPfDbService](../../src/app/core/persistence/legacy-pf-db.service.ts) detects and reads `pf` data, including the explicit skip marker.
- Other local entry points: [ArchiveMigrationService](../../src/app/op-log/persistence/archive-migration.service.ts) copies legacy archives; [OperationLogRecoveryService](../../src/app/op-log/persistence/operation-log-recovery.service.ts) can recover from legacy data when op-log state is absent. These paths must be considered by the removal change.
- JSON import: [FileImexComponent](../../src/app/imex/file-imex/file-imex.component.ts) parses JSON, rejects V1, and calls [BackupService.importCompleteBackup](../../src/app/op-log/backup/backup.service.ts). That service unwraps snapshots, invokes [migrateLegacyBackup](../../src/app/op-log/backup/migrate-legacy-backup.ts) for older shapes, fills missing model slices, and validates/repairs before applying the import.
- Fixtures and app paths: [legacy migration E2E](../../e2e/tests/migration/legacy-data-migration.spec.ts), [full legacy fixture](../../e2e/fixtures/legacy-full-migration-backup.json), and [partial-model migration/import E2E](../../e2e/tests/migration/legacy-partial-model-slices-9770.spec.ts) with its [v13 partial-model fixture](../../src/app/op-log/validation/test-fixtures/legacy-pf-v13-partial-models.json).
