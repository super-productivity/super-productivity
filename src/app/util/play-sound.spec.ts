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
      resume: jasmine.createSpy('resume'),
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

  it('should create an AudioContext', (done) => {
    playSound('test.mp3');

    setTimeout(() => {
      expect((window as any).AudioContext).toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should fetch the audio file', (done) => {
    playSound('test.mp3');

    setTimeout(() => {
      expect(fetchSpy).toHaveBeenCalledWith('./assets/snd/test.mp3');
      done();
    }, 10);
  });

  it('should create a new buffer source for each playback', (done) => {
    playSound('test.mp3');

    setTimeout(() => {
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should start playback after buffer is assigned', (done) => {
    playSound('test.mp3');

    setTimeout(() => {
      expect(mockBufferSource.start).toHaveBeenCalledWith(0);
      done();
    }, 10);
  });

  it('should connect directly to destination at full volume', (done) => {
    playSound('test.mp3', 100);

    setTimeout(() => {
      expect(mockBufferSource.connect).toHaveBeenCalledWith(mockAudioContext.destination);
      expect(mockAudioContext.createGain).not.toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should use gain node for volume adjustment', (done) => {
    playSound('test.mp3', 50);

    setTimeout(() => {
      expect(mockAudioContext.createGain).toHaveBeenCalled();
      expect(mockGainNode.gain.value).toBe(0.5);
      expect(mockBufferSource.connect).toHaveBeenCalledWith(mockGainNode);
      expect(mockGainNode.connect).toHaveBeenCalledWith(mockAudioContext.destination);
      done();
    }, 10);
  });

  it('should handle errors gracefully', (done) => {
    const consoleErrorSpy = spyOn(console, 'error');
    fetchSpy.and.returnValue(Promise.reject(new Error('Test error')));

    playSound('nonexistent.mp3');

    setTimeout(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should reuse the same AudioContext for multiple sounds', (done) => {
    playSound('test1.mp3');

    setTimeout(() => {
      playSound('test2.mp3');

      setTimeout(() => {
        // AudioContext should only be created once
        expect((window as any).AudioContext).toHaveBeenCalledTimes(1);
        done();
      }, 10);
    }, 10);
  });

  it('should cache audio buffers and not re-fetch', (done) => {
    playSound('cached-test.mp3');

    setTimeout(() => {
      // Reset createBufferSource call count to verify it's called again
      mockAudioContext.createBufferSource.calls.reset();
      mockBufferSource.connect.calls.reset();
      mockBufferSource.start.calls.reset();

      playSound('cached-test.mp3');

      setTimeout(() => {
        // Fetch should only be called once for the same file
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        // But we should still create a new buffer source (required by Web Audio API)
        expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
        done();
      }, 10);
    }, 10);
  });

  it('should set onended handler to clean up audio nodes', (done) => {
    playSound('test.mp3');

    setTimeout(() => {
      expect(mockBufferSource.onended).toBeDefined();
      expect(typeof mockBufferSource.onended).toBe('function');
      done();
    }, 10);
  });

  it('should disconnect source node when onended is called', (done) => {
    playSound('test.mp3', 100);

    setTimeout(() => {
      // Trigger the onended handler
      if (mockBufferSource.onended) {
        mockBufferSource.onended();
      }

      expect(mockBufferSource.disconnect).toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should disconnect both source and gain nodes when using volume adjustment', (done) => {
    playSound('test.mp3', 50);

    setTimeout(() => {
      // Trigger the onended handler
      if (mockBufferSource.onended) {
        mockBufferSource.onended();
      }

      expect(mockBufferSource.disconnect).toHaveBeenCalled();
      expect(mockGainNode.disconnect).toHaveBeenCalled();
      done();
    }, 10);
  });
});
