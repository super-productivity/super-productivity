import { playDoneSound } from './play-done-sound';
import { clearAudioBufferCache, closeAudioContext } from '../../../util/audio-context';
import { SoundConfig } from '../../config/global-config.model';

describe('playDoneSound', () => {
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;
  let mockSource: { detune: { value: number }; [key: string]: unknown };

  const BASE_CFG: SoundConfig = {
    isIncreaseDoneSoundPitch: true,
    doneSound: 'ding-small-bell.mp3',
    breakReminderSound: null,
    volume: 75,
  };

  /** Plays the sound through mocked Web Audio nodes and returns the applied detune (cents). */
  const getDetune = async (cfg: SoundConfig, nrOfDoneTasks?: number): Promise<number> => {
    await playDoneSound(cfg, nrOfDoneTasks);
    return mockSource.detune.value;
  };

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;

    mockSource = {
      detune: { value: 0 },
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      start: jasmine.createSpy('start'),
      buffer: null,
      onended: null,
    };
    const mockContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.resolveTo(undefined),
      close: jasmine.createSpy('close'),
      decodeAudioData: jasmine
        .createSpy('decodeAudioData')
        .and.resolveTo({} as AudioBuffer),
      createBufferSource: jasmine
        .createSpy('createBufferSource')
        .and.returnValue(mockSource),
      createGain: jasmine.createSpy('createGain').and.returnValue({
        connect: jasmine.createSpy('connect'),
        disconnect: jasmine.createSpy('disconnect'),
        gain: { value: 1 },
      }),
      destination: {} as AudioDestinationNode,
    };
    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockContext);
    (window as any).fetch = jasmine.createSpy('fetch').and.resolveTo({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);

    closeAudioContext();
    clearAudioBufferCache();
  });

  afterEach(() => {
    closeAudioContext();
    (window as any).AudioContext = originalAudioContext;
    (window as any).fetch = originalFetch;
  });

  describe('when increase-pitch is disabled (#8265)', () => {
    const cfg: SoundConfig = { ...BASE_CFG, isIncreaseDoneSoundPitch: false };

    it('never shifts pitch — plays the natural sample regardless of done-task count', async () => {
      expect(await getDetune(cfg, 0)).toBe(0);
      expect(await getDetune(cfg, 20)).toBe(0);
    });

    it('matches the enabled mode’s first-ding pitch', async () => {
      const disabled = await getDetune(cfg);
      const enabledFirstTask = await getDetune(BASE_CFG, 0);
      expect(disabled).toBe(enabledFirstTask);
    });
  });

  describe('when increase-pitch is enabled', () => {
    it('starts at the natural pitch and only ever rises', async () => {
      expect(await getDetune(BASE_CFG, 0)).toBe(0);
      expect(await getDetune(BASE_CFG, 1)).toBe(50);
    });

    it('clamps to the maximum pitch', async () => {
      expect(await getDetune(BASE_CFG, 1000)).toBe(300);
    });
  });
});
