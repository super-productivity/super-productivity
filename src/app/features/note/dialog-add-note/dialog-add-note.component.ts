import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SS } from '../../../core/persistence/storage-keys.const';
import { T } from '../../../t.const';
import { DialogFullscreenMarkdownComponent } from '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';
import { NoteService } from '../note.service';
import { FormsModule } from '@angular/forms';
import { MarkdownComponent } from 'ngx-markdown';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { SnackService } from '../../../core/snack/snack.service';
import { AsyncPipe } from '@angular/common';

@Component({
  // selector: 'dialog-add-note',
  selector: 'dialog-fullscreen-markdown',
  templateUrl:
    '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.html',
  styleUrls: [
    '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MarkdownComponent,
    MatButtonToggleGroup,
    MatButtonToggle,
    MatTooltip,
    MatIcon,
    MatButton,
    MatIconButton,
    TranslatePipe,
    AsyncPipe,
  ],
})
export class DialogAddNoteComponent extends DialogFullscreenMarkdownComponent {
  // override _matDialogRef: MatDialogRef<DialogAddNoteComponent> =
  //   inject<MatDialogRef<DialogAddNoteComponent>>(MatDialogRef);
  private _noteService = inject(NoteService);
  private _snackService = inject(SnackService);

  override T: typeof T = T;

  constructor() {
    super();
    this.data = { content: sessionStorage.getItem(SS.NOTE_TMP) || '' };
  }

  override close(isSkipSave: boolean = false, isEscapeClose: boolean = false): void {
    if (!isEscapeClose) {
      if (!isSkipSave && this.data?.content && this.data.content.trim().length > 0) {
        this._noteService.add({ content: this.data.content }, true);
        this._snackService.open({
          type: 'SUCCESS',
          msg: this.T.F.NOTE.S.NOTE_ADDED,
          ico: 'comment',
        });
        this._clearSessionStorage();
      }

      if (isSkipSave) {
        this._clearSessionStorage();
      }
    }
    this._matDialogRef.close();
  }

  override ngModelChange(val: string = this.data?.content || ''): void {
    sessionStorage.setItem(SS.NOTE_TMP, val);
  }

  private _clearSessionStorage(): void {
    sessionStorage.removeItem(SS.NOTE_TMP);
  }
}
