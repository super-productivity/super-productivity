import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { IS_ELECTRON_TOKEN } from '../../../../app.constants';
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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { nanoid } from 'nanoid';

interface TaskAttachmentSelectType {
  type: TaskAttachmentType;
  title: string;
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
  private readonly _translateService = inject(TranslateService);
  private readonly _isElectron = inject(IS_ELECTRON_TOKEN);
  data = inject(MAT_DIALOG_DATA);

  types: TaskAttachmentSelectType[];
  attachmentCopy: TaskAttachmentCopy;
  isFilePickerOpen = false;
  filePickerError = signal(false);
  selectedFiles = signal<TaskAttachment[]>([]);
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
    if (this._isElectron) {
      this.types.push({ type: 'FILE', title: T.F.ATTACHMENT.DIALOG_EDIT.TYPES.FILE });
    }
  }

  close(attachment?: TaskAttachment | TaskAttachment[]): void {
    this._matDialogRef.close(attachment);
  }

  async chooseFile(): Promise<void> {
    if (this.isFilePickerOpen) return;

    this.filePickerError.set(false);
    this.isFilePickerOpen = true;
    try {
      const paths = await window.ea.showOpenDialog({
        properties: this.data.allowMultiple
          ? ['openFile', 'multiSelections']
          : ['openFile'],
        title: this._translateService.instant(
          T.F.ATTACHMENT.DIALOG_EDIT.FILE_PICKER_TITLE,
        ),
      });
      if (this.data.allowMultiple) {
        if (paths?.length) {
          const newFiles = paths.map(
            (path): TaskAttachment => ({
              id: nanoid(),
              type: 'FILE',
              path,
              title: path.split(/[\\/]/).pop() || path,
            }),
          );
          this.selectedFiles.update((files) => [...files, ...newFiles]);
        }
      } else {
        const path = paths?.[0];
        if (path) {
          this.attachmentCopy.path = path;
          this.attachmentCopy.title = path.split(/[\\/]/).pop() || path;
        }
      }
    } catch {
      this.filePickerError.set(true);
    } finally {
      this.isFilePickerOpen = false;
    }
  }

  removeSelectedFile(id: string | null): void {
    this.selectedFiles.update((files) => files.filter((file) => file.id !== id));
  }

  submit(): void {
    if (this.data.allowMultiple && this.attachmentCopy.type === 'FILE') {
      if (this.selectedFiles().length) this.close(this.selectedFiles());
      return;
    }

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
