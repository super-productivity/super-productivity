export interface SyncFilePrefixParams {
  isCompress: boolean;
  isEncrypt: boolean;
  modelVersion: number;
}

export interface SyncFilePrefixParamsOutput {
  isCompressed: boolean;
  isEncrypted: boolean;
  modelVersion: number;
  cleanDataStr: string;
}

export interface SyncFilePrefixHelpers {
  getSyncFilePrefix(cfg: SyncFilePrefixParams): string;
  extractSyncFileStateFromPrefix(dataStr: string): SyncFilePrefixParamsOutput;
}

export interface SyncFilePrefixConfig {
  prefix: string;
  endSeparator?: string;
  createInvalidPrefixError?: (details: SyncFilePrefixInvalidPrefixDetails) => Error;
}

/**
 * Coarse character class of a rejected file's head. Deliberately an enum of
 * shapes, never the bytes themselves — the head of a sync file is user data.
 */
export type SyncFileHeadShape = 'base64' | 'markup' | 'json' | 'other';

export interface SyncFilePrefixInvalidPrefixDetails {
  expectedPrefix: string;
  endSeparator: string;
  inputLength: number;
  /**
   * Offset of `prefix` anywhere in the body, or -1 when it does not occur at
   * all. Separates "header damaged" (>= 0) from "header gone" (-1) — different
   * causes, and the log could not previously tell them apart (#9627). Searched
   * over the whole body rather than the head sample: the result is an integer
   * offset either way, so the bound bought no privacy and only conflated
   * "prefix pushed past the sample by prepended junk" with "prefix absent".
   *
   * A heuristic, not a proof: a head that lost only its first byte reads as -1
   * ("gone") though it is merely damaged, and any body that happens to contain
   * `pf_` reads >= 0.
   */
  prefixAt: number;
  /**
   * What we got instead, as a coarse shape of the body's first bytes.
   *
   * `markup` points at a bad RESPONSE (WebDAV multistatus, a proxy or
   * captive-portal page).
   *
   * `base64` is CONSISTENT WITH our own ciphertext or gzip having lost its
   * header, i.e. a problem with the STORED file — but it is not proof. Any
   * alphanumeric body of at least `MIN_BASE64_HEAD_LENGTH` reads the same
   * (`ServiceUnavailable`, an opaque token, a bare hex digest). Weigh it
   * against `inputLength` and the provider before concluding the stored file
   * is at fault; a response can produce this shape too.
   *
   * `json` is AMBIGUOUS and must not be read as "bad response" on its own:
   * compression and encryption are both opt-in and off by default, and with
   * neither enabled our own stored body IS `JSON.stringify(data)`. So `json`
   * means either an error envelope OR our own plaintext file with the header
   * lost. Resolve it with the reporter's sync settings — with encryption or
   * compression ON, our body would be `base64`, so `json` is then a response.
   *
   * It does NOT separate a head-strip from a larger fragment — both read as
   * `base64` — since nothing local knows the file's expected size.
   */
  headShape: SyncFileHeadShape;
}

export class SyncFilePrefixError extends Error {
  override name = 'SyncFilePrefixError';

  constructor(details: SyncFilePrefixInvalidPrefixDetails) {
    super(`Invalid sync file prefix. Expected prefix "${details.expectedPrefix}".`);
  }
}

export class SyncFilePrefixVersionError extends Error {
  override name = 'SyncFilePrefixVersionError';

  constructor(modelVersion: number | string) {
    const formattedModelVersion = String(modelVersion);
    const safeModelVersion =
      formattedModelVersion.length > 40
        ? `${formattedModelVersion.slice(0, 40)}...`
        : formattedModelVersion;
    super(`Invalid sync file model version: ${safeModelVersion}`);
  }
}

const DEFAULT_END_SEPARATOR = '__';
const MODEL_VERSION_PATTERN = /^\d+(?:\.\d+)?$/;
/**
 * Enough head to classify, and bounded so the SHAPE test does not scan a
 * multi-MB body (the `prefixAt` lookup beside it deliberately does — measured
 * at ~53ms on a 100MB body, on a path that is already throwing).
 *
 * It is NOT what keeps the sample out of the log — that holds because the
 * slice never leaves this function; storing it would leak user data at any
 * length.
 */
const HEAD_SAMPLE_LENGTH = 64;
/** Canonical base64: padding only at the end, matching what our writers emit. */
const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;
/**
 * Below this, ordinary words are indistinguishable from base64 — a bare
 * `Unauthorized` or `nginx` body would otherwise read as our own ciphertext,
 * i.e. the exact wrong answer to "response or stored file?". Our real bodies
 * are far longer (measured: 76 chars gzip-only, 108 encrypted), so nothing
 * genuine is lost; a body short enough to fall under this is self-evidently a
 * stub from the `inputLength` recorded beside it.
 */
const MIN_BASE64_HEAD_LENGTH = 16;

const classifyHead = (head: string): SyncFileHeadShape => {
  // One trimmed view for all three tests: checking markup/json trimmed but
  // base64 untrimmed would classify a whitespace-prefixed ciphertext body as
  // `other`, which reads as "unrecognized" when we do in fact recognize it.
  const trimmed = head.trimStart();
  if (trimmed.startsWith('<')) return 'markup';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  return trimmed.length >= MIN_BASE64_HEAD_LENGTH && BASE64_ONLY.test(trimmed)
    ? 'base64'
    : 'other';
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatModelVersion = (modelVersion: number): string => {
  const formatted = String(modelVersion);
  if (
    !Number.isFinite(modelVersion) ||
    modelVersion < 0 ||
    !MODEL_VERSION_PATTERN.test(formatted)
  ) {
    throw new SyncFilePrefixVersionError(modelVersion);
  }
  return formatted;
};

const parseModelVersion = (rawModelVersion: string): number => {
  const modelVersion = parseFloat(rawModelVersion);
  if (!Number.isFinite(modelVersion)) {
    throw new SyncFilePrefixVersionError(rawModelVersion);
  }
  return modelVersion;
};

export const createSyncFilePrefixHelpers = ({
  prefix,
  endSeparator = DEFAULT_END_SEPARATOR,
  createInvalidPrefixError,
}: SyncFilePrefixConfig): SyncFilePrefixHelpers => {
  const prefixPattern = escapeRegExp(prefix);
  const separatorPattern = escapeRegExp(endSeparator);
  const prefixRegex = new RegExp(
    `^${prefixPattern}(C)?(E)?(\\d+(?:\\.\\d+)?)${separatorPattern}`,
  );

  return {
    getSyncFilePrefix: (cfg: SyncFilePrefixParams): string => {
      const c = cfg.isCompress ? 'C' : '';
      const e = cfg.isEncrypt ? 'E' : '';
      return `${prefix}${c}${e}${formatModelVersion(cfg.modelVersion)}${endSeparator}`;
    },

    extractSyncFileStateFromPrefix: (dataStr: string): SyncFilePrefixParamsOutput => {
      const match = dataStr.match(prefixRegex);
      if (!match) {
        const details: SyncFilePrefixInvalidPrefixDetails = {
          expectedPrefix: prefix,
          endSeparator,
          inputLength: dataStr.length,
          prefixAt: dataStr.indexOf(prefix),
          headShape: classifyHead(dataStr.slice(0, HEAD_SAMPLE_LENGTH)),
        };
        throw createInvalidPrefixError?.(details) ?? new SyncFilePrefixError(details);
      }

      return {
        isCompressed: !!match[1],
        isEncrypted: !!match[2],
        modelVersion: parseModelVersion(match[3]),
        cleanDataStr: dataStr.slice(match[0].length),
      };
    },
  };
};
