import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Section } from './section.model';
import { WorkContextType } from '../work-context/work-context.model';
import {
  addSection,
  addTaskToSection,
  deleteSection,
  removeTaskFromSection,
  updateSection,
  updateSectionOrder,
} from './store/section.actions';
import { selectSectionsByContextIdMap } from './store/section.selectors';

@Injectable({
  providedIn: 'root',
})
export class SectionService {
  private _store = inject(Store);

  getSectionsByContextId$(contextId: string): Observable<Section[]> {
    return this._store
      .select(selectSectionsByContextIdMap)
      .pipe(map((m) => m.get(contextId) ?? []));
  }

  /**
   * Dispatches `addSection` and returns the new id synchronously. Callers
   * that need the id (e.g. the markdown-paste flow that places tasks into
   * the just-created section) read it from the return value — store
   * dispatch is synchronous, so no async awaiting is needed.
   */
  addSection(title: string, contextId: string, contextType: WorkContextType): string {
    const id = nanoid();
    this._store.dispatch(
      addSection({
        section: { id, contextId, contextType, title, taskIds: [] },
      }),
    );
    return id;
  }

  deleteSection(id: string): void {
    this._store.dispatch(deleteSection({ id }));
  }

  updateSection(id: string, sectionChanges: Partial<Section>): void {
    this._store.dispatch(updateSection({ section: { id, changes: sectionChanges } }));
  }

  updateSectionOrder(contextId: string, ids: string[]): void {
    this._store.dispatch(updateSectionOrder({ contextId, ids }));
  }

  /**
   * Atomic: places `taskId` into `targetSectionId` at the position implied
   * by `afterTaskId`. Pass `sourceSectionId` (or `null` if the task wasn't
   * in a section) so replay is deterministic — the reducer strips from
   * the explicit source rather than searching state. Omit `sourceSectionId`
   * for legacy callers that don't track it; the reducer falls back to a
   * defensive sweep.
   */
  addTaskToSection(
    targetSectionId: string,
    taskId: string,
    afterTaskId: string | null = null,
    sourceSectionId?: string | null,
  ): void {
    this._store.dispatch(
      addTaskToSection({
        sectionId: targetSectionId,
        taskId,
        afterTaskId,
        ...(sourceSectionId !== undefined ? { sourceSectionId } : {}),
      }),
    );
  }

  /**
   * Removes `taskId` from `sourceSectionId`. Persisted as a single Update
   * keyed on the source — concurrent ungroups from different sections do
   * NOT collide (the prior `addTaskToSection({sectionId: null})` form
   * shared a sentinel entityId).
   */
  removeTaskFromSection(sourceSectionId: string, taskId: string): void {
    this._store.dispatch(removeTaskFromSection({ sectionId: sourceSectionId, taskId }));
  }
}
