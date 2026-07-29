import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Observable, of } from 'rxjs';
import { SimpleCounterAudioEffects } from './simple-counter-audio.effects';
import {
  setSimpleCounterCounterOff,
  toggleSimpleCounterCounter,
} from './simple-counter.actions';
import { selectSoundConfig } from '../../config/store/global-config.reducer';
import { selectSimpleCounterById } from './simple-counter.reducer';
import { SimpleCounterType } from '../simple-counter.model';
import { SoundConfig } from '../../config/global-config.model';
import { resolveCounterSoundCfg } from './simple-counter-audio.effects';
import {
  CustomSoundStorageService,
  StoredCustomSound,
} from '../custom-sound-storage.service';
import { AudioPlayerService } from '../../../util/audio-player.service';

const makeStoredSound = (id: string, byteLength = 64): StoredCustomSound => ({
  id,
  name: id,
  arrayBuffer: new ArrayBuffer(byteLength),
  uploadDate: Date.now(),
});

/**
 * Unit tests for SimpleCounterAudioEffects
 * Tests audio feedback triggering for habit session start/stop using marble testing
 */
describe('SimpleCounterAudioEffects', () => {
  let actions$: Observable<Action>;
  let effects: SimpleCounterAudioEffects;
  let store: MockStore;
  let mockAudioPlayer: jasmine.SpyObj<AudioPlayerService>;
  let mockCustomSoundService: jasmine.SpyObj<CustomSoundStorageService>;

  const mockSoundConfig: SoundConfig = {
    isIncreaseDoneSoundPitch: false,
    doneSound: 'positive.mp3',
    breakReminderSound: 'bell.mp3',
    trackTimeSound: 'tick.mp3',
    volume: 80,
  };

  const mockCountdownCounter = {
    id: 'countdown-1',
    title: 'Countdown Test',
    isEnabled: true,
    icon: 'timer',
    type: SimpleCounterType.RepeatedCountdownReminder,
    countdownDuration: 300000, // 5 minutes
    isAudioEnabled: true,
    isOn: true,
    countOnDay: {},
  };

  const mockStopwatchCounter = {
    id: 'stopwatch-1',
    title: 'Stopwatch Test',
    isEnabled: true,
    icon: 'stopwatch',
    type: SimpleCounterType.StopWatch,
    isAudioEnabled: true,
    isOn: true,
    countOnDay: {},
  };

  const mockClickCounter = {
    id: 'click-1',
    title: 'Click Counter Test',
    isEnabled: true,
    icon: 'plus_one',
    type: SimpleCounterType.ClickCounter,
    isAudioEnabled: true,
    isOn: false,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    countOnDay: { '2024-01-01': 5 },
  };

  beforeEach(() => {
    mockAudioPlayer = jasmine.createSpyObj<AudioPlayerService>('AudioPlayerService', [
      'playSound',
      'playSoundFromBuffer',
    ]);
    mockAudioPlayer.playSound.and.returnValue(Promise.resolve());
    mockAudioPlayer.playSoundFromBuffer.and.returnValue(Promise.resolve());

    mockCustomSoundService = jasmine.createSpyObj<CustomSoundStorageService>(
      'CustomSoundStorageService',
      ['getSound', 'listSounds', 'installFromFile', 'removeSound'],
      { sounds: signal([]) },
    );
    mockCustomSoundService.getSound.and.returnValue(Promise.resolve(undefined));

    TestBed.configureTestingModule({
      providers: [
        SimpleCounterAudioEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {},
        }),
        { provide: AudioPlayerService, useValue: mockAudioPlayer },
        { provide: CustomSoundStorageService, useValue: mockCustomSoundService },
      ],
    });

    effects = TestBed.inject(SimpleCounterAudioEffects);
    store = TestBed.inject(MockStore);

    // Mock store selectors
    store.overrideSelector(selectSoundConfig, mockSoundConfig);
  });

  afterEach(() => {
    mockAudioPlayer.playSound.calls.reset();
    mockAudioPlayer.playSoundFromBuffer.calls.reset();
  });

  describe('playHabitAudio$ effect', () => {
    it('should play audio when countdown stops (isOn: false)', (done) => {
      const countdownCounterInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownCounterInactive);

      actions$ = of(setSimpleCounterCounterOff({ id: countdownCounterInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should play audio when stopwatch stops (isOn: false)', (done) => {
      const stopwatchInactive = { ...mockStopwatchCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, stopwatchInactive);

      actions$ = of(setSimpleCounterCounterOff({ id: stopwatchInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should NOT play audio when click counter is toggled', (done) => {
      store.overrideSelector(selectSimpleCounterById, mockClickCounter);

      actions$ = of(toggleSimpleCounterCounter({ id: mockClickCounter.id }));

      // ClickCounter is filtered out by the pipeline — subscribe never fires.
      // Start the pipeline and verify after a short delay.
      effects.playHabitAudio$.subscribe();

      setTimeout(() => {
        expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should NOT play audio when audio is disabled globally (volume=0)', (done) => {
      const silentConfig: SoundConfig = {
        ...mockSoundConfig,
        volume: 0,
      };

      store.overrideSelector(selectSoundConfig, silentConfig);

      const countdownInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
          done();
        }, 50);
      });
    });

    it('should NOT play audio when counter has audio disabled locally', (done) => {
      const countdownNoAudio = {
        ...mockCountdownCounter,
        isAudioEnabled: false,
      };
      const countdownInactive = { ...countdownNoAudio, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      // isAudioEnabled:false is filtered out — subscribe never fires.
      effects.playHabitAudio$.subscribe();

      setTimeout(() => {
        expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should play audio when counter starts (isOn: true)', (done) => {
      const countdownActive = { ...mockCountdownCounter, isOn: true };

      store.overrideSelector(selectSimpleCounterById, countdownActive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownActive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should NOT play audio when sound config is missing', (done) => {
      store.overrideSelector(selectSoundConfig, null as unknown as SoundConfig);

      const countdownInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      // null soundConfig is filtered out — subscribe never fires.
      effects.playHabitAudio$.subscribe();

      setTimeout(() => {
        expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should NOT play audio when doneSound is not configured', (done) => {
      const configNoDoneSound: SoundConfig = {
        ...mockSoundConfig,
        doneSound: null,
      };

      store.overrideSelector(selectSoundConfig, configNoDoneSound);

      const countdownInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      // null doneSound is filtered out — subscribe never fires.
      effects.playHabitAudio$.subscribe();

      setTimeout(() => {
        expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should use correct volume from sound config', (done) => {
      const customVolumeConfig: SoundConfig = {
        ...mockSoundConfig,
        volume: 45,
      };

      store.overrideSelector(selectSoundConfig, customVolumeConfig);

      const countdownInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 45);
          done();
        }, 50);
      });
    });

    it('should handle multiple concurrent counters without errors', (done) => {
      const countdown1Inactive = {
        ...mockCountdownCounter,
        id: 'c1',
        isOn: false,
      };

      store.overrideSelector(selectSimpleCounterById, countdown1Inactive);

      let callCount = 0;

      actions$ = of(
        setSimpleCounterCounterOff({ id: 'c1' }),
        setSimpleCounterCounterOff({ id: 'c1' }),
      );

      effects.playHabitAudio$.subscribe(() => {
        callCount++;
        if (callCount === 2) {
          setTimeout(() => {
            expect(mockAudioPlayer.playSound).toHaveBeenCalledTimes(2);
            done();
          }, 100);
        }
      });
    });

    // --- Per-counter sound overrides (soundType / soundVolume) ---

    it('should use per-counter soundType instead of global doneSound when set', (done) => {
      const counterWithCustomSound = {
        ...mockCountdownCounter,
        isOn: false,
        soundType: 'copper-bell-ding.mp3',
      };

      store.overrideSelector(selectSimpleCounterById, counterWithCustomSound);

      actions$ = of(setSimpleCounterCounterOff({ id: counterWithCustomSound.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith(
            'copper-bell-ding.mp3',
            80,
          );
          done();
        }, 50);
      });
    });

    it('should use per-counter soundVolume instead of global volume when set', (done) => {
      const counterWithCustomVolume = {
        ...mockCountdownCounter,
        isOn: false,
        soundVolume: 30,
      };

      store.overrideSelector(selectSimpleCounterById, counterWithCustomVolume);

      actions$ = of(setSimpleCounterCounterOff({ id: counterWithCustomVolume.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 30);
          done();
        }, 50);
      });
    });

    it('should use both per-counter soundType and soundVolume when both are set', (done) => {
      const counterWithAllCustom = {
        ...mockStopwatchCounter,
        isOn: false,
        soundType: 'done1.mp3',
        soundVolume: 55,
      };

      store.overrideSelector(selectSimpleCounterById, counterWithAllCustom);

      actions$ = of(setSimpleCounterCounterOff({ id: counterWithAllCustom.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('done1.mp3', 55);
          done();
        }, 50);
      });
    });

    it('should fall back to global config when counter has no soundType or soundVolume', (done) => {
      const counterNoOverrides = {
        ...mockCountdownCounter,
        isOn: false,
        soundType: undefined,
        soundVolume: undefined,
      };

      store.overrideSelector(selectSimpleCounterById, counterNoOverrides);

      actions$ = of(setSimpleCounterCounterOff({ id: counterNoOverrides.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockAudioPlayer.playSound).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should NOT play audio when per-counter soundVolume is 0', (done) => {
      const counterSilent = {
        ...mockCountdownCounter,
        isOn: false,
        soundVolume: 0,
      };

      store.overrideSelector(selectSimpleCounterById, counterSilent);

      actions$ = of(setSimpleCounterCounterOff({ id: counterSilent.id }));

      // The pipeline passes through (tap short-circuits on volume <= 0) but
      // playSound must never be called.
      effects.playHabitAudio$.subscribe();

      setTimeout(() => {
        expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    // --- Custom sound (custom: prefix) path ---

    it('should call playSoundFromBuffer for a custom: soundType', (done) => {
      const storedSound = makeStoredSound('my-bell');
      mockCustomSoundService.getSound.and.returnValue(Promise.resolve(storedSound));

      const counterCustom = {
        ...mockCountdownCounter,
        isOn: false,
        soundType: 'custom:my-bell',
      };
      store.overrideSelector(selectSimpleCounterById, counterCustom);
      actions$ = of(setSimpleCounterCounterOff({ id: counterCustom.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockCustomSoundService.getSound).toHaveBeenCalledWith('my-bell');
          expect(mockAudioPlayer.playSoundFromBuffer).toHaveBeenCalledWith(
            'custom:my-bell',
            storedSound.arrayBuffer,
            80,
          );
          expect(mockAudioPlayer.playSound).not.toHaveBeenCalled();
          done();
        }, 50);
      });
    });

    it('should NOT call playSoundFromBuffer when custom sound is not found in IDB', (done) => {
      mockCustomSoundService.getSound.and.returnValue(Promise.resolve(undefined));

      const counterMissing = {
        ...mockCountdownCounter,
        isOn: false,
        soundType: 'custom:missing',
      };
      store.overrideSelector(selectSimpleCounterById, counterMissing);
      actions$ = of(setSimpleCounterCounterOff({ id: counterMissing.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(mockCustomSoundService.getSound).toHaveBeenCalledWith('missing');
          expect(mockAudioPlayer.playSoundFromBuffer).not.toHaveBeenCalled();
          done();
        }, 50);
      });
    });
  });

  // --- Unit tests for the pure helper resolveCounterSoundCfg ---

  describe('resolveCounterSoundCfg', () => {
    const globalCfg: SoundConfig = {
      isIncreaseDoneSoundPitch: false,
      doneSound: 'positive.mp3',
      breakReminderSound: 'bell.mp3',
      trackTimeSound: 'tick.mp3',
      volume: 80,
    };

    const baseCounter = {
      id: 'x',
      title: 'X',
      isEnabled: true,
      icon: null,
      type: SimpleCounterType.StopWatch,
      isAudioEnabled: true,
      isOn: false,
      countOnDay: {},
    };

    it('should use global doneSound and volume when counter has no overrides', () => {
      const result = resolveCounterSoundCfg(baseCounter as any, globalCfg);
      expect(result.file).toBe('positive.mp3');
      expect(result.volume).toBe(80);
    });

    it('should use counter soundType over global doneSound', () => {
      const result = resolveCounterSoundCfg(
        { ...baseCounter, soundType: 'done1.mp3' } as any,
        globalCfg,
      );
      expect(result.file).toBe('done1.mp3');
    });

    it('should use counter soundVolume over global volume', () => {
      const result = resolveCounterSoundCfg(
        { ...baseCounter, soundVolume: 30 } as any,
        globalCfg,
      );
      expect(result.volume).toBe(30);
    });

    it('should allow soundVolume of 0 (caller must check volume > 0)', () => {
      const result = resolveCounterSoundCfg(
        { ...baseCounter, soundVolume: 0 } as any,
        globalCfg,
      );
      expect(result.volume).toBe(0);
    });

    it('should use both counter overrides together', () => {
      const result = resolveCounterSoundCfg(
        { ...baseCounter, soundType: 'copper-bell-ding.mp3', soundVolume: 55 } as any,
        globalCfg,
      );
      expect(result.file).toBe('copper-bell-ding.mp3');
      expect(result.volume).toBe(55);
    });
  });
});
