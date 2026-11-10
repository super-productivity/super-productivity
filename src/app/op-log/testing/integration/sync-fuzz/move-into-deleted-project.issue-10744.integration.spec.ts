import {
  addNote,
  moveNoteToOtherProject,
} from '../../../../features/note/store/note.actions';
import { Note } from '../../../../features/note/note.model';
import { DEFAULT_PROJECT } from '../../../../features/project/project.const';
import { Project } from '../../../../features/project/project.model';
import { addProject } from '../../../../features/project/store/project.actions';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * #10744: device A deletes a project while device B, before either syncs,
 * moves a note or a task into it. Neither op declares the other's entity, so
 * no conflict is detected and each device applies the other's op on its own.
 * The moved item must survive in the Inbox, identically on both devices, in
 * both sync orders and after a restart.
 */
const INBOX = 'INBOX_PROJECT';
const DOOMED = 'doomed';
const KEPT = 'kept';
type Kind = 'note' | 'task';
const KINDS: Kind[] = ['note'];

interface ItemView {
  item?: { projectId?: string | null; content: string };
  listedIn: string[];
  projectIds: string[];
  inbox: string[];
}

describe('item moved into a concurrently deleted project (#10744)', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const slices = async (): Promise<{
    projects: { ids: string[]; entities: Record<string, Project> };
    tasks: { entities: Record<string, Task> };
    note: { entities: Record<string, Note> };
  }> => (await harness.state()) as never;

  const view = (device: FuzzDevice, kind: Kind): Promise<ItemView> =>
    harness.as(device, async () => {
      const { projects, tasks, note } = await slices();
      const list = (p: Project): string[] => (kind === 'note' ? p.noteIds : p.taskIds);
      const moved = kind === 'note' ? note.entities['moved'] : tasks.entities['moved'];
      return {
        item: moved && {
          projectId: moved.projectId,
          content: kind === 'note' ? (moved as Note).content : (moved as Task).title,
        },
        listedIn: projects.ids.filter((id) =>
          list(projects.entities[id]).includes('moved'),
        ),
        projectIds: projects.ids,
        inbox: list(projects.entities[INBOX]),
      };
    });

  const addItem = (kind: Kind, id: string): Promise<void> =>
    harness.dispatch(
      kind === 'note'
        ? addNote({
            note: {
              id,
              projectId: INBOX,
              isPinnedToToday: false,
              content: `content of ${id}`,
              created: Date.now(),
              modified: Date.now(),
            },
          })
        : TaskSharedActions.addTask({
            task: {
              ...DEFAULT_TASK,
              id,
              title: `content of ${id}`,
              projectId: INBOX,
              created: Date.now(),
            },
            workContextId: INBOX,
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: true,
          }),
    );

  // The payloads ProjectService.remove and the move menus build from live state.
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

  const moveTo = async (kind: Kind, targetProjectId: string): Promise<void> => {
    const { tasks, note } = await slices();
    await harness.dispatch(
      kind === 'note'
        ? moveNoteToOtherProject({
            note: note.entities['moved'],
            targetProjectId,
          })
        : TaskSharedActions.moveToOtherProject({
            task: { ...tasks.entities['moved'], subTasks: [] },
            targetProjectId,
          }),
    );
  };

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  const seed = async (kind: Kind, projectIds: string[]): Promise<void> => {
    await harness.as(a, async () => {
      for (const id of projectIds) {
        await harness.dispatch(
          addProject({ project: { ...DEFAULT_PROJECT, id, title: id } }),
        );
      }
      // Notes are prepended, tasks appended: either way the Inbox lists the
      // moved item first, so a re-homed one visibly changes place.
      for (const id of kind === 'note' ? ['sibling', 'moved'] : ['moved', 'sibling']) {
        await addItem(kind, id);
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
    const order = first === 'deleter' ? [a, b] : [b, a];
    for (let round = 0; round < 3; round++) {
      for (const device of order) {
        expect(await harness.sync(device)).toBe(true);
      }
    }
    expect(harness.events).toEqual([]);
  };

  const expectOnBothAndAfterRestart = async (
    kind: Kind,
    expected: ItemView,
  ): Promise<void> => {
    expect({ A: await view(a, kind), B: await view(b, kind) }).toEqual({
      A: expected,
      B: expected,
    });
    for (const device of [a, b]) {
      await harness.restart(device);
      expect(await view(device, kind)).toEqual(expected);
    }
  };

  for (const first of ['deleter', 'mover'] as const) {
    for (const kind of KINDS) {
      it(`keeps a moved ${kind} in the Inbox on both devices / ${first} syncs first`, async () => {
        await seed(kind, [DOOMED]);
        await crossAndSync(first, () => moveTo(kind, DOOMED));
        await expectOnBothAndAfterRestart(kind, {
          item: { projectId: INBOX, content: 'content of moved' },
          listedIn: [INBOX],
          projectIds: [INBOX],
          inbox: ['sibling', 'moved'],
        });
      }, 60_000);
    }

    it(`follows a note moved on from the deleted project / ${first} syncs first`, async () => {
      await seed('note', [DOOMED, KEPT]);
      await crossAndSync(first, async () => {
        await moveTo('note', DOOMED);
        harness.tick();
        await moveTo('note', KEPT);
      });
      await expectOnBothAndAfterRestart('note', {
        item: { projectId: KEPT, content: 'content of moved' },
        listedIn: [KEPT],
        projectIds: [INBOX, KEPT],
        inbox: ['sibling'],
      });
    }, 60_000);
  }
});
