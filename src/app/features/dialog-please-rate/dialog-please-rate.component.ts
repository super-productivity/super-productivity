import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { MatAnchor, MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'dialog-please-rate',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    MatDialogClose,
    MatAnchor,
    TranslatePipe,
  ],
  templateUrl: './dialog-please-rate.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogPleaseRateComponent {
  protected readonly T = T;

  // IS_ELECTRON = IS_ELECTRON;
  // IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  // IS_WINDOWS = /Win32|Win64|Windows/.test(navigator.platform);
  // IS_LINUX = /Linux/.test(navigator.platform);
  //
  // // For Ubuntu or GNOME:
  // IS_UBUNTU = this.IS_LINUX && /Ubuntu/i.test(navigator.userAgent);
  // IS_GNOME = this.IS_LINUX && /gnome/i.test(navigator.userAgent);
  // IS_SNAP = IS_ELECTRON && window.ea.isSnap();
  // IS_ANDROID_WEBVIEW = IS_ANDROID_WEB_VIEW;
}
