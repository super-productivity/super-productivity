import { TestBed } from '@angular/core/testing';
import { ActionReducer, ActionReducerMap, provideStore, Store } from '@ngrx/store';
import { ReplaySubject } from 'rxjs';
import type { PluginSectionContext } from '@super-productivity/plugin-api';
import { PluginBridgeSectionsService } from './plugin-bridge-sections.service';
import { DataInitStateService } from '../core/data-init/data-init-state.service';
import { DateService } from '../core/date/date.service';
import { RootState } from '../root-store/root-state';
import { SectionState } from '../features/section/section.model';
import { sectionReducer } from '../features/section/store/section.reducer';
import { projectReducer } from '../features/project/store/project.reducer';
import { tagReducer } from '../features/tag/store/tag.reducer';
import { sectionSharedMetaReducer } from '../root-store/meta/task-shared-meta-reducers/section-shared.reducer';
import { createStateWithExistingTasks } from '../root-store/meta/task-shared-meta-reducers/test-utils';
import { appStateFeatureKey } from '../root-store/app-state/app-state.reducer';

type State = RootState & { section: SectionState };
const context: PluginSectionContext = { type: 'PROJECT', id: 'project1' };

describe('PluginBridgeSectionsService with real section and context reducers', () => {
  let service: PluginBridgeSectionsService;
  let store: Store<State>;
  let ready: ReplaySubject<boolean>;

  beforeEach(() => {
    const initial: State = {
      ...createStateWithExistingTasks(['a', 'b', 'c', 'd'], ['backlog']),
      section: { ids: [], entities: {} },
    };
    initial[appStateFeatureKey] = {
      todayStr: '2026-11-06',
      startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
    };
    initial.tasks.entities.a = { ...initial.tasks.entities.a!, dueDay: '2026-11-06' };
    initial.tasks.entities.b = { ...initial.tasks.entities.b!, dueDay: '2026-11-07' };
    initial.tasks.entities.d = { ...initial.tasks.entities.d!, isDone: true };
    const meta = sectionSharedMetaReducer((root, action) => {
      const state = (root ?? initial) as State;
      return {
        ...state,
        section: sectionReducer(state.section, action),
        projects: projectReducer(state.projects, action),
        tag: tagReducer(state.tag, action),
      };
    });
    const reduce: ActionReducer<State> = (state, action) => meta(state, action) as State;
    ready = new ReplaySubject<boolean>(1);
    ready.next(true);
    TestBed.configureTestingModule({
      providers: [
        provideStore({} as ActionReducerMap<State>, {
          initialState: initial,
          reducerFactory: () => reduce,
        }),
        { provide: DataInitStateService, useValue: { isAllDataLoadedInitially$: ready } },
        {
          provide: DateService,
          useValue: {
            todayStr: () => '2026-11-06',
            getStartOfNextDayDiffMs: () => 4 * 60 * 60 * 1000,
          },
        },
      ],
    });
    store = TestBed.inject(Store);
    service = TestBed.inject(PluginBridgeSectionsService);
  });

  const add = async (
    id: string,
    target: PluginSectionContext = context,
  ): Promise<string> => {
    return service.addSection({ id, context: target, title: ` ${id} ` });
  };

  it('creates empty sections in order and returns independent copies', async () => {
    await add('first');
    await add('second');
    const snapshot = await service.getSectionContext(context);
    expect(snapshot.sections.map((s) => s.id)).toEqual(['first', 'second']);
    expect(snapshot.sections[0].title).toBe('first');
    expect(snapshot.noSectionTaskIds).toEqual(['a', 'b', 'c', 'd']);
    snapshot.sections[0].title = 'mutated';
    snapshot.sections[0].taskIds.push('a');
    snapshot.taskIds.pop();
    const fresh = await service.getSectionContext(context);
    expect(fresh.sections[0]).toEqual({
      id: 'first',
      title: 'first',
      isExpanded: true,
      taskIds: [],
    });
    expect(fresh.taskIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('retries stable creation without overwriting a rename or producing an op', async () => {
    await add('stable');
    await service.updateSection('stable', { title: 'Renamed' });
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    expect(await add('stable')).toBe('stable');
    expect(dispatch).not.toHaveBeenCalled();
    expect((await service.getSectionContext(context)).sections[0].title).toBe('Renamed');
    await expectAsync(add('stable', { type: 'TODAY' })).toBeRejected();
  });

  it('moves a single task atomically without replacing other tasks or contexts', async () => {
    await add('first');
    await add('second');
    await add('today', { type: 'TODAY' });
    for (const [taskId, afterTaskId] of [
      ['a', null],
      ['b', 'a'],
    ] as const)
      await service.moveTaskToSection({
        context,
        taskId,
        sectionId: 'first',
        afterTaskId,
      });
    await service.moveTaskToSection({
      context: { type: 'TODAY' },
      taskId: 'a',
      sectionId: 'today',
      afterTaskId: null,
    });
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    await service.moveTaskToSection({
      context,
      taskId: 'a',
      sectionId: 'second',
      afterTaskId: null,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(
      (await service.getSectionContext(context)).sections.map((s) => s.taskIds),
    ).toEqual([['b'], ['a']]);
    expect(
      (await service.getSectionContext({ type: 'TODAY' })).sections[0].taskIds,
    ).toEqual(['a']);
    dispatch.calls.reset();
    await service.moveTaskToSection({
      context,
      taskId: 'a',
      sectionId: 'second',
      afterTaskId: null,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes into the requested no-section slot in one persistent operation', async () => {
    await add('first');
    await service.moveTaskToSection({
      context,
      taskId: 'a',
      sectionId: 'first',
      afterTaskId: null,
    });
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    await service.moveTaskToSection({
      context,
      taskId: 'a',
      sectionId: null,
      afterTaskId: 'c',
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const snapshot = await service.getSectionContext(context);
    expect(snapshot.sections[0].taskIds).toEqual([]);
    expect(snapshot.noSectionTaskIds).toEqual(['b', 'c', 'a', 'd']);
  });

  it('honors a null anchor for an already unsectioned completed task', async () => {
    await service.moveTaskToSection({
      context,
      taskId: 'd',
      sectionId: null,
      afterTaskId: null,
    });
    expect((await service.getSectionContext(context)).noSectionTaskIds).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(store.selectSignal((state) => state.tasks.entities.d)()!.isDone).toBeTrue();
  });

  it('reorders sections without moving another context and skips identical retries', async () => {
    await add('first');
    await add('today', { type: 'TODAY' });
    await add('second');
    await service.moveSection('second', null);
    expect((await service.getSectionContext(context)).sections.map((s) => s.id)).toEqual([
      'second',
      'first',
    ]);
    expect(store.selectSignal((state) => state.section.ids)()).toEqual([
      'second',
      'today',
      'first',
    ]);
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    await service.moveSection('second', null);
    await service.updateSection('second', { title: 'second', isExpanded: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('deletes a section without deleting or unscheduling tasks', async () => {
    await add('first');
    await service.moveTaskToSection({
      context,
      taskId: 'a',
      sectionId: 'first',
      afterTaskId: null,
    });
    await service.deleteSection('first');
    const snapshot = await service.getSectionContext(context);
    expect(snapshot.sections).toEqual([]);
    expect(snapshot.noSectionTaskIds).toContain('a');
    expect(store.selectSignal((state) => state.tasks.entities.a)()!.dueDay).toBe(
      '2026-11-06',
    );
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    await service.deleteSection('first');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reads virtual Today without switching views and rejects unscheduled placement', async () => {
    const snapshot = await service.getSectionContext({ type: 'TODAY' });
    expect(snapshot.taskIds).toEqual(['a']);
    expect(snapshot.day).toEqual({
      todayStr: '2026-11-06',
      startOfNextDayDiffMs: 14400000,
    });
    await add('today', { type: 'TODAY' });
    await expectAsync(
      service.moveTaskToSection({
        context: { type: 'TODAY' },
        taskId: 'b',
        sectionId: 'today',
        afterTaskId: null,
      }),
    ).toBeRejected();
    expect(store.selectSignal((state) => state.tasks.entities.b)()!.dueDay).toBe(
      '2026-11-07',
    );
  });

  it('rejects wrong contexts, backlog tasks, bad anchors and invalid titles without writes', async () => {
    await add('first');
    await add('today', { type: 'TODAY' });
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    for (const id of ['missing', 'backlog'])
      await expectAsync(
        service.moveTaskToSection({
          context,
          taskId: id,
          sectionId: 'first',
          afterTaskId: null,
        }),
      ).toBeRejected();
    await expectAsync(
      service.moveTaskToSection({
        context,
        taskId: 'a',
        sectionId: 'today',
        afterTaskId: null,
      }),
    ).toBeRejected();
    await expectAsync(
      service.moveTaskToSection({
        context,
        taskId: 'a',
        sectionId: 'first',
        afterTaskId: 'b',
      }),
    ).toBeRejected();
    await expectAsync(service.moveSection('first', 'today')).toBeRejected();
    await expectAsync(service.moveSection('first', 'first')).toBeRejected();
    for (const title of [' ', 'x'.repeat(201)])
      await expectAsync(service.updateSection('first', { title })).toBeRejected();
    await expectAsync(
      service.getSectionContext({ type: 'PROJECT', id: 'unknown' }),
    ).toBeRejected();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('waits for hydration instead of interpreting an unloaded catalogue as empty', async () => {
    ready.next(false);
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    const pending = add('first');
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    ready.next(true);
    await pending;
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
