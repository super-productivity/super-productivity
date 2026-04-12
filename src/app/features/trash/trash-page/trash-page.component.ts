import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';

import { T } from '../../../t.const';
import { TrashService } from '../trash.service';
import { TrashedTask } from '../trash.model';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { GlobalConfigService } from '../../config/global-config.service';

@Component({
  selector: 'trash-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatIconButton, MatTooltip, TranslatePipe, DatePipe],
  templateUrl: 'trash-page.component.html',
  styleUrls: ['trash-page.component.scss'],
})
export class TrashPageComponent {
  private readonly _trashService = inject(TrashService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _globalConfigService = inject(GlobalConfigService);

  readonly T = T;
  readonly trashedTasks = this._trashService.trashedTasks;
  readonly retentionDays = computed(
    () => this._globalConfigService.cfg()?.trash.retentionDays ?? 30,
  );

  restore(item: TrashedTask): void {
    this._trashService.restore(item.id, item.entityType);
  }

  deletePermanently(item: TrashedTask): void {
    this._trashService.permanentlyDelete([item.id]);
  }

  emptyTrash(): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        data: {
          okTxt: T.TRASH.EMPTY_TRASH,
          message: T.TRASH.EMPTY_TRASH_CONFIRM,
        },
      })
      .afterClosed()
      .subscribe((isConfirm) => {
        if (isConfirm) {
          this._trashService.emptyTrash();
        }
      });
  }
}
