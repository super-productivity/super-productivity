import { Injectable, inject } from '@angular/core';
import { Action, select, Store } from '@ngrx/store';
import {
  selectAllTags,
  selectAllTagsWithoutMyDay,
  selectTagById,
  selectTagsByIds,
} from './store/tag.reducer';
import {
  addTag,
  deleteTag,
  deleteTags,
  updateTag,
  updateTagOrder,
} from './store/tag.actions';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Tag, TagState } from './tag.model';
import { nanoid } from 'nanoid';
import { DEFAULT_TAG } from './tag.const';
import { toSignal } from '@angular/core/rxjs-interop';
import { sortByTitle } from '../../util/sort-by-title';

@Injectable({
  providedIn: 'root',
})
export class TagService {
  private _store$ = inject<Store<TagState>>(Store);

  tags$: Observable<Tag[]> = this._store$.pipe(select(selectAllTags));
  tags = toSignal(this.tags$, { initialValue: [] });
  tagsSortedForUI$: Observable<Tag[]> = this.tags$.pipe(map((tags) => sortByTitle(tags)));
  tagsSortedForUI = toSignal(this.tagsSortedForUI$, { initialValue: [] });

  tagsNoMyDayAndNoList$: Observable<Tag[]> = this._store$.pipe(
    select(selectAllTagsWithoutMyDay),
  );
  tagsNoMyDayAndNoList = toSignal(this.tagsNoMyDayAndNoList$, { initialValue: [] });
  tagsNoMyDayAndNoListSorted$: Observable<Tag[]> = this.tagsNoMyDayAndNoList$.pipe(
    map((tags) => sortByTitle(tags)),
  );
  tagsNoMyDayAndNoListSorted = toSignal(this.tagsNoMyDayAndNoListSorted$, {
    initialValue: [],
  });

  getTagById$(id: string): Observable<Tag> {
    return this._store$.pipe(select(selectTagById, { id }));
  }

  getTagsByIds$(ids: string[], isAllowNull: boolean = false): Observable<Tag[]> {
    return this._store$.pipe(select(selectTagsByIds, { ids, isAllowNull }));
  }

  addTag(tag: Partial<Tag>): string {
    const { id, action } = this.getAddTagActionAndId(tag);
    this._store$.dispatch(action);
    return id;
  }

  deleteTag(id: string): void {
    this._store$.dispatch(deleteTag({ id }));
  }

  removeTag(id: string): void {
    this._store$.dispatch(deleteTag({ id }));
  }

  updateColor(id: string, color: string): void {
    this._store$.dispatch(updateTag({ tag: { id, changes: { color } } }));
  }

  updateOrder(ids: string[]): void {
    this._store$.dispatch(updateTagOrder({ ids }));
  }

  deleteTags(ids: string[]): void {
    this._store$.dispatch(deleteTags({ ids }));
  }

  updateTag(id: string, changes: Partial<Tag>): void {
    this._store$.dispatch(updateTag({ tag: { id, changes } }));
  }

  createTagObject(tag: Partial<Tag>): Tag {
    const id = tag.id || nanoid();
    return {
      ...DEFAULT_TAG,
      id,
      title: tag.title || 'EMPTY',
      created: Date.now(),
      icon: null,
      color: tag.color || null,
      taskIds: [],
      ...tag,
    };
  }

  getAddTagActionAndId(tag: Partial<Tag>): { action: Action<any>; id: string } {
    const newTag = this.createTagObject(tag);
    return {
      id: newTag.id,
      action: addTag({ tag: newTag }),
    };
  }
}
