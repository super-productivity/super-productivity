import { PluginUserData } from '../plugin-persistence.model';
import { diffChangedPluginIds } from './plugin-data-diff.util';

const entry = (id: string, data: string): PluginUserData => ({ id, data });

describe('diffChangedPluginIds', () => {
  it('returns [] when prev and next are entry-equal but a fresh array (no-op write)', () => {
    // Covers the reducer's `state.map(...)` path producing a new array for an
    // identical write — the encoded blob's `===` check on the entry must skip
    // the no-op.
    const prev = [entry('a', 'gz:abc'), entry('b', 'gz:def')];
    const next = prev.map((e) => ({ ...e }));
    expect(next).not.toBe(prev);
    expect(diffChangedPluginIds(prev, next)).toEqual([]);
  });

  it('reports added, updated, and deleted in one pass', () => {
    const prev = [
      entry('keep', 'gz:same'),
      entry('change', 'gz:old'),
      entry('removed', 'gz:gone'),
    ];
    const next = [
      entry('keep', 'gz:same'),
      entry('change', 'gz:new'),
      entry('added', 'gz:fresh'),
    ];
    const changed = diffChangedPluginIds(prev, next);
    expect(changed.sort()).toEqual(['added', 'change', 'removed']);
  });

  it('normalizes keyed entityIds to the owner pluginId and dedupes', () => {
    // Stage A: one plugin can own many `pluginId:key` entries. A handler is
    // registered under the bare pluginId, so the differ must collapse the
    // composites and fire the hook once per owner.
    const prev = [
      entry('foo:doc-1', 'gz:1'),
      entry('foo:doc-2', 'gz:1'),
      entry('bar', 'gz:1'),
    ];
    const next = [
      entry('foo:doc-1', 'gz:2'), // updated
      entry('foo:doc-3', 'gz:new'), // added — same owner
      entry('bar', 'gz:1'), // unchanged
      // 'foo:doc-2' missing → deleted, same owner
    ];
    expect(diffChangedPluginIds(prev, next)).toEqual(['foo']);
  });
});
