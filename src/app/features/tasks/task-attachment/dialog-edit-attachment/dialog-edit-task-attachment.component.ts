import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { IS_ELECTRON } from '../../../../app.constants';
import {
  TaskAttachment,
  TaskAttachmentCopy,
  TaskAttachmentType,
} from '../task-attachment.model';
import { T } from '../../../../t.const';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { selectTaskEntities } from '../../store/task.selectors';

interface TaskAttachmentSelectType {
  type: TaskAttachmentType;
  title: string;
}

export interface DialogEditTaskAttachmentData {
  attachment?: Partial<TaskAttachment>;
  /** Task the attachment is added to; lets the dialog hint on repeating tasks. */
  taskId?: string;
}

// RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) followed by ":".
const HAS_URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

@Component({
  selector: 'dialog-edit-task-attachment',
  templateUrl: './dialog-edit-task-attachment.component.html',
  styleUrls: ['./dialog-edit-task-attachment.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogEditTaskAttachmentComponent {
  private _matDialogRef =
    inject<MatDialogRef<DialogEditTaskAttachmentComponent>>(MatDialogRef);
  private _store = inject(Store);
  data = inject<DialogEditTaskAttachmentData>(MAT_DIALOG_DATA);
  private _taskEntities = this._store.selectSignal(selectTaskEntities);

  // Attachments are not part of the repeat config, so one added to an instance
  // never reaches the next one (#10706, #8745). Say so while adding, not on edit.
  readonly isShowRepeatInstanceHint = computed(
    () =>
      !this.data.attachment?.id &&
      !!this.data.taskId &&
      !!this._taskEntities()[this.data.taskId]?.repeatCfgId,
  );

  types: TaskAttachmentSelectType[];
  attachmentCopy: TaskAttachmentCopy;
  T: typeof T = T;

  constructor() {
    this.attachmentCopy = { ...this.data.attachment } as TaskAttachmentCopy;
    if (!this.attachmentCopy.type) {
      this.attachmentCopy.type = 'LINK';
    }

    this.types = [
      { type: 'LINK', title: T.F.ATTACHMENT.DIALOG_EDIT.TYPES.LINK },
      { type: 'IMG', title: T.F.ATTACHMENT.DIALOG_EDIT.TYPES.IMG },
    ];
    if (IS_ELECTRON) {
      this.types.push({ type: 'FILE', title: T.F.ATTACHMENT.DIALOG_EDIT.TYPES.FILE });
    }
  }

  close(attachment?: TaskAttachment): void {
    this._matDialogRef.close(attachment);
  }

  submit(): void {
    // don't submit invalid data
    if (!this.attachmentCopy.path || !this.attachmentCopy.type) {
      return;
    }

    this.attachmentCopy.path = this.attachmentCopy.path.trim();

    if (
      (this.attachmentCopy.type === 'LINK' || this.attachmentCopy.type === 'IMG') &&
      this.attachmentCopy.path &&
      !HAS_URL_SCHEME_RE.test(this.attachmentCopy.path)
    ) {
      // protocol-relative "//example.com" → "http://example.com" (avoid "http:////")
      this.attachmentCopy.path = this.attachmentCopy.path.startsWith('//')
        ? 'http:' + this.attachmentCopy.path
        : 'http://' + this.attachmentCopy.path;
    }

    if (!this.attachmentCopy.path) {
      return;
    }

    this.close(this.attachmentCopy);
  }

  mapTypeToLabel(type: TaskAttachmentType): string {
    switch (type) {
      case 'FILE':
        return T.F.ATTACHMENT.DIALOG_EDIT.LABELS.FILE;
      case 'IMG':
        return T.F.ATTACHMENT.DIALOG_EDIT.LABELS.IMG;
      case 'LINK':
      default:
        return T.F.ATTACHMENT.DIALOG_EDIT.LABELS.LINK;
    }
  }

  mapTypeToPlaceholder(type: TaskAttachmentType): string {
    switch (type) {
      case 'FILE':
        return T.F.ATTACHMENT.DIALOG_EDIT.PLACEHOLDERS.FILE;
      case 'IMG':
        return T.F.ATTACHMENT.DIALOG_EDIT.PLACEHOLDERS.IMG;
      case 'LINK':
      default:
        return T.F.ATTACHMENT.DIALOG_EDIT.PLACEHOLDERS.LINK;
    }
  }

  trackByIndex(i: number, p: any): number {
    return i;
  }
}
