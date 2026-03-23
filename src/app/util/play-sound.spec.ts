import { playSound } from './play-sound';
import { closeAudioContext } from './audio-context';

describe('playSound', () => {
  let mockAudioContext: any;
  let mockGainNode: any;
  let mockBufferSource: any;
  let mockAudioBuffer: AudioBuffer;
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;

    mockGainNode = {
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      gain: { value: 1 },
    };

    mockBufferSource = {
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      start: jasmine.createSpy('start'),
      buffer: null,
      onended: null as (() => void) | null,
    };

    mockAudioBuffer = {} as AudioBuffer;

    mockAudioContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
      close: jasmine.createSpy('close'),
      createBufferSource: jasmine
        .createSpy('createBufferSource')
        .and.returnValue(mockBufferSource),
      createGain: jasmine.createSpy('createGain').and.returnValue(mockGainNode),
      destination: {} as AudioDestinationNode,
      decodeAudioData: jasmine
        .createSpy('decodeAudioData')
        .and.callFake(() => Promise.resolve(mockAudioBuffer)),
    };

    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockAudioContext);

    // Create fetch spy by assigning a jasmine spy directly to window.fetch
    fetchSpy = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as Response),
    );
    (window as any).fetch = fetchSpy;

    // Reset the singleton and cache for each test
    closeAudioContext();
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    (window as any).fetch = originalFetch;
    closeAudioContext();
  });

  it('should create an AudioContext', async () => {
    await playSound('test.mp3');

    expect((window as any).AudioContext).toHaveBeenCalled();
  });

  it('should fetch the audio file', async () => {
    await playSound('test.mp3');

    expect(fetchSpy).toHaveBeenCalledWith('./assets/snd/test.mp3');
  });

  it('should create a new buffer source for each playback', async () => {
    await playSound('test.mp3');

    expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
  });

  it('should start playback after buffer is assigned', async () => {
    await playSound('test.mp3');

    expect(mockBufferSource.start).toHaveBeenCalledWith(0);
  });

  it('should connect directly to destination at full volume', async () => {
    await playSound('test.mp3', 100);

    expect(mockBufferSource.connect).toHaveBeenCalledWith(mockAudioContext.destination);
    expect(mockAudioContext.createGain).not.toHaveBeenCalled();
  });

  it('should use gain node for volume adjustment', async () => {
    await playSound('test.mp3', 50);

    expect(mockAudioContext.createGain).toHaveBeenCalled();
    expect(mockGainNode.gain.value).toBe(0.5);
    expect(mockBufferSource.connect).toHaveBeenCalledWith(mockGainNode);
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockAudioContext.destination);
  });

  it('should handle errors gracefully', async () => {
    const consoleErrorSpy = spyOn(console, 'error');
    fetchSpy.and.returnValue(Promise.reject(new Error('Test error')));

    await playSound('nonexistent.mp3');

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should reuse the same AudioContext for multiple sounds', async () => {
    await playSound('test1.mp3');
    await playSound('test2.mp3');

    expect((window as any).AudioContext).toHaveBeenCalledTimes(1);
  });

  it('should cache audio buffers and not re-fetch', async () => {
    await playSound('cached-test.mp3');

    mockAudioContext.createBufferSource.calls.reset();
    mockBufferSource.connect.calls.reset();
    mockBufferSource.start.calls.reset();

    await playSound('cached-test.mp3');

    // Fetch should only be called once for the same file
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // But we should still create a new buffer source (required by Web Audio API)
    expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
  });

  it('should set onended handler to clean up audio nodes', async () => {
    await playSound('test.mp3');

    expect(mockBufferSource.onended).toBeDefined();
    expect(typeof mockBufferSource.onended).toBe('function');
  });

  it('should disconnect source node when onended is called', async () => {
    await playSound('test.mp3', 100);

    if (mockBufferSource.onended) {
      mockBufferSource.onended();
    }

    expect(mockBufferSource.disconnect).toHaveBeenCalled();
  });

  it('should disconnect both source and gain nodes when using volume adjustment', async () => {
    await playSound('test.mp3', 50);

    if (mockBufferSource.onended) {
      mockBufferSource.onended();
    }

    expect(mockBufferSource.disconnect).toHaveBeenCalled();
    expect(mockGainNode.disconnect).toHaveBeenCalled();
  });

  it('should resume a suspended AudioContext before playing', async () => {
    mockAudioContext.state = 'suspended';

    await playSound('test.mp3');

    expect(mockAudioContext.resume).toHaveBeenCalled();
    expect(mockBufferSource.start).toHaveBeenCalledWith(0);
  });
});
