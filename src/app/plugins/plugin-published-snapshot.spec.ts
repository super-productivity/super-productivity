import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import frozen from '../op-log/validation/test-fixtures/frozen-state-v18.15.json';
import {
  projectPublishedPluginSnapshot,
  PublishedPluginSnapshot,
} from './plugin-published-snapshot';
import { encodeForPersist } from './util/plugin-data-codec';

interface SnapshotFixture {
  taskArchiveSnapshotVersion: number;
  version: number;
  schemaVersion: number;
  syncVersion: number;
  vectorClock: Record<string, number>;
  clientId: string;
  lastModified: number;
  recentOps: unknown[];
  state: Omit<typeof frozen.state, 'archiveYoung' | 'archiveOld'>;
  archiveYoung: typeof frozen.state.archiveYoung;
  archiveOld: typeof frozen.state.archiveOld;
}

describe('projectPublishedPluginSnapshot', () => {
  // Use the actual persisted task/archives/plugin array shapes of a prior release,
  // in the v2 transport envelope. Do not change the frozen source fixture.
  const fixture = (): SnapshotFixture => {
    const { archiveYoung, archiveOld, ...state } = structuredClone(frozen.state);
    return {
      taskArchiveSnapshotVersion: 1,
      version: 2,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      syncVersion: 12,
      vectorClock: { clientA: 7, clientB: 2 },
      clientId: 'clientA',
      lastModified: 1700000000000,
      recentOps: [],
      state,
      archiveYoung,
      archiveOld,
    };
  };
  const project = (input: unknown): Promise<PublishedPluginSnapshot> =>
    projectPublishedPluginSnapshot(input, 'plugin-a', 'published-rev');

  it('refuses snapshots whose writer did not prove the task/archive capture', async () => {
    for (const version of [undefined, null, 0, 2, '1']) {
      await expectAsync(
        project({ ...fixture(), taskArchiveSnapshotVersion: version }),
      ).toBeRejected();
    }
  });

  it('projects real active and archived tasks and the legacy root plugin entry', async () => {
    const input = fixture();
    const result = await project(input);
    expect(result.format).toBe('file-v2');
    expect(result.revision).toBe('published-rev');
    expect(result.clock).toEqual(input.vectorClock);
    expect(
      result.tasks.filter((task) => task.location === 'active').map((task) => task.id),
    ).toEqual(input.state.task.ids);
    expect(
      result.tasks.filter((task) => task.location === 'archive').map((task) => task.id),
    ).toEqual([...input.archiveYoung.task.ids, ...input.archiveOld.task.ids]);
    expect(result.pluginData).toEqual([{ key: '', value: '{}' }]);
    expect(JSON.stringify(result)).not.toContain('title');
  });

  it('strictly decodes owned gzip, preserves colon/Unicode keys, and excludes foreign payloads', async () => {
    const input = fixture();
    const text = 'attachment metadata '.repeat(120);
    const encoded = await encodeForPersist(text);
    expect(encoded.startsWith('GZ1:')).toBeTrue();
    input.state.pluginUserData.push(
      { id: 'plugin-a:вложения:a:b', data: encoded },
      { id: 'plugin-ab:foreign', data: 'GZ1:not-gzip' },
      { id: 'plugin-b', data: 'private foreign value' },
    );
    const result = await project(input);
    expect(result.pluginData).toEqual([
      { key: '', value: '{}' },
      { key: 'вложения:a:b', value: text },
    ]);
    expect(input.state.pluginUserData[1].data).toBe(encoded);
  });

  it('rejects corrupt owned gzip instead of treating it as missing data', async () => {
    const input = fixture();
    for (const data of ['GZ1:not-base64!', 'GZ1:bm90IGd6aXA=']) {
      input.state.pluginUserData = [{ id: 'plugin-a:key', data }];
      await expectAsync(project(input)).toBeRejected();
    }
  });

  it('rejects missing archives and malformed ids/entities rather than proving an empty archive', async () => {
    const input: Record<string, unknown> = { ...fixture() };
    for (const field of ['archiveYoung', 'archiveOld']) {
      const original = input[field];
      for (const invalid of [
        undefined,
        null,
        {},
        { task: null },
        { task: { ids: [], entities: null } },
        { task: { ids: ['missing'], entities: {} } },
        { task: { ids: [], entities: { unlisted: { id: 'unlisted', isDone: true } } } },
      ]) {
        input[field] = invalid;
        await expectAsync(project(input)).toBeRejected();
      }
      input[field] = original;
    }
  });

  it('rejects duplicate, unlisted, mismatched and non-string active task ids', async () => {
    const variants = [
      { ids: ['a', 'a'], entities: { a: { id: 'a', isDone: false } } },
      { ids: ['a'], entities: { a: { id: 'b', isDone: false } } },
      { ids: [1], entities: { ['1']: { id: '1', isDone: false } } },
      { ids: ['a'], entities: { a: { id: 'a' } } },
      { ids: ['a'], entities: { a: { id: 'a', isDone: null } } },
    ];
    for (const task of variants) {
      const input = { ...fixture(), state: { ...fixture().state, task } };
      await expectAsync(project(input)).toBeRejected();
    }
    const input = fixture();
    await expectAsync(
      project({ ...input, archiveYoung: input.archiveOld }),
    ).toBeRejected();
    const duplicated = { ids: ['a'], entities: { a: { id: 'a', isDone: true } } };
    await expectAsync(
      project({
        ...fixture(),
        state: { ...fixture().state, task: duplicated },
        archiveYoung: { task: duplicated },
      }),
    ).toBeRejected();
  });

  it('retains archive presence with unknown completion only when isDone is absent', async () => {
    const input = {
      ...fixture(),
      archiveYoung: { task: { ids: ['legacy'], entities: { legacy: { id: 'legacy' } } } },
    };
    expect((await project(input)).tasks.find((task) => task.id === 'legacy')).toEqual({
      id: 'legacy',
      location: 'archive',
      isDone: null,
    });
    for (const isDone of [null, 'true', 1]) {
      await expectAsync(
        project({
          ...input,
          archiveYoung: {
            task: { ids: ['legacy'], entities: { legacy: { id: 'legacy', isDone } } },
          },
        }),
      ).toBeRejected();
    }
  });

  it('rejects absent or malformed task and plugin slices, including duplicate persistence ids', async () => {
    const input = fixture();
    for (const task of [undefined, null, [], {}])
      await expectAsync(
        project({ ...input, state: { ...input.state, task } }),
      ).toBeRejected();
    for (const pluginUserData of [
      undefined,
      null,
      {},
      [null],
      [{ id: 'plugin-a', data: 1 }],
      [
        { id: 'plugin-a', data: '{}' },
        { id: 'plugin-a', data: '{}' },
      ],
      [{ id: 'plugin-a:', data: '{}' }],
      [{ id: 'plugin-a:' + 'x'.repeat(257), data: '{}' }],
    ]) {
      await expectAsync(
        project({ ...input, state: { ...input.state, pluginUserData } }),
      ).toBeRejected();
    }
  });

  it('rejects unsupported envelopes, schema versions and invalid clocks', async () => {
    for (const input of [
      null,
      [],
      {},
      { ...fixture(), version: 3 },
      { ...fixture(), schemaVersion: 0 },
      { ...fixture(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
      { ...fixture(), schemaVersion: '4' },
    ])
      await expectAsync(project(input)).toBeRejected();
    for (const vectorClock of [
      undefined,
      null,
      [],
      { a: -1 },
      { a: 1.5 },
      { a: Infinity },
      { a: Number.MAX_SAFE_INTEGER + 1 },
      { a: '1' },
      { ['']: 1 },
    ])
      await expectAsync(project({ ...fixture(), vectorClock })).toBeRejected();
    expect((await project({ ...fixture(), vectorClock: {} })).clock).toEqual({});
    await expectAsync(
      projectPublishedPluginSnapshot(fixture(), 'plugin:a', 'rev'),
    ).toBeRejected();
    await expectAsync(
      projectPublishedPluginSnapshot(fixture(), '', 'rev'),
    ).toBeRejected();
    await expectAsync(
      projectPublishedPluginSnapshot(fixture(), 'plugin-a', ''),
    ).toBeRejected();
  });

  it('rejects incomplete v2 envelope metadata instead of certifying a commit', async () => {
    for (const invalid of [
      { syncVersion: undefined },
      { syncVersion: -1 },
      { syncVersion: 1.5 },
      { syncVersion: Number.MAX_SAFE_INTEGER + 1 },
      { clientId: '' },
      { clientId: 1 },
      { lastModified: undefined },
      { lastModified: -1 },
      { lastModified: Infinity },
      { lastModified: '1700000000000' },
      { recentOps: undefined },
      { recentOps: {} },
    ])
      await expectAsync(project({ ...fixture(), ...invalid })).toBeRejected();
    const input = fixture();
    // In v2 these retained operations are already included in the snapshot;
    // the projection does not claim to independently interpret their payloads.
    input.recentOps = [{ sv: 12, id: 'retained-op' }];
    expect((await project(input)).tasks.length).toBeGreaterThan(0);
  });

  it('captures one complete projection before owned gzip decoding yields', async () => {
    const input = fixture();
    input.state.pluginUserData.push({
      id: 'plugin-a:compressed',
      data: await encodeForPersist('published attachment metadata '.repeat(120)),
    });
    const expected = await project(input);
    const pending = project(input);

    // The caller still owns input while the gzip decoder is asynchronous.
    // Later changes must not leak into any part of this captured projection.
    input.vectorClock.clientA = 999;
    input.state.task.ids.length = 0;
    input.archiveYoung.task.ids.length = 0;
    input.archiveOld.task.ids.length = 0;
    for (const entry of input.state.pluginUserData) {
      entry.id = 'plugin-b:changed';
      entry.data = 'changed after capture';
    }

    expect(await pending).toEqual(expected);
  });
  it('returns detached projections without mutating or retaining source objects', async () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = await project(input);
    expect(JSON.stringify(input)).toBe(before);
    result.clock.clientA = 999;
    result.tasks[0].id = 'changed';
    result.pluginData[0].value = 'changed';
    expect(JSON.stringify(input)).toBe(before);
  });
});
