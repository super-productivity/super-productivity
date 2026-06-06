import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService, TranslateStore } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { getPluralKey } from '../../../util/get-plural-key';

export type FinishDayBeforeCloseChoice = 'cancel' | 'quit' | 'finish-day';

export interface FinishDayBeforeCloseDialogData {
  doneTaskCount: number;
}

@Component({
  selector: 'dialog-finish-day-before-close',
  templateUrl: './dialog-finish-day-before-close.component.html',
  styleUrls: ['./dialog-finish-day-before-close.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatDialogTitle,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogFinishDayBeforeCloseComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogFinishDayBeforeCloseComponent, FinishDayBeforeCloseChoice>>(
      MatDialogRef,
    );
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);
  readonly data = inject<FinishDayBeforeCloseDialogData>(MAT_DIALOG_DATA);

  readonly T: typeof T = T;

  readonly bodyKey = getPluralKey(
    this._translateService,
    this._translateStore,
    this.data.doneTaskCount,
    'F.FINISH_DAY_BEFORE_EXIT.C.UNARCHIVED_TASKS',
  );

  close(choice: FinishDayBeforeCloseChoice): void {
    this._matDialogRef.close(choice);
  }
}
