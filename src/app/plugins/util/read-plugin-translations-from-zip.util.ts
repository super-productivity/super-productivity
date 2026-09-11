import { SUPPORTED_LANGUAGE_CODES } from '../../core/locale.constants';
import { PluginLog } from '../../core/log';

// JSON must be UTF-8, so a decode failure IS an invalid translation file. Fatal
// decoding also stops mojibake (U+FFFD) being cached and served as if it were text.
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode and validate one translation file, returning its raw JSON text or `null`.
 *
 * The cache contract is raw text (PluginI18nService parses it again), and unusable
 * content stored there survives every restart while silently degrading translate()
 * to returning keys — the #9459 symptom. So reject anything that cannot round-trip:
 * non-UTF-8 bytes, unparseable JSON, and values that parse but are not objects
 * (`null`, `"str"`, `123`, `[]` all resolve every lookup to the key itself).
 */
const readTranslationFile = (bytes: Uint8Array): string | null => {
  try {
    const content = TEXT_DECODER.decode(bytes);
    const parsed: unknown = JSON.parse(content);
    const isObject =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return isObject ? content : null;
  } catch {
    return null;
  }
};

type SkippedTranslationReason = 'file-missing' | 'not-a-utf8-json-object';

interface SkippedTranslation {
  lang: string;
  reason: SkippedTranslationReason;
}

interface PluginTranslationsFromZip {
  /** Language code -> raw JSON text, ready for both the cache and the i18n service. */
  translations: Record<string, string>;
  skipped: SkippedTranslation[];
  /** True when `maxTotalBytes` was hit; the caller must reject the upload. */
  isOverLimit: boolean;
}

/**
 * Read the translation files a plugin ZIP ships for the languages its manifest
 * declares. Uploaded plugins live at a virtual cache path, so anything not taken
 * here is unreachable once the ZIP is discarded.
 *
 * Languages are de-duplicated because a manifest may repeat a code, and each skip
 * is reported so the caller can tell the author why a declared language produced
 * no translations — #9459 was exactly that failure, silent. Codes the app does not
 * support are dropped without a skip entry: `validatePluginManifest` already warns
 * about those, and re-reporting them here would duplicate the rule.
 */
export const readPluginTranslationsFromZip = (
  extractedFiles: Record<string, Uint8Array>,
  languages: readonly string[],
  maxTotalBytes: number,
): PluginTranslationsFromZip => {
  const translations: Record<string, string> = {};
  const skipped: SkippedTranslation[] = [];
  let totalBytes = 0;

  for (const lang of new Set(languages)) {
    if (!SUPPORTED_LANGUAGE_CODES.has(lang)) {
      continue;
    }
    const bytes = extractedFiles[`i18n/${lang}.json`];
    if (bytes === undefined) {
      skipped.push({ lang, reason: 'file-missing' });
      continue;
    }
    // Check before decoding, so the KEPT set never materializes beyond the limit.
    // Only accepted files accumulate, so a run of large unparseable ones still
    // decodes transiently: this bounds what is stored, not peak memory — `unzip`
    // has already decompressed the whole archive by the time we get here.
    // The caller rejects the upload on this return, so the partial map is unobserved.
    if (totalBytes + bytes.length > maxTotalBytes) {
      return { translations: {}, skipped, isOverLimit: true };
    }
    const content = readTranslationFile(bytes);
    if (content === null) {
      skipped.push({ lang, reason: 'not-a-utf8-json-object' });
      continue;
    }
    totalBytes += bytes.length;
    translations[lang] = content;
  }

  return { translations, skipped, isOverLimit: false };
};

/**
 * `Log.recordLog` stores a string argument verbatim in the exportable, ring-buffered
 * log history, so the third-party parts of this message are bounded at the source:
 * `skipped` by the supported-language count, `lang` by the allowlist, `reason` by its
 * union. `pluginId` is not bounded here — it is already logged untruncated from ~10
 * pre-existing sites (plugin-cache.service.ts, startup discovery), so bounding it is
 * a separate, wider change than this one.
 */
export const logSkippedPluginTranslations = (
  pluginId: string,
  skipped: readonly SkippedTranslation[],
): void => {
  for (const { lang, reason } of skipped) {
    // warn, matching how PluginLoaderService reports the same class of problem for
    // path-based plugins: a plugin author's omission, not an app error.
    PluginLog.warn(
      `Plugin ${pluginId} declares i18n language "${lang}" but no translations were loaded (${reason})`,
    );
  }
};
