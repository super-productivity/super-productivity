import { AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Project } from '../project.model';
import { ProjectCompletionStats } from '../project-completion-stats.util';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

export interface DialogProjectCompleteData {
  project: Project;
  stats: ProjectCompletionStats;
}

@Component({
  selector: 'dialog-project-complete',
  templateUrl: './dialog-project-complete.component.html',
  styleUrls: ['./dialog-project-complete.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    DatePipe,
    TranslatePipe,
    MsToStringPipe,
  ],
})
export class DialogProjectCompleteComponent implements AfterViewInit {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogProjectCompleteComponent>>(MatDialogRef);
  private readonly _confettiService = inject(ConfettiService);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _router = inject(Router);

  readonly data = inject<DialogProjectCompleteData>(MAT_DIALOG_DATA);
  readonly T: typeof T = T;

  async ngAfterViewInit(): Promise<void> {
    // ConfettiService already honors isDisableAnimations; also respect the
    // dedicated celebration toggle (the dialog still shows, just without confetti).
    if (this._configService.misc()?.isDisableCelebration) {
      return;
    }
    // High zIndex so the burst renders above the dialog overlay; the confetti
    // canvas is pointer-events:none, so buttons stay clickable.
    await this._confettiService.createConfetti({
      particleCount: 160,
      startVelocity: 45,
      spread: 360,
      ticks: 320,
      zIndex: 10000,
      origin: { x: 0.5, y: 0.35 },
    });
  }

  close(): void {
    this._matDialogRef.close();
  }

  viewCompleted(): void {
    this._matDialogRef.close();
    this._router.navigateByUrl('/archived-projects');
  }
}
