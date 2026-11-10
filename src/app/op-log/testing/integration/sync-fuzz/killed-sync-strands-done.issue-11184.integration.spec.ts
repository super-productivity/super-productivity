import { SyncProviderId } from '../../../sync-providers/provider.const';
import { FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import { runFuzz } from './sync-fuzz-runner';

const fileTransport = { providerId: SyncProviderId.Dropbox };

// B completes t1 while C renames it and syncs first: B's next sync has to
// resolve that conflict.
const CONFLICT: FuzzStep[] = [
  { d: 'B', a: ['doneTask', 't1', true] },
  { d: 'C', a: ['renameTask', 't1', 'C1'] },
  { d: 'C', s: 1 },
];
// The app dies before the second durable write of that sync and restarts: the
// first write, which appends the resolution's merge op, is all that is kept.
const KILLED_SYNC: FuzzStep = { d: 'B', s: 1, x: 2 };
const THIRD_DEVICE_EDIT: FuzzStep = { d: 'A', a: ['editTaskNotes', 't1', 'A10'] };

const failuresOf = async (steps: FuzzStep[]): Promise<string> =>
  (await runFuzz({ steps, fileTransport })).failures
    .map((f) => `${f.signature} (${f.detail})`)
    .join('\n');

/**
 * #11184, second shape (found by the fuzz kill step, shrunk from seed
 * 20725019 of the `tasks` profile): a sync that is killed while it resolves a
 * conflict leaves the completing device with a done no other device ever
 * gets, once a third device edits the same task before the next sync. The
 * syncs after the restart raise no error.
 */
describe('#11184 a sync killed while resolving a conflict over a done', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('converges without the kill', async () => {
    expect(await failuresOf([...CONFLICT, { d: 'B', s: 1 }, THIRD_DEVICE_EDIT])).toBe('');
  });

  it('recovers when the device syncs again before anything else changes', async () => {
    expect(await failuresOf([...CONFLICT, KILLED_SYNC, { d: 'B', s: 1 }])).toBe('');
  });

  it('still delivers the done after a third device edits the task', async () => {
    expect(await failuresOf([...CONFLICT, KILLED_SYNC, THIRD_DEVICE_EDIT])).toBe('');
  });
});
