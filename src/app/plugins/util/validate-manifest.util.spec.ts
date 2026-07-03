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
});
