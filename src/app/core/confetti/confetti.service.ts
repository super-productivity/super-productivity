import { inject, Injectable } from '@angular/core';

import { GlobalConfigService } from '../../features/config/global-config.service';
import { ConfettiConfig } from './confetti.model';

@Injectable({
  providedIn: 'root',
})
export class ConfettiService {
  private readonly _configService = inject(GlobalConfigService);

  async createConfetti(props: ConfettiConfig): Promise<void> {
    const misc = this._configService.misc();

    if (misc && misc.isDisableAnimations) {
      return;
    }

    const confettiModule = await import('canvas-confetti');
    confettiModule.default(props);
  }

  async createConfettiOnCanvas(
    canvas: HTMLCanvasElement,
    props: ConfettiConfig,
  ): Promise<void> {
    const misc = this._configService.misc();

    if (misc && misc.isDisableAnimations) {
      return;
    }

    const confettiModule = await import('canvas-confetti');
    const confetti = confettiModule.default.create(canvas, {
      resize: true,
    });
    await confetti(props);
  }
}
