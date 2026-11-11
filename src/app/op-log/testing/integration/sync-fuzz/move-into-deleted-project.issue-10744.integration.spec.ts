import {
  addNote,
  moveNoteToOtherProject,
} from '../../../../features/note/store/note.actions';
import { Note } from '../../../../features/note/note.model';
import { DEFAULT_PROJECT } from '../../../../features/project/project.const';
import { Project } from '../../../../features/project/project.model';
import { addProject } from '../../../../features/project/store/project.actions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * #10744: device A deletes a project while device B, before either syncs,
 * moves a note into it. Neither op declares the other's entity, so no conflict
 * is detected and each device applies the other's op on its own. The moved
 * note must survive in the Inbox, identically on both devices, in both sync
 * orders and after a restart. Tasks are out of scope: they still go with the
 * project (#8997).
 */
const INBOX = 'INBOX_PROJECT';
const DOOMED = 'doomed';
const KEPT = 'kept';

interface NoteView {
  item?: { projectId?: string | null; content: string };
  listedIn: string[];
  projectIds: string[];
  inbox: string[];
}

describe('note moved into a concurrently deleted project (#10744)', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const slices = async (): Promise<{
    projects: { ids: string[]; entities: Record<string, Project> };
    note: { entities: Record<string, Note> };
  }> => (await harness.state()) as never;

  const view = (device: FuzzDevice): Promise<NoteView> =>
    harness.as(device, async () => {
      const { projects, note } = await slices();
      const moved = note.entities['moved'];
      return {
        item: moved && { projectId: moved.projectId, content: moved.content },
        listedIn: projects.ids.filter((id) =>
          projects.entities[id].noteIds.includes('moved'),
        ),
        projectIds: projects.ids,
        inbox: projects.entities[INBOX].noteIds,
      };
    });

  const addInboxNote = (id: string): Promise<void> =>
    harness.dispatch(
      addNote({
        note: {
          id,
          projectId: INBOX,
          isPinnedToToday: false,
          content: `content of ${id}`,
          created: Date.now(),
          modified: Date.now(),
        },
      }),
    );

  // The payloads ProjectService.remove and the move menu build from live state.
  const deleteDoomed = async (): Promise<void> => {
    const { projects } = await slices();
    const project = projects.entities[DOOMED];
    await harness.dispatch(
      TaskSharedActions.deleteProject({
        projectId: DOOMED,
        noteIds: project.noteIds,
        allTaskIds: [...project.taskIds, ...project.backlogTaskIds],
      }),
    );
  };

  const moveTo = async (targetProjectId: string, id = 'moved'): Promise<void> => {
    const { note } = await slices();
    await harness.dispatch(
      moveNoteToOtherProject({ note: note.entities[id], targetProjectId }),
    );
  };

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  const seed = async (projectIds: string[]): Promise<void> => {
    await harness.as(a, async () => {
      for (const id of projectIds) {
        await harness.dispatch(
          addProject({ project: { ...DEFAULT_PROJECT, id, title: id } }),
        );
      }
      // Notes are prepended, so the Inbox lists the moved note first and a
      // re-homed one visibly changes place.
      for (const id of ['sibling', 'moved']) {
        await addInboxNote(id);
      }
    });
    expect(await harness.sync(a)).toBe(true);
    expect(await harness.sync(b)).toBe(true);
  };

  // The crossing: both changes are made before either device syncs.
  const crossAndSync = async (
    first: 'deleter' | 'mover',
    moverChange: () => Promise<void>,
  ): Promise<void> => {
    harness.tick();
    await harness.as(a, deleteDoomed);
    harness.tick();
    await harness.as(b, moverChange);
    await syncBoth(first);
  };

  const syncBoth = async (first: 'deleter' | 'mover'): Promise<void> => {
    const order = first === 'deleter' ? [a, b] : [b, a];
    for (let round = 0; round < 3; round++) {
      for (const device of order) {
        expect(await harness.sync(device)).toBe(true);
      }
    }
    expect(harness.events).toEqual([]);
  };

  const expectOnBothAndAfterRestart = async (expected: NoteView): Promise<void> => {
    expect({ A: await view(a), B: await view(b) }).toEqual({
      A: expected,
      B: expected,
    });
    for (const device of [a, b]) {
      await harness.restart(device);
      expect(await view(device)).toEqual(expected);
    }
    // A device that joins later replays both ops in server order.
    const c = await harness.addDevice('C');
    expect(await harness.sync(c)).toBe(true);
    expect(await view(c)).toEqual(expected);
  };

  for (const first of ['deleter', 'mover'] as const) {
    it(`keeps a moved note in the Inbox on both devices / ${first} syncs first`, async () => {
      await seed([DOOMED]);
      await crossAndSync(first, () => moveTo(DOOMED));
      await expectOnBothAndAfterRestart({
        item: { projectId: INBOX, content: 'content of moved' },
        listedIn: [INBOX],
        projectIds: [INBOX],
        inbox: ['sibling', 'moved'],
      });
    }, 60_000);

    it(`follows a note moved on from the deleted project / ${first} syncs first`, async () => {
      await seed([DOOMED, KEPT]);
      await crossAndSync(first, async () => {
        await moveTo(DOOMED);
        harness.tick();
        await moveTo(KEPT);
      });
      await expectOnBothAndAfterRestart({
        item: { projectId: KEPT, content: 'content of moved' },
        listedIn: [KEPT],
        projectIds: [INBOX, KEPT],
        inbox: ['sibling'],
      });
    }, 60_000);

    it(`keeps several moved notes in the Inbox in one order / ${first} syncs first`, async () => {
      await seed([DOOMED]);
      await harness.as(a, () => addInboxNote('moved2'));
      expect(await harness.sync(a)).toBe(true);
      expect(await harness.sync(b)).toBe(true);
      await crossAndSync(first, async () => {
        await moveTo(DOOMED);
        harness.tick();
        await moveTo(DOOMED, 'moved2');
      });
      const lists = (device: FuzzDevice): Promise<unknown> =>
        harness.as(device, async () => {
          const { projects, note } = await slices();
          return {
            inbox: projects.entities[INBOX].noteIds,
            owners: ['moved', 'moved2'].map((id) => note.entities[id]?.projectId),
            projectIds: projects.ids,
          };
        });
      const expected = {
        inbox: ['sibling', 'moved', 'moved2'],
        owners: [INBOX, INBOX],
        projectIds: [INBOX],
      };
      expect({ A: await lists(a), B: await lists(b) }).toEqual({
        A: expected,
        B: expected,
      });
    }, 60_000);
  }
});
