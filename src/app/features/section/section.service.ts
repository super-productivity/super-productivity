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

const MAX_SECTION_TITLE_LENGTH = 200;

const sanitizeSectionTitle = (title: string): string =>
  title.trim().slice(0, MAX_SECTION_TITLE_LENGTH);

// Stable reference for contexts that have no sections — passing a
// fresh `[]` per emission would defeat OnPush in any consumer.
const EMPTY_SECTIONS: readonly Section[] = Object.freeze([]);

@Injectable({
  providedIn: 'root',
})
export class SectionService {
  private _store = inject(Store);

  getSectionsByContextId$(contextId: string): Observable<readonly Section[]> {
    return this._store
      .select(selectSectionsByContextIdMap)
      .pipe(map((m) => m.get(contextId) ?? EMPTY_SECTIONS));
  }

  /**
   * Dispatches `addSection` and returns the new id synchronously so
   * callers (e.g. markdown paste) can place tasks into the just-created
   * section without awaiting.
   */
  addSection(title: string, contextId: string, contextType: WorkContextType): string {
    const id = nanoid();
    this._store.dispatch(
      addSection({
        section: {
          id,
          contextId,
          contextType,
          title: sanitizeSectionTitle(title),
          taskIds: [],
        },
      }),
    );
    return id;
  }

  deleteSection(id: string): void {
    this._store.dispatch(deleteSection({ id }));
  }

  updateSection(id: string, sectionChanges: Partial<Section>): void {
    const changes =
      typeof sectionChanges.title === 'string'
        ? { ...sectionChanges, title: sanitizeSectionTitle(sectionChanges.title) }
        : sectionChanges;
    this._store.dispatch(updateSection({ section: { id, changes } }));
  }

  updateSectionOrder(contextId: string, ids: string[]): void {
    this._store.dispatch(updateSectionOrder({ contextId, ids }));
  }

  /**
   * Atomic: places `taskId` into `targetSectionId` at the position
   * implied by `afterTaskId`. `sourceSectionId` MUST reflect the task's
   * current section (or `null` if it isn't in one) so replay strips
   * from the explicit source rather than searching state.
   */
  addTaskToSection(
    targetSectionId: string,
    taskId: string,
    afterTaskId: string | null,
    sourceSectionId: string | null,
  ): void {
    this._store.dispatch(
      addTaskToSection({
        sectionId: targetSectionId,
        taskId,
        afterTaskId,
        sourceSectionId,
      }),
    );
  }

  /**
   * Removes `taskId` from `sourceSectionId`. Persisted as a single
   * Update keyed on the source — concurrent ungroups from different
   * sections do NOT collide.
   */
  removeTaskFromSection(sourceSectionId: string, taskId: string): void {
    this._store.dispatch(removeTaskFromSection({ sectionId: sourceSectionId, taskId }));
  }
}
