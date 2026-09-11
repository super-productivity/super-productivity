import * as fs from 'fs';
import * as path from 'path';

/**
 * Single source of truth for production copy that E2E tests must recognise.
 *
 * Native `window.confirm()` / `window.alert()` text cannot be selected by a
 * locator, so the only way to tell an expected sync confirmation apart from an
 * unexpected one is to compare its message. Copying those sentences into the
 * test suite means a wording change in `en.json` silently stops matching, and a
 * whitelist that no longer matches does not fail loudly — it leaves the native
 * dialog unanswered and stalls the whole spec on a click timeout.
 *
 * Reading the shipped `en.json` instead makes a copy edit fail at exactly one
 * place: `translationText()` throws when a key disappears, and an anchored
 * `translationRegex()` stops matching when a sentence is reworded, which surfaces
 * as an explicit "unexpected native dialog" error naming the new text.
 */
const EN_JSON_PATH = path.join(__dirname, '..', '..', 'src', 'assets', 'i18n', 'en.json');

type TranslationTree = { [key: string]: string | TranslationTree };

let translationCache: TranslationTree | undefined;

const isTranslationTree = (value: unknown): value is TranslationTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const loadTranslations = (): TranslationTree => {
  if (!translationCache) {
    const parsed: unknown = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));
    if (!isTranslationTree(parsed)) {
      throw new Error(`${EN_JSON_PATH} is not a translation object`);
    }
    translationCache = parsed;
  }
  return translationCache;
};

/**
 * Resolves a dotted `t.const` key (e.g. `F.SYNC.D_SYNC_IMPORT_CONFLICT.USE_LOCAL`)
 * to the English string shipped in `src/assets/i18n/en.json`.
 *
 * @throws when the key does not exist, so a renamed or removed key fails the
 * test immediately instead of degrading into a never-matching comparison.
 */
export const translationText = (key: string): string => {
  let node: string | TranslationTree = loadTranslations();

  for (const segment of key.split('.')) {
    if (!isTranslationTree(node) || !(segment in node)) {
      throw new Error(`Translation key not found in en.json: "${key}"`);
    }
    node = node[segment];
  }

  if (typeof node !== 'string') {
    throw new Error(`Translation key is not a leaf string: "${key}"`);
  }
  return node;
};

/**
 * Collapses whitespace runs so multi-line native dialog text (for example a
 * title and body joined by a blank line) can be compared as one sentence.
 */
export const normalizeDialogMessage = (message: string): string =>
  message.replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds an anchored, case-insensitive regex for one or more `en.json` entries,
 * joined by whitespace in the order given (the fresh-client confirmation, for
 * instance, is rendered as `TITLE` + blank line + `MESSAGE`).
 *
 * Interpolated `{{placeholder}}` values become a non-greedy wildcard, so the
 * regex tolerates the runtime counts but nothing else. Test the result against
 * `normalizeDialogMessage(dialog.message())`.
 */
export const translationRegex = (...keys: string[]): RegExp => {
  const pattern = normalizeDialogMessage(keys.map(translationText).join(' '))
    .split(/\{\{[^}]*\}\}/)
    .map(escapeRegExp)
    .join('.+?');

  return new RegExp(`^${pattern}$`, 'i');
};
