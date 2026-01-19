import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { Section } from './section.model';
import { addSection, deleteSection, updateSection, updateSectionOrder } from './store/section.actions';
import { selectAllSections, selectSectionsByProjectId } from './store/section.selectors';

@Injectable({
    providedIn: 'root',
})
export class SectionService {
    private _store = inject(Store);

    // Expose selectors
    sections$: Observable<Section[]> = this._store.select(selectAllSections);

    getSectionsByProjectId$(projectId: string): Observable<Section[]> {
        return this._store.select(selectSectionsByProjectId(projectId));
    }

    addSection(title: string, projectId: string | null = null): void {
        const id = nanoid();
        this._store.dispatch(addSection({
            section: {
                id,
                title,
                projectId,
            }
        }));
    }

    deleteSection(id: string): void {
        this._store.dispatch(deleteSection({ id }));
    }

    updateSection(id: string, sectionChanges: Partial<Section>): void {
        this._store.dispatch(updateSection({
            section: {
                id,
                changes: sectionChanges,
            }
        }));
    }

    updateSectionOrder(ids: string[]): void {
        this._store.dispatch(updateSectionOrder({ ids }));
    }
}
