import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { IS_APPLE_APP_STORE } from '../../app.constants';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import {
  CONTRIBUTING_URL,
  DISCUSSIONS_URL,
  MAINTAINER_EMAIL,
  RateDialogResult,
  buildFeedbackMailto,
  getPrimaryCta,
} from './rate-dialog-state';

@Component({
  selector: 'dialog-please-rate',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
  templateUrl: './dialog-please-rate.component.html',
  styleUrl: './dialog-please-rate.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogPleaseRateComponent {
  private readonly _dialogRef =
    inject<MatDialogRef<DialogPleaseRateComponent, RateDialogResult>>(MatDialogRef);

  protected readonly T = T;
  // No sentiment gate: the store CTA is shown to everyone (store-policy safe),
  // with a separate, decoupled path to feedback. On play-flavor Android the
  // native review card is used instead and this dialog isn't shown at all.
  protected readonly view = signal<'main' | 'feedback'>('main');
  protected readonly cta = getPrimaryCta();
  protected readonly mailtoUrl = buildFeedbackMailto();
  protected readonly discussionsUrl = DISCUSSIONS_URL;
  protected readonly contributingUrl = CONTRIBUTING_URL;
  // CONTRIBUTING.md links to GitHub Sponsors; Apple App Store builds must not
  // surface donation paths outside In-App Purchase (Guideline 3.1.1). Mirrors
  // the gate on the identical Help-menu link. This dialog isn't shown on iOS
  // (native StoreReview card) but is shown on the Mac App Store (Electron).
  protected readonly IS_APPLE_APP_STORE = IS_APPLE_APP_STORE;
  // Shown as selectable text under the email option so the channel isn't a dead
  // end when no mail client is registered (common on Linux/web) and the mailto:
  // link silently does nothing.
  protected readonly maintainerEmail = MAINTAINER_EMAIL;

  protected showFeedback(): void {
    this.view.set('feedback');
  }

  protected showMain(): void {
    this.view.set('main');
  }

  protected close(result: RateDialogResult): void {
    this._dialogRef.close(result);
  }
}
