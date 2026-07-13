import type { VectorClock } from '@sp/sync-core';

/**
 * Compact operations stored in file-based sync data carry the syncVersion at
 * which they were uploaded. The host owns the compact operation shape.
 */
export type SyncFileCompactOp<
  TCompactOperation extends object = Record<string, unknown>,
> = TCompactOperation & { sv?: number };

/**
 * Schema for the shared sync file used by file-based providers.
 *
 * The host supplies the snapshot state, compact operation, and archive payload
 * shapes. The provider package owns only the transport-level envelope.
 */
export interface FileBasedSyncData<
  TState = unknown,
  TCompactOperation extends object = Record<string, unknown>,
  TArchive = unknown,
> {
  /**
   * Schema version for this sync file format.
   * Increment when making breaking changes to FileBasedSyncData structure.
   */
  version: 2;

  /**
   * Content-based optimistic lock counter.
   * Incremented on each successful upload.
   */
  syncVersion: number;

  /**
   * Schema version of the host application data.
   */
  schemaVersion: number;

  /**
   * Causal state after all operations represented by this file.
   */
  vectorClock: VectorClock;

  /**
   * Timestamp of last successful sync (epoch ms).
   */
  lastModified: number;

  /**
   * Client ID that last modified this file.
   */
  clientId: string;

  /**
   * Complete host application state snapshot.
   */
  state: TState;

  /**
   * Recent or frequently mutable archive partition, host-defined.
   */
  archiveYoung?: TArchive;

  /**
   * Older archive partition, host-defined.
   */
  archiveOld?: TArchive;

  /**
   * Recent operations retained for conflict detection.
   */
  recentOps: SyncFileCompactOp<TCompactOperation>[];

  /**
   * The syncVersion of the oldest operation in recentOps.
   */
  oldestOpSyncVersion?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAP-11: split-file sync format (opt-in). Two remote files per sync folder:
//   - sync-ops.json   (small, read+written every sync; the COMMIT POINT)
//   - sync-state.json  (full snapshot + archives; rewritten only on compaction /
//                       force-upload / gap-repair / migration)
// The legacy single `sync-data.json` is NEVER removed; on migration it is
// overwritten with a small v3 TOMBSTONE so old clients hard-stop instead of
// silently re-creating a v2 file and diverging.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pointer from `sync-ops.json` to the `sync-state.json` snapshot it was built
 * against. Readers MUST validate `syncVersion`/`vectorClock` against the
 * downloaded snapshot; a mismatch is treated as a gap (full re-download).
 */
export interface FileBasedSnapshotRef {
  syncVersion: number;
  vectorClock: VectorClock;
  /** Optional provider rev of the referenced snapshot file (best-effort). */
  rev?: string;
}

/**
 * `sync-ops.json` — the small, always-read/always-written commit-point file.
 * This is the file-based equivalent of `FileBasedSyncData` MINUS the heavy
 * snapshot/archive payload, plus a `snapshotRef` pointing at `sync-state.json`.
 */
export interface FileBasedOpsFile<
  TCompactOperation extends object = Record<string, unknown>,
> {
  version: 3;
  syncVersion: number;
  schemaVersion: number;
  vectorClock: VectorClock;
  lastModified: number;
  clientId: string;
  recentOps: SyncFileCompactOp<TCompactOperation>[];
  oldestOpSyncVersion?: number;
  snapshotRef: FileBasedSnapshotRef;
  /**
   * Present only while converting a legacy v2 file. Readers must finish or
   * retry the migration before treating this ops file as committed. Keeping
   * the complete candidate ops payload in the commit-point file makes recovery
   * possible after a crash on either side of the legacy tombstone write.
   */
  migration?: {
    status: 'pending';
    legacyRev: string;
  };
}

/**
 * `sync-state.json` — the full snapshot file. Same payload as the legacy
 * `FileBasedSyncData` MINUS `recentOps` (those live in the ops file), tagged
 * with schema version 3.
 */
export interface FileBasedStateFile<TState = unknown, TArchive = unknown> {
  version: 3;
  /** syncVersion this snapshot was built at (matched by ops-file snapshotRef). */
  syncVersion: number;
  schemaVersion: number;
  vectorClock: VectorClock;
  lastModified: number;
  clientId: string;
  state: TState;
  archiveYoung?: TArchive;
  archiveOld?: TArchive;
}

/**
 * v3 TOMBSTONE written over the legacy `sync-data.json` (and `.bak`) after a
 * one-way migration to the split format. It is a valid encrypted JSON body so
 * an up-to-date OFF client can detect it (`version:3`, `format:'split'`) and
 * surface an actionable "enable Surgical sync" notice instead of diverging. A
 * truly-old shipped client hits the strict `version !== 2` check and hard-errors
 * (safe backstop).
 */
export interface FileBasedSplitTombstone {
  version: 3;
  format: 'split';
  migratedAt: number;
  note: string;
}

export const FILE_BASED_SYNC_CONSTANTS = {
  SYNC_FILE: 'sync-data.json',
  BACKUP_FILE: 'sync-data.json.bak',
  MIGRATION_LOCK_FILE: 'migration.lock',
  FILE_VERSION: 2 as const,
  // SPAP-9: raised 500 -> 2000 to shrink the gap window. A client that missed up
  // to this many ops while offline can still catch up incrementally instead of
  // tripping snapshotReplacement/partialTrimGap detection and forcing a full
  // seq-0 resync (and the conflict dialog that path can surface). Compact ops are
  // small (~150-250 bytes serialized each), so the extra 1500 retained ops add
  // roughly ~0.3 MB to sync-data.json only when the buffer is actually full.
  MAX_RECENT_OPS: 2000,
  // SPAP-11: split-file format constants (opt-in via the `isUseSplitSyncFiles`
  // sync setting). See FileBasedOpsFile / FileBasedStateFile / FileBasedSplitTombstone.
  OPS_FILE: 'sync-ops.json',
  STATE_FILE: 'sync-state.json',
  // SPAP-8-style recovery artifacts for the split files. Remote-format surface:
  // old and new clients must agree on these names forever.
  OPS_BACKUP_FILE: 'sync-ops.json.bak',
  STATE_BACKUP_FILE: 'sync-state.json.bak',
  SPLIT_FILE_VERSION: 3 as const,
  // Post-compaction RETAINED size for the split ops file (≈ MAX_RECENT_OPS/2).
  // NOTE: this is the trim target, NOT the trigger — a recompaction fires when the
  // ops buffer exceeds MAX_RECENT_OPS, then trims sync-ops.json back to this many
  // ops. Keeping the target strictly below the trigger leaves ~this many cheap
  // op-only syncs between compactions.
  SPLIT_COMPACTION_THRESHOLD: 1000,
  // Marker distinguishing a migration tombstone from other v3 payloads.
  SPLIT_TOMBSTONE_FORMAT: 'split' as const,
  SYNC_VERSION_STORAGE_KEY_PREFIX: 'FILE_SYNC_VERSION_',
  LEGACY_META_FILE: '__meta_',
  // SPAP-9: when a seq-0 snapshot download has CONCURRENT vector clocks with the
  // local client, attempt an entity-level last-write-wins merge of the remote
  // recent ops instead of forcing the binary USE_LOCAL/USE_REMOTE conflict
  // dialog.
  //
  // Default OFF (review follow-up): the merge only replays the capped `recentOps`
  // buffer and never re-hydrates the compacted `snapshotState`, so a snapshot whose
  // compacted base holds an entity this client never downloaded would silently drop
  // that entity — turning a user-recoverable conflict dialog into permanent, global,
  // undetectable data loss. `_tryConcurrentSnapshotMerge` now additionally refuses to
  // merge unless the retained recentOps provably bridge the entire gap, but until that
  // guard is validated by a real multi-client E2E harness (SPAP-34) we keep the
  // feature opt-in and fall back to the conflict dialog. Flip to true only alongside
  // that validation.
  AUTO_MERGE_CONCURRENT_SNAPSHOT: false,
} as const;
