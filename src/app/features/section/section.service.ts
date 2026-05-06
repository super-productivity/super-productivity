import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Section } from './section.model';
import { isValidSectionContext, sanitizeSectionTitle } from './section.util';
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
   * Sections are only valid for projects and the singleton TODAY tag;
   * other tags are silently rejected. Returns the new id synchronously
   * so callers can wire tasks into the just-created section without
   * awaiting.
   */
  addSection(
    title: string,
    contextId: string,
    contextType: WorkContextType,
  ): string | null {
    if (!isValidSectionContext(contextId, contextType)) return null;
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

  updateSection(id: string, changes: Partial<Section>): void {
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
   * Atomic: strips `taskId` from `sourceSectionId` AND repositions it in
   * the work-context's `taskIds` so the task lands at the dropped slot
   * in the no-section bucket. Single op, both stores updated by the
   * section-shared meta-reducer.
   */
  removeTaskFromSection(
    sourceSectionId: string,
    taskId: string,
    workContextId: string,
    workContextType: WorkContextType,
    workContextAfterTaskId: string | null,
  ): void {
    this._store.dispatch(
      removeTaskFromSection({
        sectionId: sourceSectionId,
        taskId,
        workContextId,
        workContextType,
        workContextAfterTaskId,
      }),
    );
  }
}
