import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Project } from '../project.model';
import { ProjectCompletionStats } from '../project-completion-stats.util';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { MatTooltip } from '@angular/material/tooltip';
import { ProjectService } from '../project.service';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { IS_ELECTRON } from '../../../app.constants';
import { normalizeBackgroundImageBlur } from '../../work-context/work-context.const';

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
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
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
  private readonly _projectService = inject(ProjectService);
  private readonly _globalThemeService = inject(GlobalThemeService);

  readonly data = inject<DialogProjectCompleteData>(MAT_DIALOG_DATA);
  readonly T: typeof T = T;
  readonly resolvedBgImage = signal<string | null>(null);
  readonly isDisableBackgroundTint = computed(
    () => !!this.data.project.theme?.isDisableBackgroundTint,
  );
  readonly projectPrimaryColor = computed(() => this.data.project.theme?.primary ?? null);
  readonly projectAccentColor = computed(
    () => this.data.project.theme?.accent ?? this.data.project.theme?.primary ?? null,
  );
  readonly backgroundOverlayOpacity = computed(
    () => (this.data.project.theme?.backgroundOverlayOpacity ?? 20) * 0.01,
  );
  readonly backgroundImageBlur = computed(() =>
    normalizeBackgroundImageBlur(this.data.project.theme?.backgroundImageBlur),
  );
  readonly backgroundImageBlurFilter = computed(() => {
    const blur = this.backgroundImageBlur();
    return blur > 0 ? `blur(${blur}px)` : 'none';
  });
  private readonly _backgroundImage = computed(() => {
    const theme = this.data.project.theme;
    return (
      (this._globalThemeService.isDarkTheme()
        ? theme?.backgroundImageDark
        : theme?.backgroundImageLight) || null
    );
  });
  private _bgResolveRequestId = 0;

  @ViewChild('confettiCanvas')
  private readonly _confettiCanvas?: ElementRef<HTMLCanvasElement>;

  constructor() {
    effect(() => {
      const bgImage = this._backgroundImage();
      const currentRequestId = ++this._bgResolveRequestId;
      if (!bgImage) {
        this.resolvedBgImage.set(null);
        return;
      }

      if (!IS_ELECTRON || !bgImage.startsWith('file://')) {
        this.resolvedBgImage.set(bgImage);
        return;
      }

      const readLocalImageAsDataUrl = window.ea?.readLocalImageAsDataUrl;
      if (!readLocalImageAsDataUrl) {
        this.resolvedBgImage.set(null);
        return;
      }

      readLocalImageAsDataUrl(bgImage)
        .then((dataUrl) => {
          if (currentRequestId === this._bgResolveRequestId) {
            this.resolvedBgImage.set(dataUrl || null);
          }
        })
        .catch(() => {
          if (currentRequestId === this._bgResolveRequestId) {
            this.resolvedBgImage.set(null);
          }
        });
    });
  }

  async ngAfterViewInit(): Promise<void> {
    // ConfettiService already honors isDisableAnimations; also respect the
    // dedicated celebration toggle (the dialog still shows, just without confetti).
    if (this._configService.misc()?.isDisableCelebration) {
      return;
    }
    const canvas = this._confettiCanvas?.nativeElement;
    if (!canvas) {
      return;
    }
    await this._confettiService.createConfettiOnCanvas(canvas, {
      particleCount: 160,
      startVelocity: 45,
      spread: 360,
      ticks: 320,
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

  undo(): void {
    this._matDialogRef.close();
    this._projectService.reopen(this.data.project.id, this.data.project);
  }
}
