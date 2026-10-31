import { startLoopingAlarm, stopLoopingAlarm } from './looping-alarm';
import { closeAudioContext } from './audio-context';

const SOUND = 'positive.mp3';

describe('looping-alarm', () => {
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;
  let mockContext: any;
  let createdSources: any[];

  const makeSource = (): any => ({
    connect: jasmine.createSpy('connect'),
    disconnect: jasmine.createSpy('disconnect'),
    start: jasmine.createSpy('start'),
    stop: jasmine.createSpy('stop'),
    buffer: null,
    loop: false,
  });

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;
    createdSources = [];

    const mockGainNode = {
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      gain: { value: 1 },
    };
    mockContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
      close: jasmine.createSpy('close'),
      createBufferSource: jasmine.createSpy('createBufferSource').and.callFake(() => {
        const s = makeSource();
        createdSources.push(s);
        return s;
      }),
      createGain: jasmine.createSpy('createGain').and.returnValue(mockGainNode),
      decodeAudioData: jasmine
        .createSpy('decodeAudioData')
        .and.returnValue(Promise.resolve({} as AudioBuffer)),
      destination: {} as AudioDestinationNode,
    };
    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockContext);
    (window as any).fetch = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    );

    // Reset module-level audio-context state (context + buffer cache).
    closeAudioContext();
  });

  afterEach(() => {
    stopLoopingAlarm();
    (window as any).AudioContext = originalAudioContext;
    (window as any).fetch = originalFetch;
  });

  it('starts a looping source at the given volume', async () => {
    await startLoopingAlarm(SOUND, 50);

    expect(createdSources.length).toBe(1);
    const source = createdSources[0];
    expect(source.loop).toBe(true);
    expect(source.start).toHaveBeenCalledWith(0);
    expect(mockContext.createGain).toHaveBeenCalled();
  });

  it('stops and disconnects the active source on stop', async () => {
    await startLoopingAlarm(SOUND, 100);
    const source = createdSources[0];

    stopLoopingAlarm();

    expect(source.stop).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
  });

  it('stops the previous source when restarted, so no loop can leak', async () => {
    await startLoopingAlarm(SOUND, 100);
    const first = createdSources[0];

    await startLoopingAlarm(SOUND, 100);

    expect(first.stop).toHaveBeenCalled();
    expect(createdSources.length).toBe(2);
  });

  it('stops its own loop when given the active token', async () => {
    const token = await startLoopingAlarm(SOUND, 100);

    stopLoopingAlarm(token);

    expect(createdSources[0].stop).toHaveBeenCalled();
  });

  it('does not stop a newer loop when given a stale token', async () => {
    const first = await startLoopingAlarm(SOUND, 100);
    await startLoopingAlarm(SOUND, 100);

    stopLoopingAlarm(first);

    expect(createdSources[1].stop).not.toHaveBeenCalled();
  });

  it('ignores a second stop with the same token', async () => {
    const token = await startLoopingAlarm(SOUND, 100);
    stopLoopingAlarm(token);
    const next = startLoopingAlarm(SOUND, 100);

    stopLoopingAlarm(token);
    await next;

    expect(createdSources.length).toBe(2);
    expect(createdSources[1].stop).not.toHaveBeenCalled();
  });

  it('stops a loop whose caller stopped it before the start resolved', async () => {
    const start = startLoopingAlarm(SOUND, 100);

    await start.then(stopLoopingAlarm);

    expect(createdSources.length).toBe(1);
    expect(createdSources[0].stop).toHaveBeenCalled();
    expect(createdSources[0].disconnect).toHaveBeenCalled();
  });

  it('auto-stops after the hard safety ceiling', async () => {
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    jasmine.clock().install();
    try {
      await startLoopingAlarm(SOUND, 100);
      const source = createdSources[0];
      expect(source.stop).not.toHaveBeenCalled();

      jasmine.clock().tick(TEN_MINUTES_MS + 1);

      expect(source.stop).toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('does not throw when stop is called with no active alarm', () => {
    expect(() => stopLoopingAlarm()).not.toThrow();
  });
});
