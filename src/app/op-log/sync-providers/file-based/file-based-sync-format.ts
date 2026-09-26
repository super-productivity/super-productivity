import { FileSyncProvider } from '../provider.interface';
import { SyncProviderId } from '../provider.const';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import {
  FileBasedSyncData,
  FileBasedSplitTombstone,
  FILE_BASED_SYNC_CONSTANTS,
} from './file-based-sync.types';
import { assertSyncFileVersion } from './assert-sync-file-version';
import {
  InvalidDataSPError,
  LegacySyncFormatDetectedError,
  RemoteFileNotFoundAPIError,
  SplitSyncFormatDetectedError,
} from '../../core/errors/sync-errors';

type Provider = FileSyncProvider<SyncProviderId>;

// These providers can report an unreadable prefix as InvalidDataSPError from
// getFileRev. That proves presence, never an empty folder; let the reader recover.
const fileExists = async (provider: Provider, path: string): Promise<boolean> => {
  try {
    await provider.getFileRev(path, null);
    return true;
  } catch (e) {
    if (e instanceof InvalidDataSPError) return true;
    if (e instanceof RemoteFileNotFoundAPIError) return false;
    throw e;
  }
};

/** Discover only existing protocol files. A local installation says nothing about remote data. */
export const discoverFileSyncFormat = async (
  provider: Provider,
): Promise<'v2' | 'v3' | 'empty'> => {
  if (await fileExists(provider, FILE_BASED_SYNC_CONSTANTS.OPS_FILE)) return 'v3';
  if (await fileExists(provider, FILE_BASED_SYNC_CONSTANTS.SYNC_FILE)) return 'v2';
  if (await fileExists(provider, FILE_BASED_SYNC_CONSTANTS.LEGACY_META_FILE)) {
    throw new LegacySyncFormatDetectedError();
  }
  return 'empty';
};

export const annotatePrimaryRev = (e: unknown, rev: string): unknown => {
  if (e && typeof e === 'object' && !('primaryRev' in e)) {
    (e as { primaryRev?: string }).primaryRev = rev;
  }
  return e;
};

const isSplitTombstone = (data: unknown): data is FileBasedSplitTombstone => {
  const d = data as Partial<FileBasedSplitTombstone> | null;
  return (
    !!d &&
    d.version === FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION &&
    d.format === FILE_BASED_SYNC_CONSTANTS.SPLIT_TOMBSTONE_FORMAT
  );
};

/** Read the v2 baseline, preserving legacy detection and backup-recovery revisions. */
export const downloadLegacySyncFile = async (
  provider: Provider,
  handler: EncryptAndCompressHandlerService,
  cfg: EncryptAndCompressCfg,
  encryptKey: string | undefined,
  isSplitEnabled: boolean,
): Promise<{ data: FileBasedSyncData; rev: string }> => {
  let response: Awaited<ReturnType<typeof provider.downloadFile>>;
  try {
    response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
  } catch (e) {
    if (e instanceof RemoteFileNotFoundAPIError) {
      // sync-data.json not found. Check for a legacy pfapi __meta_ file before
      // treating this as a fresh start — a v16.x device may be writing to the
      // same provider, causing silent divergence if we proceed.
      let legacyFileFound = false;
      try {
        await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.LEGACY_META_FILE, null);
        legacyFileFound = true;
      } catch (innerE) {
        // Why: WebDAV surfaces a corrupt/empty legacy __meta_ body as
        // InvalidDataSPError (not RemoteFileNotFoundAPIError). The presence
        // of the file — even if unreadable — still proves a v16.x client
        // touched this target, so treat it the same as a successful probe
        // rather than letting the unfriendly InvalidDataSPError escape.
        if (innerE instanceof InvalidDataSPError) {
          legacyFileFound = true;
        } else if (!(innerE instanceof RemoteFileNotFoundAPIError)) {
          throw innerE;
        }
        // __meta_ not found either → genuine fresh start
      }
      if (legacyFileFound) throw new LegacySyncFormatDetectedError();
    }
    throw e;
  }
  let data: FileBasedSyncData;
  try {
    data = await handler.decompressAndDecryptData<FileBasedSyncData>(
      cfg,
      encryptKey,
      response.dataStr,
    );

    // SPAP-11: if sync-data.json is a v3 SPLIT tombstone, this folder was
    // migrated to the split format by another client. Signal that specifically
    // (distinct from generic corruption) so the caller can surface an actionable
    // "enable Surgical sync" notice and pause without re-creating a v2 file.
    // Checked before the version gate so a v3 tombstone doesn't read as corrupt.
    if (isSplitTombstone(data)) {
      throw new SplitSyncFormatDetectedError();
    }

    assertSyncFileVersion(
      data,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
    );
  } catch (decodeErr) {
    // A split tombstone is a valid signal, not corruption — let it propagate
    // by type without being annotated as a corrupt primary.
    if (decodeErr instanceof SplitSyncFormatDetectedError) {
      throw decodeErr;
    }
    // We already hold the corrupt primary's rev (from the download above), so
    // no extra request is needed to enable the heal-via-conditional-overwrite.
    throw annotatePrimaryRev(decodeErr, response.rev);
  }

  // SPAP-11 (Q4): a valid v2 sync-data.json can still coexist with a
  // sync-ops.json when a migration crashed after the ops commit but before the
  // tombstone write. A split-sync-OFF client must NOT proceed on the stale v2
  // file (it would diverge from the already-committed ops). Probe for the ops
  // file; if present, treat it exactly like the tombstone case (actionable
  // notice + pause). Skipped when split-sync is ON, because the migrator
  // legitimately reads the v2 file here to complete the migration. Best-effort:
  // any probe failure falls through to the normal single-file path.
  if (!isSplitEnabled) {
    let opsFilePresent = false;
    try {
      await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.OPS_FILE, null);
      opsFilePresent = true;
    } catch {
      // absent / probe failed → proceed on the single-file path
    }
    if (opsFilePresent) {
      throw new SplitSyncFormatDetectedError();
    }
  }

  return { data, rev: response.rev };
};
