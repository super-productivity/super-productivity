import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DatePipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Project } from '../project.model';
import { ProjectCompletionStats } from '../project-completion-stats.util';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { ConfettiInstance } from '../../../core/confetti/confetti.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { MatTooltip } from '@angular/material/tooltip';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { resolveBgImageToDataUrl } from '../../../core/theme/resolve-bg-image-to-data-url.util';
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
export class DialogProjectCompleteComponent implements AfterViewInit, OnDestroy {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogProjectCompleteComponent>>(MatDialogRef);
  private readonly _confettiService = inject(ConfettiService);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _globalThemeService = inject(GlobalThemeService);

  readonly data = inject<DialogProjectCompleteData>(MAT_DIALOG_DATA);
  readonly T: typeof T = T;
  readonly resolvedBgImage = signal<string | null>(null);
  readonly isDisableBackgroundTint = computed(
    () => !!this.data.project.theme?.isDisableBackgroundTint,
  );
  readonly projectPrimaryColor = computed(() => this.data.project.theme?.primary ?? null);
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
  private _confettiInstance?: ConfettiInstance;
  private _isDestroyed = false;

  @ViewChild('confettiCanvas')
  private readonly _confettiCanvas?: ElementRef<HTMLCanvasElement>;

  constructor() {
    effect(() => {
      const bgImage = this._backgroundImage();
      const currentRequestId = ++this._bgResolveRequestId;
      void resolveBgImageToDataUrl(bgImage).then((resolved) => {
        // Ignore stale resolutions when the source changed mid-read.
        if (currentRequestId === this._bgResolveRequestId) {
          this.resolvedBgImage.set(resolved);
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
    const instance = await this._confettiService.createConfettiOnCanvas(canvas, {
      particleCount: 160,
      startVelocity: 45,
      spread: 360,
      ticks: 320,
      origin: { x: 0.5, y: 0.35 },
    });
    // The dialog may have closed while the confetti module was still loading —
    // tear the instance down right away instead of leaking its rAF loop.
    if (this._isDestroyed) {
      instance?.reset();
      return;
    }
    this._confettiInstance = instance;
  }

  ngOnDestroy(): void {
    // Tear down the confetti rAF loop + resize listener if the dialog closes
    // before the ~5s animation finishes (otherwise it draws to a detached canvas).
    this._isDestroyed = true;
    this._confettiInstance?.reset();
  }

  close(): void {
    this._matDialogRef.close();
  }
}
