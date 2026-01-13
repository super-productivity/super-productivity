import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Note, NoteState } from './note.model';
import { select, Store } from '@ngrx/store';
import {
  addNote,
  deleteNote,
  moveNoteToOtherProject,
  updateNote,
  updateNoteOrder,
} from './store/note.actions';
import { nanoid } from 'nanoid';
import {
  selectAllNotes,
  selectNoteById,
  selectNoteFeatureState,
} from './store/note.reducer';
import { take } from 'rxjs/operators';
import { createFromDrop } from '../../core/drop-paste-input/drop-paste-input';
import { isImageUrl, isImageUrlSimple } from '../../util/is-image-url';
import { DropPasteInput } from '../../core/drop-paste-input/drop-paste.model';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { isInputElement } from '../../util/dom-element';

@Injectable({
  providedIn: 'root',
})
export class NoteService {
  private _store$ = inject<Store<any>>(Store);
  private _workContextService = inject(WorkContextService);

  notes$: Observable<Note[]> = this._store$.pipe(select(selectAllNotes));
  state$: Observable<NoteState> = this._store$.select(selectNoteFeatureState);

  getByIdOnce$(id: string): Observable<Note> {
    return this._store$.pipe(select(selectNoteById, { id }), take(1));
  }

  add(note: Partial<Note> = {}, isPreventFocus: boolean = false): void {
    const id = nanoid();

    this._store$.dispatch(
      addNote({
        note: {
          id,
          projectId:
            (this._workContextService.activeWorkContextType === WorkContextType.PROJECT &&
              this._workContextService.activeWorkContextId) ||
            null,
          isPinnedToToday:
            this._workContextService.activeWorkContextType === WorkContextType.TAG,
          content: '',
          created: Date.now(),
          modified: Date.now(),
          ...note,
        },
        isPreventFocus,
      }),
    );
  }

  remove(note: Note): void {
    this._store$.dispatch(
      deleteNote({
        id: note.id,
        projectId: note.projectId,
        isPinnedToToday: note.isPinnedToToday,
      }),
    );
  }

  update(id: string, note: Partial<Note>): void {
    this._store$.dispatch(
      updateNote({
        note: {
          id,
          changes: note,
        },
      }),
    );
  }

  updateOrder(ids: string[]): void {
    // TODO maybe check
    this._store$.dispatch(
      updateNoteOrder({
        ids,
        activeContextType: this._workContextService
          .activeWorkContextType as WorkContextType,
        activeContextId: this._workContextService.activeWorkContextId as string,
      }),
    );
  }

  moveToOtherProject(note: Note, targetProjectId: string): void {
    this._store$.dispatch(
      moveNoteToOtherProject({
        note,
        targetProjectId,
      }),
    );
  }

  // REMINDER
  // --------
  createFromDrop(ev: DragEvent): void {
    this._handleInput(createFromDrop(ev) as DropPasteInput, ev);
  }

  private async _handleInput(drop: DropPasteInput, ev: Event): Promise<void> {
    // properly not intentional so we leave
    if (!drop || !drop.path || drop.type === 'FILE') return;

    // Skip handling inside input elements
    const target = ev.target as HTMLElement;
    if (isInputElement(target)) return;

    const note: Partial<Note> = {
      content: drop.path,
    };

    const isImg = isImageUrlSimple(drop.path) || (await isImageUrl(drop.path));
    if (isImg) {
      note.imgUrl = drop.path;
    }

    this.add(note);

    ev.preventDefault();
    ev.stopPropagation();
  }
}
