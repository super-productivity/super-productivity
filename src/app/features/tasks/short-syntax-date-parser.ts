import type {
  Chrono,
  ParsedResult,
  ParsingContext,
  ParsingOption,
  ParsingResult,
} from 'chrono-node';
import { DateInputLocale } from '../../core/date-time-format/date-input-locale';
import { LanguageCode } from '../../core/locale.constants';

type ChronoConfiguration = NonNullable<ConstructorParameters<typeof Chrono>[0]>;

interface ChronoLocale {
  // ru, uk, ja and zh take no date-order argument: their own formats are fixed
  createCasualConfiguration: (littleEndian?: boolean) => ChronoConfiguration;
}

// Locales that ignore the date-order argument (ru and uk are always day-first,
// ja always month-first, zh reads no slash dates). The text both parsers read
// identically is then always numeric, and only English follows the user's date
// format, so English wins that tie.
const FIXED_DATE_ORDER_LANGUAGES: ReadonlySet<string> = new Set([
  LanguageCode.ja,
  LanguageCode.ru,
  LanguageCode.uk,
  LanguageCode.zh,
  LanguageCode.zh_tw,
]);

/** What the `@` / `!` stages need from a date parser */
export interface ShortSyntaxDateParser {
  parse(text: string, ref: Date, option?: ParsingOption): ParsedResult[];
}

// Each locale is its own chunk, loaded only for users whose UI language needs
// it; English users load just `chrono-node/en`. Literal specifiers so the
// bundler can split them.
const loadEn = (): Promise<ChronoLocale & { Chrono: typeof Chrono }> =>
  import('chrono-node/en').then((m) => ({
    Chrono: m.Chrono,
    createCasualConfiguration: (littleEndian) => {
      const configuration = m.configuration.createCasualConfiguration(littleEndian);
      // chrono's day-first flag also stops "dec 20" to "dec 25" without a year
      // from reading as a day (en-GB's guess that "Dec 25" means 2025), so
      // "@dec 24" became 2024-12-01. The date order is only about numeric
      // dates; month names keep reading the number as the day.
      configuration.parsers.forEach((parser) => {
        if ('shouldSkipYearLikeDate' in parser) {
          parser.shouldSkipYearLikeDate = false;
        }
      });
      return configuration;
    },
  }));

// UI language (LanguageCode) → chrono-node locale shipped in the installed
// version (2.9). Languages without a chrono locale parse English only.
const LOCALE_LOADERS: Partial<Record<LanguageCode, () => Promise<ChronoLocale>>> = {
  [LanguageCode.de]: () => import('chrono-node/de'),
  [LanguageCode.es]: () => import('chrono-node/es'),
  [LanguageCode.fi]: () => import('chrono-node/fi'),
  [LanguageCode.fr]: () => import('chrono-node/fr'),
  // chrono's Italian parsers import the package root, so this one chunk pulls
  // in every locale — what all users loaded before locales were split
  [LanguageCode.it]: () => import('chrono-node/it').then((m) => ({
    createCasualConfiguration: (littleEndian?: boolean) => m.configuration.createCasualConfiguration(),
  })),
  [LanguageCode.ja]: () => import('chrono-node/ja'),
  [LanguageCode.nl]: () => import('chrono-node/nl'),
  [LanguageCode.pt]: () => import('chrono-node/pt'),
  [LanguageCode.pt_br]: () => import('chrono-node/pt'),
  [LanguageCode.ru]: () => import('chrono-node/ru'),
  [LanguageCode.sv]: () => import('chrono-node/sv'),
  [LanguageCode.uk]: () => import('chrono-node/uk'),
  [LanguageCode.vi]: () => import('chrono-node/vi'),
  // the zh parser reads both simplified and traditional characters
  [LanguageCode.zh]: () => import('chrono-node/zh'),
  [LanguageCode.zh_tw]: () => import('chrono-node/zh'),
};

const twoDigitYearRefiner = {
  refine: (context: ParsingContext, results: ParsingResult[]): ParsingResult[] => {
    results.forEach((result) => {
      const { refDate, text, start } = result;
      const regex = / [5-9][0-9]$/;
      const yearIndex = text.search(regex);
      // The year pattern in Chrono's source code is (?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-2][0-9]{3}|[5-9][0-9]|2[0-5]).
      // This means any two-digit numeric value from 50 to 99 will be considered a year.
      // Link: https://github.com/wanasit/chrono/blob/54e7ff12f9185e735ee860c25922b2ab2367d40b/src/locales/en/constants.ts#L234C30-L234C108
      // When someone creates a task like "Test @25/4 90m", Chrono will return
      // the year as 1990, which is an undesirable behaviour in most cases.
      if (yearIndex !== -1) {
        result.text = text.slice(0, yearIndex);
        const current = new Date();
        let year = current.getFullYear();
        const impliedDate = start.get('day');
        const impliedMonth = start.get('month');
        if (
          (impliedMonth && impliedMonth < refDate.getMonth() + 1) ||
          (impliedMonth === refDate.getMonth() + 1 &&
            impliedDate &&
            impliedDate < refDate.getDate())
        ) {
          year += 1;
        }
        result.start.assign('year', year);
      }
    });
    return results;
  },
};

// Not every locale module re-exports the Chrono class (`chrono-node/it` does
// not), so all parsers are built with English's — the same class from chrono's
// shared core.
const createChrono = (
  ChronoClass: typeof Chrono,
  locale: ChronoLocale,
  isDayFirst: boolean,
): Chrono => {
  const configuration = locale.createCasualConfiguration(isDayFirst);
  configuration.refiners.push(twoDigitYearRefiner);
  return new ChronoClass(configuration);
};

// The UI-language result wins only where it is the better match: it must start
// earlier, or at the same place and run longer, than the English one. Ties go
// to the UI language, unless it ignores the date order (see
// FIXED_DATE_ORDER_LANGUAGES). So "@tomorrow 3pm" stays English under a German
// UI (German alone only reads the "3pm" further in), and "@morgen 15 Uhr" is
// German because English finds nothing.
const isBetterMatch = (a: ParsedResult, b: ParsedResult, isTieWinner: boolean): boolean =>
  a.index < b.index ||
  (a.index === b.index &&
    (a.text.length > b.text.length || (a.text.length === b.text.length && isTieWinner)));

// A UI-language short word (German "so" and "do", Dutch "zo") counts only at
// the start of the token, after the trigger char: further in it is an ordinary
// word, and the match would consume the title text up to it ("max@firma.de so
// bald" → due Sunday). A longer match may start further in, because chrono
// leaves a leading article or preposition out of it ("@le 5 mars", "@el
// lunes", "@um 15 Uhr").
const isShortWord = (text: string): boolean => /^\p{L}{1,3}\.?$/u.test(text.trim());
const isTrustedUiResult = (text: string, result: ParsedResult): boolean =>
  /^[@!]?\s*$/.test(text.slice(0, result.index)) || !isShortWord(result.text);

const combine = (
  uiParser: Chrono,
  enParser: Chrono,
  isUiTieWinner: boolean,
): ShortSyntaxDateParser => ({
  parse: (text, ref, option) => {
    const uiResults = uiParser
      .parse(text, ref, option)
      .filter((result) => isTrustedUiResult(text, result));
    const enResults = enParser.parse(text, ref, option);
    if (!uiResults.length) {
      return enResults;
    }
    if (!enResults.length) {
      return uiResults;
    }
    return isBetterMatch(uiResults[0], enResults[0], isUiTieWinner)
      ? uiResults
      : enResults;
  },
});

const parserCache = new Map<string, ShortSyntaxDateParser>();
const parserPromiseCache = new Map<string, Promise<ShortSyntaxDateParser>>();

/**
 * The date parser for the given date input locale: English plus the UI
 * language when chrono-node ships a locale for it, never every language — a
 * word that is a date in a language the user does not write ("mar", Spanish
 * for Tuesday) would otherwise eat ordinary title text. Numeric dates follow
 * the date format's day/month order.
 */
export const loadShortSyntaxDateParser = (
  locale: DateInputLocale,
): Promise<ShortSyntaxDateParser> => {
  const language = locale.language.toLowerCase();
  const loadUiLocale = LOCALE_LOADERS[language as LanguageCode];
  const key = `${loadUiLocale ? language : 'en'}|${locale.isDayFirst}`;
  const cached = parserCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  let promise = parserPromiseCache.get(key);
  if (!promise) {
    promise = Promise.all([loadEn(), loadUiLocale?.()]).then(([en, ui]) => {
      const enParser = createChrono(en.Chrono, en, locale.isDayFirst);
      const parser = ui
        ? combine(
            createChrono(en.Chrono, ui, locale.isDayFirst),
            enParser,
            !FIXED_DATE_ORDER_LANGUAGES.has(language),
          )
        : enParser;
      parserCache.set(key, parser);
      return parser;
    });
    parserPromiseCache.set(key, promise);
  }
  return promise;
};
