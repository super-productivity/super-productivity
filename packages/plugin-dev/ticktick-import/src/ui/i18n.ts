import english from '../../i18n/en.json';

type TranslationParams = Record<string, string | number>;

interface TranslationApi {
  translate: (key: string, params?: TranslationParams) => string | Promise<string>;
}

const flatten = (value: Record<string, unknown>, prefix = ''): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof nestedValue === 'string') {
      result[fullKey] = nestedValue;
    } else if (nestedValue && typeof nestedValue === 'object') {
      Object.assign(result, flatten(nestedValue as Record<string, unknown>, fullKey));
    }
  }
  return result;
};

const englishByKey = flatten(english);
let translatedByKey: Record<string, string> = { ...englishByKey };

export const loadTranslations = async (api: TranslationApi): Promise<void> => {
  translatedByKey = { ...englishByKey };
  await Promise.all(
    Object.keys(englishByKey).map(async (key) => {
      try {
        const translated = await Promise.resolve(api.translate(key));
        if (translated && translated !== key) {
          translatedByKey[key] = translated;
        }
      } catch {
        // Bundled English remains available if the iframe bridge is unavailable.
      }
    }),
  );
};

export const t = (key: string, params: TranslationParams = {}): string => {
  let value = translatedByKey[key] || englishByKey[key] || key;
  for (const [name, replacement] of Object.entries(params)) {
    value = value.split(`{{${name}}}`).join(String(replacement));
  }
  return value;
};
