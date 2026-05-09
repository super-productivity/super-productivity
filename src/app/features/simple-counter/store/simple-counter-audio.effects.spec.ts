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
import { playSound } from '../../../util/play-sound';
import { SimpleCounterType } from '../simple-counter.model';
import { SoundConfig } from '../../config/global-config.model';

/**
 * Unit tests for SimpleCounterAudioEffects
 * Tests audio feedback triggering for habit session start/stop using marble testing
 */
describe('SimpleCounterAudioEffects', () => {
  let actions$: Observable<Action>;
  let effects: SimpleCounterAudioEffects;
  let store: MockStore;
  let playSoundSpy: jasmine.Spy;

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
    TestBed.configureTestingModule({
      providers: [
        SimpleCounterAudioEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {},
        }),
      ],
    });

    effects = TestBed.inject(SimpleCounterAudioEffects);
    store = TestBed.inject(MockStore);
    playSoundSpy = spyOn(playSound, 'call').and.returnValue(Promise.resolve());

    // Mock store selectors
    store.overrideSelector(selectSoundConfig, mockSoundConfig);
  });

  afterEach(() => {
    playSoundSpy.calls.reset();
  });

  describe('playHabitAudio$ effect', () => {
    it('should play audio when countdown stops (isOn: false)', (done) => {
      const countdownCounterInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownCounterInactive);

      actions$ = of(setSimpleCounterCounterOff({ id: countdownCounterInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).toHaveBeenCalledWith('positive.mp3', 80);
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
          expect(playSoundSpy).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should NOT play audio when click counter is toggled', (done) => {
      store.overrideSelector(selectSimpleCounterById, mockClickCounter);

      actions$ = of(toggleSimpleCounterCounter({ id: mockClickCounter.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).not.toHaveBeenCalled();
          done();
        }, 50);
      });
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
          expect(playSoundSpy).not.toHaveBeenCalled();
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

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).not.toHaveBeenCalled();
          done();
        }, 50);
      });
    });

    it('should play audio when counter starts (isOn: true)', (done) => {
      const countdownActive = { ...mockCountdownCounter, isOn: true };

      store.overrideSelector(selectSimpleCounterById, countdownActive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownActive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).toHaveBeenCalledWith('positive.mp3', 80);
          done();
        }, 50);
      });
    });

    it('should NOT play audio when sound config is missing', (done) => {
      store.overrideSelector(selectSoundConfig, null);

      const countdownInactive = { ...mockCountdownCounter, isOn: false };

      store.overrideSelector(selectSimpleCounterById, countdownInactive);

      actions$ = of(toggleSimpleCounterCounter({ id: countdownInactive.id }));

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).not.toHaveBeenCalled();
          done();
        }, 50);
      });
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

      effects.playHabitAudio$.subscribe(() => {
        setTimeout(() => {
          expect(playSoundSpy).not.toHaveBeenCalled();
          done();
        }, 50);
      });
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
          expect(playSoundSpy).toHaveBeenCalledWith('positive.mp3', 45);
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
      const countdown2Inactive = {
        ...mockCountdownCounter,
        id: 'c2',
        isOn: false,
      };

      let callCount = 0;

      store.overrideSelector(selectSimpleCounterById, (action) => {
        if (action.id === 'c1') {
          return countdown1Inactive;
        } else if (action.id === 'c2') {
          return countdown2Inactive;
        }
        return null;
      });

      actions$ = of(
        setSimpleCounterCounterOff({ id: countdown1Inactive.id }),
        setSimpleCounterCounterOff({ id: countdown2Inactive.id }),
      );

      effects.playHabitAudio$.subscribe(() => {
        callCount++;
        if (callCount === 2) {
          setTimeout(() => {
            // Both sounds should be queued (queue handles them sequentially)
            expect(playSoundSpy).toHaveBeenCalledTimes(2);
            done();
          }, 100);
        }
      });
    });
  });
});
