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
});
