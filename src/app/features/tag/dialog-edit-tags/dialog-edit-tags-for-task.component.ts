import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { TaskService } from '../../tasks/task.service';
import { DialogEditTagsForTaskPayload } from './dialog-edit-tags-for-task.payload';
import { truncate } from '../../../util/truncate';
import { TagService } from '../tag.service';
import { Task } from '../../tasks/task.model';
import { unique } from '../../../util/unique';
import { Observable, Subscription } from 'rxjs';
import { Tag } from '../tag.model';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { addTag } from '../store/tag.actions';

@Component({
  selector: 'dialog-edit-tags',
  templateUrl: './dialog-edit-tags-for-task.component.html',
  styleUrls: ['./dialog-edit-tags-for-task.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    ChipListInputComponent,
    MatDialogActions,
    MatButton,
    MatIcon,
    AsyncPipe,
    TranslatePipe,
  ],
})
export class DialogEditTagsForTaskComponent implements OnDestroy {
  private _taskService = inject(TaskService);
  private _tagService = inject(TagService);
  private _store = inject(Store);
  private _matDialogRef =
    inject<MatDialogRef<DialogEditTagsForTaskComponent>>(MatDialogRef);
  data = inject<DialogEditTagsForTaskPayload>(MAT_DIALOG_DATA);

  T: typeof T = T;
  title: string = truncate(this.data.task.title, 20);
  task$: Observable<Task> = this._taskService.getByIdLive$(this.data.task.id);
  task: Task = this.data.task;
  tagIds: string[] = [...this.data.task.tagIds];
  isEdit: boolean = this.data.task.tagIds && this.data.task.tagIds.length > 0;
  tagSuggestions$: Observable<Tag[]> = this._tagService.tagsNoMyDayAndNoList$;

  private _subs: Subscription = new Subscription();

  constructor() {
    this._subs.add(
      this.task$.subscribe((task) => {
        this.tagIds = task.tagIds;
        this.task = task;
      }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  close(): void {
    this._matDialogRef.close();
  }

  addTag(id: string): void {
    this._updateTags(unique([...this.tagIds, id]));
  }

  addNewTag(title: string): void {
    const cleanTitle = (t: string): string => {
      return t.replace('#', '');
    };

    const tag = this._tagService.createTagObject({ title: cleanTitle(title) });
    this._store.dispatch(addTag({ tag }));
    this._store.dispatch(
      TaskSharedActions.addTagToTask({ tagId: tag.id, taskId: this.task.id }),
    );
  }

  removeTag(id: string): void {
    const updatedTagIds = this.tagIds.filter((tagId) => tagId !== id);
    this._updateTags(updatedTagIds);
  }

  private _updateTags(newTagIds: string[]): void {
    this._taskService.updateTags(this.task, unique(newTagIds));
  }
}
