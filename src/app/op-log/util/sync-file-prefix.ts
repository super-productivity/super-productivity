import { createSyncFilePrefixHelpers } from '@sp/sync-core';
import type { SyncFilePrefixParams, SyncFilePrefixParamsOutput } from '@sp/sync-core';
import { OpLog } from '../../core/log';
import { REMOTE_FILE_CONTENT_PREFIX } from '../sync-providers/provider.const';
import { InvalidFilePrefixError } from '../core/errors/sync-errors';

export type { SyncFilePrefixParams, SyncFilePrefixParamsOutput };

const syncFilePrefixHelpers = createSyncFilePrefixHelpers({
  prefix: REMOTE_FILE_CONTENT_PREFIX,
  createInvalidPrefixError: (details): Error => {
    // Privacy-safe log: only structured details (lengths, separators,
    // expected prefix), never the raw sync payload. The constructor of
    // `AdditionalLogErrorBase` no longer logs at construction time (per
    // the @sp/sync-providers privacy refactor), so the log call moved
    // here — the only site that owns the bridge between the package
    // helper's invalid-prefix detection and the app's OpLog history.
    // The key names are inlined in the first-arg string so the line reads as
    // one greppable unit in a console. The structured meta is what the log
    // EXPORT carries: `Log.exportLogHistory()` JSON-round-trips each arg, so
    // the fields survive there on their own.
    OpLog.log(
      `InvalidFilePrefixError (inputLength=${details.inputLength}, ` +
        `expectedPrefix="${details.expectedPrefix}", ` +
        `endSeparator="${details.endSeparator}", ` +
        `prefixAt=${details.prefixAt}, ` +
        `headShape="${details.headShape}")`,
      {
        expectedPrefix: details.expectedPrefix,
        endSeparator: details.endSeparator,
        inputLength: details.inputLength,
        prefixAt: details.prefixAt,
        headShape: details.headShape,
      },
    );
    return new InvalidFilePrefixError(details);
  },
});

export const getSyncFilePrefix = syncFilePrefixHelpers.getSyncFilePrefix;

export const extractSyncFileStateFromPrefix =
  syncFilePrefixHelpers.extractSyncFileStateFromPrefix;
