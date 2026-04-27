import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
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
import { selectAllSections, selectSectionsByContextId } from './store/section.selectors';

@Injectable({
  providedIn: 'root',
})
export class SectionService {
  private _store = inject(Store);

  sections$: Observable<Section[]> = this._store.select(selectAllSections);

  getSectionsByContextId$(contextId: string): Observable<Section[]> {
    return this._store.select(selectSectionsByContextId(contextId));
  }

  addSection(title: string, contextId: string, contextType: WorkContextType): void {
    this._store.dispatch(
      addSection({
        section: {
          id: nanoid(),
          contextId,
          contextType,
          title,
          taskIds: [],
        },
      }),
    );
  }

  generateSectionId(): string {
    return nanoid();
  }

  addSectionWithId(
    id: string,
    title: string,
    contextId: string,
    contextType: WorkContextType,
  ): void {
    this._store.dispatch(
      addSection({
        section: { id, contextId, contextType, title, taskIds: [] },
      }),
    );
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
   * by `afterTaskId`. Removes the task from any other section in the same
   * reducer pass (uniqueness invariant).
   */
  addTaskToSection(
    targetSectionId: string,
    taskId: string,
    afterTaskId: string | null = null,
  ): void {
    this._store.dispatch(
      addTaskToSection({ sectionId: targetSectionId, taskId, afterTaskId }),
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
