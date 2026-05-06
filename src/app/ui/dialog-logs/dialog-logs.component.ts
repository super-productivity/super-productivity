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
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { download } from '../../util/download';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { SnackService } from '../../core/snack/snack.service';
import { ShareService } from '../../core/share/share.service';

interface DialogLogsData {
  logs: string;
}

@Component({
  selector: 'dialog-logs',
  templateUrl: './dialog-logs.component.html',
  styleUrls: ['./dialog-logs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogLogsComponent {
  private readonly _dialogRef = inject<MatDialogRef<DialogLogsComponent>>(MatDialogRef);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);
  readonly data = inject<DialogLogsData>(MAT_DIALOG_DATA);

  readonly T: typeof T = T;
  readonly isNative = IS_NATIVE_PLATFORM;

  async copy(): Promise<void> {
    // ShareService handles the execCommand fallback for older Android WebViews
    // where navigator.clipboard.writeText is unavailable — same class of
    // silent-failure platform that motivated this dialog in the first place.
    const result = await this._shareService.copyToClipboard(this.data.logs, 'Logs');
    if (!result.success) {
      this._snackService.open(T.DIALOG_LOGS.S_COPY_FAILED);
    }
  }

  async shareFile(): Promise<void> {
    try {
      await download('SP-logs.json', this.data.logs);
    } catch (e) {
      Log.err('Log file share failed', e);
      this._snackService.open(T.DIALOG_LOGS.S_SHARE_FAILED);
    }
  }

  close(): void {
    this._dialogRef.close();
  }
}
