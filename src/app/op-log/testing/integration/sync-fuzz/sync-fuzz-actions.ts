import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { ArchiveDbAdapter } from '../../../../core/persistence/archive-db-adapter.service';
import { ArchiveService } from '../../../../features/archive/archive.service';
import {
  addNote,
  deleteNote,
  updateNote,
  updateNoteOrder,
} from '../../../../features/note/store/note.actions';
import { Note } from '../../../../features/note/note.model';
import { Project } from '../../../../features/project/project.model';
import { EMPTY_SIMPLE_COUNTER } from '../../../../features/simple-counter/simple-counter.const';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../../../../features/simple-counter/simple-counter.model';
import {
  addSimpleCounter,
  increaseSimpleCounterCounterToday,
  setSimpleCounterCounterToday,
  updateSimpleCounter,
  updateSimpleCounterOrder,
} from '../../../../features/simple-counter/store/simple-counter.actions';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import {
  syncTimeSpent,
  syncTimeTracking,
  TimeTrackingActions,
} from '../../../../features/time-tracking/store/time-tracking.actions';
import { TimeTrackingState } from '../../../../features/time-tracking/time-tracking.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { BackupService } from '../../../backup/backup.service';
import { OperationLogSyncService } from '../../../sync/operation-log-sync.service';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { moveItemInArray } from '../../../../util/move-item-in-array';
import { SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * The fuzz action vocabulary. An intent names its target and value; the
 * payload is built from the acting device's CURRENT state, the way the UI
 * builds it, with the real action creators. A trace is a JSON list of steps,
 * so a minimized failure can be saved as a fixture and replayed; an intent
 * whose target is missing on that device (e.g. after shrinking) is skipped.
 */
export type Intent =
  | ['addTask', string, 'P' | 'T']
  | ['renameTask', string, string]
  | ['editTaskNotes', string, string]
  | ['doneTask', string, boolean]
  | ['track', string, number]
  | ['deleteTask', string]
  | ['archiveTask', string]
  | ['restoreTask', string]
  | ['addNote', string, 'P' | 'T']
  | ['editNote', string, 'content' | 'isPinnedToToday' | 'isLock', string | boolean]
  | ['reorderNotes', 'P' | 'T', number, number]
  | ['deleteNote', string]
  | ['addHabit', string]
  | ['editHabit', string, 'title' | 'isEnabled', string | boolean]
  | ['countHabit', string]
  | ['reorderHabits', number, number]
  // State replacements (REPLACEMENT_WEIGHTS only):
  | ['forceUpload']
  | ['exportBackup', string]
  | ['importBackup', string];

/**
 * One step: a device, an optional action, then optional events in this
 * order: sync (`s`), op-log compaction (`c`), restart from the device's
 * database (`r`). `k` answers the dialog the step's sync opens: the
 * SYNC_IMPORT conflict dialog, or the whole-dataset conflict dialog after a
 * multi-entity stop. Keep local data (`L`, USE_LOCAL) or use the remote data
 * (`R`, USE_REMOTE). Without `k` the SYNC_IMPORT dialog is cancelled and
 * fails the run, and a stop stays unanswered.
 *
 * `k` also has a trace-wide effect on a replay: a trace with any `k` (or a
 * replacement intent) models the dialog after a stop, so settle answers
 * every stop with USE_REMOTE (runFuzz's `modelsStopDialog`). Adding or
 * dropping the last `k` of a trace therefore changes how settle treats a
 * stop on any device.
 */
export interface FuzzStep {
  d: string;
  a?: Intent;
  s?: 1;
  c?: 1;
  r?: 1;
  k?: 'L' | 'R';
}

/** The intents that replace the whole dataset (full-state ops). */
export const REPLACEMENT_INTENTS: ReadonlySet<Intent[0]> = new Set([
  'forceUpload',
  'exportBackup',
  'importBackup',
]);

/** A value the step wrote, for the preservation oracles. */
export interface FuzzWrite {
  entity: string;
  field: string;
  value: unknown;
}

const INBOX = 'INBOX_PROJECT';

export interface DeviceView {
  tasks: Task[];
  notes: Note[];
  projectNoteIds: string[];
  todayNoteIds: string[];
  habits: SimpleCounter[];
  timeTracking: TimeTrackingState;
}

interface EntityStateLike<T> {
  ids: string[];
  entities: Record<string, T | undefined>;
}

const listOf = <T>(state: EntityStateLike<T>): T[] =>
  state.ids.map((id) => state.entities[id]).filter((e): e is T => !!e);

export const viewOf = (root: Record<string, unknown>): DeviceView => {
  const note = root['note'] as EntityStateLike<Note> & { todayOrder: string[] };
  const projects = root['projects'] as EntityStateLike<Project>;
  return {
    tasks: listOf(root['tasks'] as EntityStateLike<Task>),
    notes: listOf(note),
    projectNoteIds: projects.entities[INBOX]?.noteIds ?? [],
    todayNoteIds: note.todayOrder,
    habits: listOf(root['simpleCounter'] as EntityStateLike<SimpleCounter>),
    timeTracking: root['timeTracking'] as TimeTrackingState,
  };
};

/** The logical "today" of the run, from the harness clock. */
export const fuzzDay = (): string => getDbDateStr(Date.now());

const newTask = (id: string): Task => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  projectId: INBOX,
  created: Date.now(),
});

const noteList = (view: DeviceView, ctx: 'P' | 'T'): string[] =>
  ctx === 'P' ? view.projectNoteIds : view.todayNoteIds;

const enabledHabitIds = (view: DeviceView): string[] =>
  view.habits.filter((h) => h.isEnabled).map((h) => h.id);

/**
 * Whether the UI offers the intent in this device state:
 * - note.component.html shows the pin toggle for project notes only;
 * - only enabled habits show a counter button;
 * - the sync settings offer "Force overwrite" (forceUpload) and the
 *   import/export page offers backup export and import in every state; an
 *   import needs the exported file, which executeIntent checks.
 * Other intents are always offered while their target exists.
 */
export const isUiPossible = (intent: Intent, view: DeviceView): boolean => {
  if (REPLACEMENT_INTENTS.has(intent[0])) return true;
  if (intent[0] === 'editNote' && intent[2] === 'isPinnedToToday') {
    return !!view.notes.find((n) => n.id === intent[1])?.projectId;
  }
  if (intent[0] === 'countHabit') {
    return !!view.habits.find((h) => h.id === intent[1])?.isEnabled;
  }
  return true;
};

/**
 * Dispatches the intent on the current device. Returns the values written, or
 * undefined when the intent does not apply to this device's state, including
 * when the UI would not offer it there.
 */
export const executeIntent = async (
  harness: SyncFuzzHarness,
  intent: Intent,
): Promise<FuzzWrite[] | undefined> => {
  const view = viewOf(await harness.state());
  if (!isUiPossible(intent, view)) return undefined;
  const task = (id: string): Task | undefined => view.tasks.find((t) => t.id === id);
  const note = (id: string): Note | undefined => view.notes.find((n) => n.id === id);
  const habit = (id: string): SimpleCounter | undefined =>
    view.habits.find((h) => h.id === id);
  const run = async (...actions: Action[]): Promise<void> => {
    for (const action of actions) await harness.dispatch(action);
  };
  const day = fuzzDay();

  switch (intent[0]) {
    case 'addTask': {
      // Added in the project view, or in Today, which schedules it for today.
      const [, id, ctx] = intent;
      if (task(id)) return undefined;
      await run(
        TaskSharedActions.addTask({
          task: { ...newTask(id), ...(ctx === 'T' ? { dueDay: day } : {}) },
          workContextId: ctx === 'T' ? 'TODAY' : INBOX,
          workContextType: ctx === 'T' ? WorkContextType.TAG : WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );
      return [];
    }
    case 'renameTask': {
      const [, id, title] = intent;
      if (!task(id)) return undefined;
      await run(TaskSharedActions.updateTask({ task: { id, changes: { title } } }));
      return [{ entity: `task:${id}`, field: 'title', value: title }];
    }
    case 'editTaskNotes': {
      // The task detail notes editor: TaskService.update(id, { notes }).
      const [, id, notes] = intent;
      if (!task(id)) return undefined;
      await run(TaskSharedActions.updateTask({ task: { id, changes: { notes } } }));
      return [{ entity: `task:${id}`, field: 'notes', value: notes }];
    }
    case 'doneTask': {
      const [, id, isDone] = intent;
      if (!task(id)) return undefined;
      await run(
        TaskSharedActions.updateTask({
          task: { id, changes: isDone ? { isDone, doneOn: Date.now() } : { isDone } },
        }),
      );
      return [{ entity: `task:${id}`, field: 'isDone', value: isDone }];
    }
    case 'track': {
      const [, id, duration] = intent;
      const t = task(id);
      if (!t) return undefined;
      // Starting and tracking a task, as the app does it:
      // - setCurrentTask reopens a done task: TaskInternalEffects
      //   .reopenStartedDoneTask$ emits this updateTask as its own op, before
      //   any tick (#9904);
      // - it also plans an unscheduled task for today
      //   (planStartedTaskForToday$, on by default via
      //   isAutoAddWorkedOnToToday). Its Today-membership and parent checks
      //   never skip a task here: membership comes from dueDay/dueWithTime,
      //   and there are no subtasks. The tick's autoAddTodayTagOnTracking
      //   then finds the task planned;
      // - TaskService's tick and _flushAccumulatedTimeSpent: the local add
      //   (not an op, so its place in the batch changes no op), then the
      //   persistent task delta and the touched contexts' session data.
      // run() dispatches one action at a time, so each is its own op.
      if (t.isDone) {
        await run(
          TaskSharedActions.updateTask({ task: { id, changes: { isDone: false } } }),
        );
      }
      await run(
        TimeTrackingActions.addTimeSpent({
          task: t,
          date: day,
          duration,
          isFromTrackingReminder: false,
        }),
        ...(!t.dueDay && typeof t.dueWithTime !== 'number'
          ? [
              TaskSharedActions.planTasksForToday({
                taskIds: [id],
                today: day,
                startOfNextDayDiffMs: 0,
              }),
            ]
          : []),
        syncTimeSpent({ taskId: id, date: day, duration }),
      );
      const tracked = viewOf(await harness.state()).timeTracking;
      const contexts: ['PROJECT' | 'TAG', string][] = [
        ['PROJECT', t.projectId],
        ...['TODAY', ...t.tagIds].map((tagId): ['TAG', string] => ['TAG', tagId]),
      ];
      for (const [contextType, contextId] of contexts) {
        const data = (contextType === 'TAG' ? tracked.tag : tracked.project)[contextId]?.[
          day
        ];
        if (data) {
          await run(syncTimeTracking({ contextType, contextId, date: day, data }));
        }
      }
      return t.isDone ? [{ entity: `task:${id}`, field: 'isDone', value: false }] : [];
    }
    case 'deleteTask': {
      const [, id] = intent;
      const t = task(id);
      if (!t || t.parentId) return undefined;
      await run(TaskSharedActions.deleteTask({ task: { ...t, subTasks: [] } }));
      return [];
    }
    case 'archiveTask': {
      const [, id] = intent;
      const t = task(id);
      if (!t || !t.isDone || t.parentId) return undefined;
      // TaskService.moveToArchive: persist to the archive first (the local
      // ArchiveOperationHandler skips moveToArchive), then dispatch.
      const tasks = [{ ...t, subTasks: [] }];
      await TestBed.inject(ArchiveService).moveTasksToArchiveAndFlushArchiveIfDue(tasks);
      await run(TaskSharedActions.moveToArchive({ tasks }));
      return [];
    }
    case 'restoreTask': {
      const [, id] = intent;
      if (task(id)) return undefined;
      const archive = await TestBed.inject(ArchiveDbAdapter).loadArchiveYoung();
      const archived = archive?.task.entities[id];
      if (!archived) return undefined;
      // handleRestoreTask (task-shared-lifecycle.reducer.ts) restores it undone.
      await run(TaskSharedActions.restoreTask({ task: archived, subTasks: [] }));
      return [{ entity: `task:${id}`, field: 'isDone', value: false }];
    }
    case 'addNote': {
      const [, id, ctx] = intent;
      if (note(id)) return undefined;
      await run(
        addNote({
          note: {
            id,
            projectId: ctx === 'P' ? INBOX : null,
            isPinnedToToday: ctx === 'T',
            content: id,
            created: Date.now(),
            modified: Date.now(),
          },
        }),
      );
      return [];
    }
    case 'editNote': {
      const [, id, field, value] = intent;
      if (!note(id)) return undefined;
      await run(updateNote({ note: { id, changes: { [field]: value } } }));
      return [{ entity: `note:${id}`, field, value }];
    }
    case 'reorderNotes': {
      const [, ctx, from, to] = intent;
      const ids = noteList(view, ctx);
      if (ids.length < 2 || from % ids.length === to % ids.length) return undefined;
      await run(
        updateNoteOrder({
          ids: moveItemInArray(ids, from % ids.length, to % ids.length),
          activeContextType: ctx === 'P' ? WorkContextType.PROJECT : WorkContextType.TAG,
          activeContextId: ctx === 'P' ? INBOX : 'TODAY',
        }),
      );
      return [];
    }
    case 'deleteNote': {
      const [, id] = intent;
      const n = note(id);
      if (!n) return undefined;
      await run(
        deleteNote({ id, projectId: n.projectId, isPinnedToToday: n.isPinnedToToday }),
      );
      return [];
    }
    case 'addHabit': {
      const [, id] = intent;
      if (habit(id)) return undefined;
      await run(
        addSimpleCounter({
          simpleCounter: {
            ...EMPTY_SIMPLE_COUNTER,
            id,
            title: id,
            isEnabled: true,
            type: SimpleCounterType.ClickCounter,
          },
        }),
      );
      return [];
    }
    case 'editHabit': {
      const [, id, field, value] = intent;
      if (!habit(id)) return undefined;
      await run(
        updateSimpleCounter({ simpleCounter: { id, changes: { [field]: value } } }),
      );
      return [{ entity: `habit:${id}`, field, value }];
    }
    case 'countHabit': {
      const [, id] = intent;
      const h = habit(id);
      if (!h) return undefined;
      const newVal = (h.countOnDay[day] ?? 0) + 1;
      await run(
        increaseSimpleCounterCounterToday({ id, increaseBy: 1, today: day }),
        setSimpleCounterCounterToday({ id, newVal, today: day }),
      );
      return [{ entity: `habit:${id}`, field: `countOnDay.${day}`, value: newVal }];
    }
    case 'reorderHabits': {
      const [, from, to] = intent;
      const ids = enabledHabitIds(view);
      if (ids.length < 2 || from % ids.length === to % ids.length) return undefined;
      await run(
        updateSimpleCounterOrder({
          ids: moveItemInArray(ids, from % ids.length, to % ids.length),
        }),
      );
      return [];
    }
    case 'forceUpload': {
      // SyncWrapperService.forceUpload, once its confirm() is accepted: a
      // clean-slate SYNC_IMPORT (FORCE_UPLOAD) of this device's state. Its
      // runWithSyncBlocked and sync-cycle guard are left out: the harness
      // never runs two syncs at once.
      const device = harness.current!;
      try {
        await TestBed.inject(OperationLogSyncService).forceUploadLocalState(
          device.client,
        );
      } catch (e) {
        harness.record(device, 'sync-error', `forceUpload ${(e as Error)?.name}`);
      }
      return [];
    }
    case 'exportBackup': {
      // FileImexComponent.downloadBackup: the complete backup, as a file.
      const [, label] = intent;
      const data = await TestBed.inject(BackupService).loadCompleteBackup(true);
      harness.backups.set(label, JSON.parse(JSON.stringify(data)) as typeof data);
      return [];
    }
    case 'importBackup': {
      // FileImexComponent's import: BackupService.importCompleteBackup, a
      // BACKUP_IMPORT with a new client id, uploaded as a clean slate at the
      // next sync. The import clears the SuperSync cursors in localStorage
      // (_resetAllLastServerSeqs); the fake client keeps its cursor in memory.
      // Its encryption check has nothing to do: the fuzz never encrypts.
      const [, label] = intent;
      const backup = harness.backups.get(label);
      const device = harness.current!;
      if (!backup) return undefined;
      await harness.withSeededRandom(`${device.name}:${label}:${harness.step}`, () =>
        TestBed.inject(BackupService).importCompleteBackup(
          structuredClone(backup),
          false,
          true,
          true,
        ),
      );
      await device.client.setLastServerSeq(0);
      return [];
    }
  }
};

type Random = () => number;

export type IntentWeights = [Intent[0], number][];

export const DEFAULT_WEIGHTS: IntentWeights = [
  ['renameTask', 3],
  ['editTaskNotes', 2],
  ['track', 4],
  ['doneTask', 1],
  ['addTask', 1],
  ['deleteTask', 0.5],
  ['archiveTask', 1],
  ['restoreTask', 0.5],
  ['editNote', 4],
  ['reorderNotes', 3],
  ['addNote', 1],
  ['deleteNote', 0.5],
  ['editHabit', 2],
  ['countHabit', 2],
  ['reorderHabits', 3],
  ['addHabit', 0.5],
];

/**
 * DEFAULT_WEIGHTS plus the state replacements the UI offers. A separate mix,
 * so seeds of the default mix keep their traces (#10382's numbers).
 */
export const REPLACEMENT_WEIGHTS: IntentWeights = [
  ...DEFAULT_WEIGHTS,
  ['forceUpload', 0.5],
  ['exportBackup', 0.5],
  ['importBackup', 0.5],
];

/** Picks an intent that applies to this device's state (up to a few tries). */
export const generateIntent = (
  random: Random,
  view: DeviceView,
  archivedTaskIds: readonly string[],
  label: string,
  nextId: (prefix: string) => string,
  weights: IntentWeights = DEFAULT_WEIGHTS,
  backupLabels: readonly string[] = [],
): Intent | undefined => {
  const pick = <T>(items: readonly T[]): T | undefined =>
    items.length ? items[Math.floor(random() * items.length)] : undefined;
  const index = (): number => Math.floor(random() * 8);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  for (let attempt = 0; attempt < 5; attempt++) {
    let roll = random() * total;
    const kind = weights.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'track';
    const t = pick(view.tasks);
    const n = pick(view.notes);
    const h = pick(view.habits);
    switch (kind) {
      case 'addTask':
        return ['addTask', nextId('t'), random() < 0.5 ? 'P' : 'T'];
      case 'renameTask':
        if (t) return ['renameTask', t.id, label];
        break;
      case 'editTaskNotes':
        if (t) return ['editTaskNotes', t.id, label];
        break;
      case 'doneTask':
        if (t) return ['doneTask', t.id, !t.isDone];
        break;
      case 'track':
        if (t) return ['track', t.id, 1000 * (1 + Math.floor(random() * 5))];
        break;
      case 'deleteTask':
        if (t) return ['deleteTask', t.id];
        break;
      case 'archiveTask': {
        const done = pick(view.tasks.filter((x) => x.isDone));
        if (done) return ['archiveTask', done.id];
        break;
      }
      case 'restoreTask': {
        const archived = pick(archivedTaskIds);
        if (archived) return ['restoreTask', archived];
        break;
      }
      case 'addNote':
        return ['addNote', nextId('n'), random() < 0.5 ? 'P' : 'T'];
      case 'editNote':
        if (n) {
          const field = pick(
            n.projectId
              ? (['content', 'isPinnedToToday', 'isLock'] as const)
              : (['content', 'isLock'] as const),
          )!;
          return ['editNote', n.id, field, field === 'content' ? label : !n[field]];
        }
        break;
      case 'reorderNotes':
        return ['reorderNotes', random() < 0.6 ? 'P' : 'T', index(), index()];
      case 'deleteNote':
        if (n) return ['deleteNote', n.id];
        break;
      case 'addHabit':
        return ['addHabit', nextId('h')];
      case 'editHabit':
        if (h) {
          return random() < 0.5
            ? ['editHabit', h.id, 'title', label]
            : ['editHabit', h.id, 'isEnabled', !h.isEnabled];
        }
        break;
      case 'countHabit': {
        const enabled = pick(view.habits.filter((x) => x.isEnabled));
        if (enabled) return ['countHabit', enabled.id];
        break;
      }
      case 'reorderHabits':
        return ['reorderHabits', index(), index()];
      case 'forceUpload':
        return ['forceUpload'];
      case 'exportBackup':
        return ['exportBackup', nextId('b')];
      case 'importBackup': {
        const backup = pick(backupLabels);
        if (backup) return ['importBackup', backup];
        break;
      }
    }
  }
  return undefined;
};

/** Entities device A creates before the others join. */
export const SETUP_INTENTS: Intent[] = [
  ['addTask', 't1', 'T'],
  ['addTask', 't2', 'T'],
  ['addTask', 't3', 'P'],
  ['addNote', 'n1', 'P'],
  ['addNote', 'n2', 'P'],
  ['addNote', 'n3', 'T'],
  ['addHabit', 'h1'],
  ['addHabit', 'h2'],
  ['addHabit', 'h3'],
];
