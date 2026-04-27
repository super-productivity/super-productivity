import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { Section, SectionContextType } from './section.model';
import {
  addSection,
  addTaskToSection,
  deleteSection,
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

  addSection(title: string, contextId: string, contextType: SectionContextType): void {
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
    contextType: SectionContextType,
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
   * Atomic: places `taskId` into `sectionId` (or null = no section) at the
   * position implied by `afterTaskId`. Removes it from any other section
   * in the same reducer pass.
   */
  placeTaskInSection(
    sectionId: string | null,
    taskId: string,
    afterTaskId: string | null = null,
  ): void {
    this._store.dispatch(addTaskToSection({ sectionId, taskId, afterTaskId }));
  }
}
