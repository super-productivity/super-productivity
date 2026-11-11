import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { filter, timeout } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import type {
  PluginAPI,
  PluginCreateSection,
  PluginSectionContext,
  PluginSectionSnapshot,
  PluginSectionTaskMove,
  PluginSectionUpdate,
} from '@super-productivity/plugin-api';
import { DataInitStateService } from '../core/data-init/data-init-state.service';
import { DateService } from '../core/date/date.service';
import { RootState } from '../root-store/root-state';
import { Section, SectionState } from '../features/section/section.model';
import * as actions from '../features/section/store/section.actions';
import { WorkContextType } from '../features/work-context/work-context.model';
import { selectTodayTaskIds } from '../features/work-context/store/work-context.selectors';
import { moveTaskInTodayList } from '../features/work-context/store/work-context-meta.actions';
import { moveItemAfterAnchor } from '../features/work-context/store/work-context-meta.helper';
import { pluginAssert } from './plugin-bridge-asserts';

type State = RootState & { section: SectionState };
export type PluginSectionBoundMethods = Pick<
  PluginAPI,
  | 'getSectionContext'
  | 'addSection'
  | 'updateSection'
  | 'deleteSection'
  | 'moveSection'
  | 'moveTaskToSection'
>;

/** Uses the same persistent actions as the UI; never writes a replacement task list. */
@Injectable({ providedIn: 'root' })
export class PluginBridgeSectionsService {
  private readonly _store = inject(Store<State>);
  private readonly _state = this._store.selectSignal((state) => state);
  private readonly _dataInit = inject(DataInitStateService);
  private readonly _date = inject(DateService);

  // Existing plugins need not instantiate the section bridge until they use it.
  static createBoundMethods(injector: Injector): PluginSectionBoundMethods {
    const service = (): PluginBridgeSectionsService =>
      injector.get(PluginBridgeSectionsService);
    return {
      getSectionContext: (context) => service().getSectionContext(context),
      addSection: (data) => service().addSection(data),
      updateSection: (id, changes) => service().updateSection(id, changes),
      deleteSection: (id) => service().deleteSection(id),
      moveSection: (id, after) => service().moveSection(id, after),
      moveTaskToSection: (move) => service().moveTaskToSection(move),
    };
  }

  private async _ready(): Promise<void> {
    await firstValueFrom(
      this._dataInit.isAllDataLoadedInitially$.pipe(
        filter(Boolean),
        timeout({ first: 10_000 }),
      ),
    );
  }

  private _context(section: Section): PluginSectionContext {
    if (section.contextType === WorkContextType.PROJECT)
      return { type: 'PROJECT', id: section.contextId };
    if (section.contextType === WorkContextType.TAG && section.contextId === 'TODAY')
      return { type: 'TODAY' };
    throw new Error('Unsupported section context');
  }

  private _section(state: State, id: string): Section | undefined {
    return Object.hasOwn(state.section.entities, id)
      ? state.section.entities[id]
      : undefined;
  }

  private _title(title: string): string {
    const value = title.trim();
    if (!value || value.length > 200)
      throw new Error('Section title must contain 1–200 characters');
    return value;
  }

  private _snapshot(state: State, context: PluginSectionContext): PluginSectionSnapshot {
    const contextId = context.type === 'TODAY' ? 'TODAY' : context.id;
    const contextType =
      context.type === 'TODAY' ? WorkContextType.TAG : WorkContextType.PROJECT;
    const project =
      context.type === 'PROJECT' && Object.hasOwn(state.projects.entities, context.id)
        ? state.projects.entities[context.id]
        : undefined;
    if (context.type === 'PROJECT' && (!project || project.isArchived))
      throw new Error('Active project not found');
    const taskIds = (project ? project.taskIds : selectTodayTaskIds(state)).filter(
      (id) =>
        !!state.tasks.entities[id] &&
        !state.tasks.entities[id]!.parentId &&
        (!project || state.tasks.entities[id]!.projectId === project.id),
    );
    const sections = state.section.ids.flatMap((id) => {
      const section = this._section(state, id);
      return section?.contextId === contextId && section.contextType === contextType
        ? [
            {
              id,
              title: section.title,
              isExpanded: section.isExpanded ?? true,
              taskIds: [...section.taskIds],
            },
          ]
        : [];
    });
    const placed = new Set(sections.flatMap((section) => section.taskIds));
    return {
      context: { ...context },
      sections,
      taskIds: [...taskIds],
      noSectionTaskIds: taskIds.filter((id) => !placed.has(id)),
      ...(context.type === 'TODAY'
        ? {
            day: {
              todayStr: this._date.todayStr(),
              startOfNextDayDiffMs: this._date.getStartOfNextDayDiffMs(),
            },
          }
        : {}),
    };
  }

  async getSectionContext(context: PluginSectionContext): Promise<PluginSectionSnapshot> {
    pluginAssert.sectionContext(context);
    await this._ready();
    return this._snapshot(this._state(), context);
  }

  async addSection(data: PluginCreateSection): Promise<string> {
    pluginAssert.createSection(data);
    const title = this._title(data.title);
    const id = data.id ?? nanoid();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || Object.hasOwn(Object.prototype, id))
      throw new Error('Invalid section ID');
    await this._ready();
    const state = this._state();
    const snapshot = this._snapshot(state, data.context);
    const existing = this._section(state, id);
    if (existing) {
      if (!snapshot.sections.some((section) => section.id === id))
        throw new Error('Section ID belongs to another context');
      return id;
    }
    this._store.dispatch(
      actions.addSection({
        section: {
          id,
          title,
          contextId: data.context.type === 'TODAY' ? 'TODAY' : data.context.id,
          contextType:
            data.context.type === 'TODAY' ? WorkContextType.TAG : WorkContextType.PROJECT,
          isExpanded: true,
          taskIds: [],
        },
      }),
    );
    return id;
  }

  async updateSection(id: string, changes: PluginSectionUpdate): Promise<void> {
    pluginAssert.string(id);
    pluginAssert.sectionUpdate(changes);
    const patch: PluginSectionUpdate = {};
    if (changes.title !== undefined) patch.title = this._title(changes.title);
    if (changes.isExpanded !== undefined) patch.isExpanded = changes.isExpanded;
    await this._ready();
    const state = this._state();
    const section = this._section(state, id);
    if (!section) throw new Error('Section not found');
    this._snapshot(state, this._context(section));
    if (patch.title === section.title) delete patch.title;
    if (patch.isExpanded === (section.isExpanded ?? true)) delete patch.isExpanded;
    if (Object.keys(patch).length)
      this._store.dispatch(actions.updateSection({ section: { id, changes: patch } }));
  }

  async deleteSection(id: string): Promise<void> {
    pluginAssert.string(id);
    await this._ready();
    const state = this._state();
    const section = this._section(state, id);
    if (!section) return;
    this._snapshot(state, this._context(section));
    this._store.dispatch(actions.deleteSection({ id }));
  }

  async moveSection(id: string, afterSectionId: string | null): Promise<void> {
    pluginAssert.string(id);
    pluginAssert.nullableString(afterSectionId);
    await this._ready();
    const state = this._state();
    const section = this._section(state, id);
    if (!section) throw new Error('Section not found');
    const snapshot = this._snapshot(state, this._context(section));
    const ids = snapshot.sections.map((entry) => entry.id);
    if (
      afterSectionId === id ||
      (afterSectionId !== null && !ids.includes(afterSectionId))
    )
      throw new Error('Invalid section anchor');
    const next = moveItemAfterAnchor(id, afterSectionId, ids);
    if (next.some((value, index) => value !== ids[index]))
      this._store.dispatch(
        actions.updateSectionOrder({ contextId: section.contextId, ids: next }),
      );
  }

  async moveTaskToSection(move: PluginSectionTaskMove): Promise<void> {
    pluginAssert.sectionTaskMove(move);
    await this._ready();
    const state = this._state();
    const snapshot = this._snapshot(state, move.context);
    const { taskId, sectionId, afterTaskId } = move;
    if (!snapshot.taskIds.includes(taskId))
      throw new Error('Task is not a top-level task in this context main list');
    const target = snapshot.sections.find((section) => section.id === sectionId);
    if (sectionId !== null && !target) throw new Error('Section not in this context');
    const targetIds = target?.taskIds ?? snapshot.noSectionTaskIds;
    if (
      afterTaskId === taskId ||
      (afterTaskId !== null &&
        (!targetIds.includes(afterTaskId) || !snapshot.taskIds.includes(afterTaskId)))
    )
      throw new Error('Invalid task anchor');
    const source = snapshot.sections.find((section) => section.taskIds.includes(taskId));
    const desired = moveItemAfterAnchor(taskId, afterTaskId, targetIds);
    if (
      (source?.id ?? null) === sectionId &&
      desired.length === targetIds.length &&
      desired.every((value, index) => value === targetIds[index])
    )
      return;
    const workContextId = move.context.type === 'TODAY' ? 'TODAY' : move.context.id;
    const workContextType =
      move.context.type === 'TODAY' ? WorkContextType.TAG : WorkContextType.PROJECT;
    if (target) {
      this._store.dispatch(
        actions.addTaskToSection({
          sectionId: target.id,
          taskId,
          afterTaskId,
          sourceSectionId: source?.id ?? null,
        }),
      );
    } else if (source) {
      this._store.dispatch(
        actions.removeTaskFromSection({
          sectionId: source.id,
          taskId,
          workContextId,
          workContextType,
          workContextAfterTaskId: afterTaskId,
        }),
      );
    } else {
      // UNDONE selects main-list ordering, without changing completion.
      // DONE would append for a null anchor rather than placing at the start.
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          afterTaskId,
          workContextId,
          workContextType,
          src: 'UNDONE',
          target: 'UNDONE',
        }),
      );
    }
  }
}
