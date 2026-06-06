import { inject, Injectable } from '@angular/core';

import { GlobalConfigService } from '../../features/config/global-config.service';
import { ConfettiConfig, ConfettiInstance } from './confetti.model';

@Injectable({
  providedIn: 'root',
})
export class ConfettiService {
  private readonly _configService = inject(GlobalConfigService);

  async createConfetti(props: ConfettiConfig): Promise<void> {
    if (this._isDisabled()) {
      return;
    }

    const confettiModule = await import('canvas-confetti');
    confettiModule.default({ disableForReducedMotion: true, ...props });
  }

  async createConfettiOnCanvas(
    canvas: HTMLCanvasElement,
    props: ConfettiConfig,
  ): Promise<ConfettiInstance | undefined> {
    if (this._isDisabled()) {
      return undefined;
    }

    const confettiModule = await import('canvas-confetti');
    const confetti: ConfettiInstance = confettiModule.default.create(canvas, {
      resize: true,
    });
    // Fire without awaiting completion so the caller keeps the handle and can
    // reset() to tear down the rAF loop + window resize listener if the dialog
    // closes before the ~5s animation finishes.
    void confetti({ disableForReducedMotion: true, ...props });
    return confetti;
  }

  private _isDisabled(): boolean {
    const misc = this._configService.misc();
    // Honor the OS "reduce motion" setting for every confetti caller (not just
    // the in-app animations toggle) — intentional, app-wide a11y behavior.
    return (
      !!misc?.isDisableAnimations ||
      !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );
  }
}
