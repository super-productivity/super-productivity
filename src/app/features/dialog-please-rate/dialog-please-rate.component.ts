import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import {
  CONTRIBUTING_URL,
  DISCUSSIONS_URL,
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
  protected readonly view = signal<'main' | 'feedback'>('main');
  protected readonly cta = getPrimaryCta();
  protected readonly mailtoUrl = buildFeedbackMailto();
  protected readonly discussionsUrl = DISCUSSIONS_URL;
  protected readonly contributingUrl = CONTRIBUTING_URL;

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
