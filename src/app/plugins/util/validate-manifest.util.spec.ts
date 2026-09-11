import { SUPPORTED_LANGUAGE_CODES } from '../../core/locale.constants';
import { PluginManifest } from '../plugin-api.model';
import { validatePluginManifest } from './validate-manifest.util';

const baseManifest: PluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
} as PluginManifest;

describe('validatePluginManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validatePluginManifest(baseManifest);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a plugin id containing ':'", () => {
    // ':' is reserved as the persistence key delimiter (composeId). A
    // plugin with this id would collide with another plugin's keyed
    // namespace and over-match in removePluginUserData's prefix sweep.
    const result = validatePluginManifest({ ...baseManifest, id: 'evil:plugin' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Plugin ID must not contain ':' (reserved as the persistence key delimiter)",
    );
  });

  it('rejects a missing plugin id', () => {
    const result = validatePluginManifest({
      ...baseManifest,
      id: undefined as unknown as string,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Plugin ID is required');
  });

  describe('allowedHosts', () => {
    it('accepts a manifest with valid host-only entries', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        allowedHosts: ['api.example.com', '3.basecampapi.com'],
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts an omitted allowedHosts (undefined is valid)', () => {
      const result = validatePluginManifest(baseManifest);
      expect(result.isValid).toBe(true);
    });

    it('rejects allowedHosts that is not an array', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        allowedHosts: 'api.example.com' as unknown as string[],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('allowedHosts must be an array of hostnames');
    });

    it('rejects entries carrying a scheme, port, or path', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        allowedHosts: ['https://api.example.com'],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'allowedHosts entries must be non-empty hostnames without scheme, port, or path (e.g. "api.example.com")',
      );
    });

    it('rejects empty or non-string entries', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        allowedHosts: ['  ', 42 as unknown as string],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'allowedHosts entries must be non-empty hostnames without scheme, port, or path (e.g. "api.example.com")',
      );
    });
  });

  describe('i18n.languages', () => {
    it('warns about unsupported codes without rejecting the manifest', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        i18n: { languages: ['en', 'pt-BR'] },
      });
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        'Unsupported language codes: pt-BR - these will be ignored',
      );
    });

    // `languages` is third-party and bounded only by the 100KB manifest cap, and this
    // warning is logged verbatim into the exportable log history, so the message must
    // not grow with the input — in EITHER dimension.
    const unsupportedWarning = (languages: string[]): string | undefined =>
      validatePluginManifest({ ...baseManifest, i18n: { languages } }).warnings.find(
        (w) => w.startsWith('Unsupported language codes:'),
      );

    it('bounds the warning when there are many codes', () => {
      const warning = unsupportedWarning([
        'en',
        ...Array.from({ length: 5000 }, (_, i) => `bogus-${i}`),
      ]);

      expect(warning).toBeDefined();
      expect(warning!.length).toBeLessThan(300);
      expect(warning).toContain('(+4990 more)');
    });

    // Capping only the count still allowed ~80KB: 12 codes x 8000 chars fits the
    // manifest cap. Each code must be truncated too.
    it('bounds the warning when a single code is enormous', () => {
      const warning = unsupportedWarning(['en', ...Array(12).fill('x'.repeat(8000))]);

      expect(warning).toBeDefined();
      expect(warning!.length).toBeLessThan(300);
    });

    it('never fails the manifest over bad language codes', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        i18n: { languages: ['en', 'pt-BR'] },
      });
      expect(result.isValid).toBe(true);
    });

    // Several bundled plugins declare exactly this many, so a cap here would put
    // them one added language away from failing to load at all.
    it('accepts a declaration of every supported language', () => {
      const result = validatePluginManifest({
        ...baseManifest,
        i18n: { languages: [...SUPPORTED_LANGUAGE_CODES] },
      });
      expect(result.isValid).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });
});
