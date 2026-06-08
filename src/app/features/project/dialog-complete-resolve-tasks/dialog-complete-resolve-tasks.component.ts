import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

export interface DialogCompleteResolveTasksData {
  title: string;
  nr: number;
}

export type ResolveUnfinishedTasksChoice = 'inbox' | 'markDone';

@Component({
  selector: 'dialog-complete-resolve-tasks',
  templateUrl: './dialog-complete-resolve-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, TranslatePipe],
})
export class DialogCompleteResolveTasksComponent {
  private readonly _matDialogRef =
    inject<
      MatDialogRef<DialogCompleteResolveTasksComponent, ResolveUnfinishedTasksChoice>
    >(MatDialogRef);

  readonly data = inject<DialogCompleteResolveTasksData>(MAT_DIALOG_DATA);
  readonly T: typeof T = T;

  cancel(): void {
    this._matDialogRef.close(undefined);
  }

  moveToInbox(): void {
    this._matDialogRef.close('inbox');
  }

  markDone(): void {
    this._matDialogRef.close('markDone');
  }
}
