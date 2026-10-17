import { Injectable } from '@angular/core';
import { playSound, playSoundFromBuffer } from './play-sound';

/**
 * Thin injectable wrapper around the module-level audio functions.
 * Exists primarily to make the audio side-effects in NgRx effects
 * mockable in unit tests (ES module exports are read-only at runtime).
 */
@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  playSound(filePath: string, vol = 100): Promise<void> {
    return playSound(filePath, vol);
  }

  playSoundFromBuffer(
    cacheKey: string,
    arrayBuffer: ArrayBuffer,
    vol = 100,
  ): Promise<void> {
    return playSoundFromBuffer(cacheKey, arrayBuffer, vol);
  }
}
