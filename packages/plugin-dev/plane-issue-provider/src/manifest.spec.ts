import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';

describe('Plane manifest', () => {
  // `issueProviderKey` is reserved for plugins that took over an existing built-in
  // key and its persisted configurations (GITHUB, LINEAR, …). Plane never was one, so
  // the host must assign `plugin:plane-issue-provider`. Claiming a global key would
  // write it into synced user data, where it is no longer cheap to take back.
  // See docs/add-new-integration.md §1.
  //
  // Everything else about this manifest is cross-checked against the code that
  // consumes it — the icon name and its asset by
  // `electron/bundled-plugin-ids.test.cjs`, the reserved id by the same file — rather
  // than restated here, where a test could only ever agree with the file it read.
  it('does not claim a global issue provider key', () => {
    expect(manifest.issueProvider).not.toHaveProperty('issueProviderKey');
  });
});
