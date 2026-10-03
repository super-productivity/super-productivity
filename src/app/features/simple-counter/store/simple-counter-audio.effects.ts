import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, take } from 'rxjs';
import { filter, map, switchMap, tap } from 'rxjs/operators';
import { AudioPlayerService } from '../../../util/audio-player.service';
import {
  toggleSimpleCounterCounter,
  setSimpleCounterCounterOff,
} from './simple-counter.actions';
import { selectSoundConfig } from '../../config/store/global-config.reducer';
import { selectSimpleCounterById } from './simple-counter.reducer';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SoundConfig } from '../../config/global-config.model';
import { CustomSoundStorageService } from '../custom-sound-storage.service';

const CUSTOM_PREFIX = 'custom:';

/**
 * Resolves the effective sound file and volume for a counter, falling back
 * to the global sound config when the counter has no per-counter overrides.
 *
 * Pure function — easy to unit-test without mocking the store.
 */
export const resolveCounterSoundCfg = (
  counter: SimpleCounter,
  globalCfg: SoundConfig,
): { file: string | null; volume: number } => ({
  file: counter.soundType ?? globalCfg.doneSound,
  volume: counter.soundVolume != null ? counter.soundVolume : globalCfg.volume,
});

/**
 * Audio Effects for Simple Counter start/stop events.
 * Triggers audio feedback when:
 * - A countdown-based timer starts or stops
 * - A stopwatch starts or is manually stopped/disabled
 *
 * Audio is queued internally to prevent clipping when multiple counters complete simultaneously.
 */
@Injectable()
export class SimpleCounterAudioEffects {
  private actions$ = inject(Actions);
  private store$ = inject(Store);
  private _customSoundService = inject(CustomSoundStorageService);
  private _audioPlayer = inject(AudioPlayerService);

  /**
   * Plays audio feedback when a SimpleCounter is toggled on or off.
   * Detects start/stop by checking the post-action isOn state.
   *
   * Listens to toggleSimpleCounterCounter and setSimpleCounterCounterOff actions
   * which are dispatched when the user clicks to stop a habit.
   *
   * Uses per-counter sound settings when configured, falling back to the global
   * sound configuration for the sound file and volume.
   */
  playHabitAudio$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(toggleSimpleCounterCounter, setSimpleCounterCounterOff),
        // Get counter and sound config at the time of toggle.
        // take(1) prevents re-emissions from subsequent store updates.
        switchMap((action) =>
          combineLatest([
            this.store$.select(selectSoundConfig),
            this.store$.select(selectSimpleCounterById, { id: action.id }),
          ]).pipe(
            take(1),
            map(([soundConfig, counter]) => ({ soundConfig, counter })),
          ),
        ),
        // Require both configs to exist
        filter(({ soundConfig, counter }) => !!soundConfig && !!counter),
        // Require global config to have a usable fallback sound
        filter(({ soundConfig }) => !!soundConfig.doneSound),
        // Respect the per-counter audio toggle
        filter(({ counter }) => !!counter && counter.isAudioEnabled !== false),
        // Only StopWatch and RepeatedCountdownReminder emit audio
        filter(
          ({ counter }) =>
            !!counter &&
            (counter.type === SimpleCounterType.StopWatch ||
              counter.type === SimpleCounterType.RepeatedCountdownReminder),
        ),
        tap(async ({ soundConfig, counter }) => {
          if (!counter) return;
          const { file, volume } = resolveCounterSoundCfg(counter, soundConfig);
          if (!file || volume <= 0) return;
          if (file.startsWith(CUSTOM_PREFIX)) {
            const soundId = file.slice(CUSTOM_PREFIX.length);
            const stored = await this._customSoundService.getSound(soundId);
            if (stored) {
              await this._audioPlayer.playSoundFromBuffer(
                `${CUSTOM_PREFIX}${soundId}`,
                stored.arrayBuffer,
                volume,
              );
            }
          } else {
            await this._audioPlayer.playSound(file, volume);
          }
        }),
      ),
    { dispatch: false },
  );
}
