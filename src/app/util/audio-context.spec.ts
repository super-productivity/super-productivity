import {
  getAudioContext,
  getAudioBuffer,
  clearAudioBufferCache,
  closeAudioContext,
  unlockAudioContext,
  ensureAudioContextRunning,
  playBuffer,
} from './audio-context';

describe('audio-context', () => {
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;
  let mockCloseContext: jasmine.Spy;

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;

    // Create a mock context that has the close method
    mockCloseContext = jasmine.createSpy('close');
    const mockContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
      close: mockCloseContext,
    };
    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockContext);

    // Reset the module state
    closeAudioContext();
    // Now we can set up our real test mocks
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    (window as any).fetch = originalFetch;
  });

  describe('getAudioContext', () => {
    it('should create an AudioContext if none exists', () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      const ctx = getAudioContext();

      expect((window as any).AudioContext).toHaveBeenCalled();
      expect(ctx).toBe(mockContext as unknown as AudioContext);
    });

    it('should return the same AudioContext on subsequent calls', () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      const ctx1 = getAudioContext();
      const ctx2 = getAudioContext();

      expect((window as any).AudioContext).toHaveBeenCalledTimes(1);
      expect(ctx1).toBe(ctx2);
    });

    it('should not resume the context automatically', () => {
      const mockContext = {
        state: 'suspended',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      getAudioContext();

      expect(mockContext.resume).not.toHaveBeenCalled();
    });
  });

  describe('ensureAudioContextRunning', () => {
    it('should resume the context if suspended', async () => {
      const mockContext = {
        state: 'suspended',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      const ctx = await ensureAudioContextRunning();

      expect(mockContext.resume).toHaveBeenCalled();
      expect(ctx).toBe(mockContext as unknown as AudioContext);
    });

    it('should not resume if context is running', async () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      const ctx = await ensureAudioContextRunning();

      expect(mockContext.resume).not.toHaveBeenCalled();
      expect(ctx).toBe(mockContext as unknown as AudioContext);
    });
  });

  describe('getAudioBuffer', () => {
    let mockContext: any;
    let mockArrayBuffer: ArrayBuffer;
    let mockAudioBuffer: AudioBuffer;
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
      mockArrayBuffer = new ArrayBuffer(8);
      mockAudioBuffer = {} as AudioBuffer;

      mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
        decodeAudioData: jasmine
          .createSpy('decodeAudioData')
          .and.returnValue(Promise.resolve(mockAudioBuffer)),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      // Create fetch spy by assigning directly to window.fetch
      fetchSpy = jasmine.createSpy('fetch').and.returnValue(
        Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        } as Response),
      );
      (window as any).fetch = fetchSpy;
    });

    it('should fetch and decode audio on first call', async () => {
      const buffer = await getAudioBuffer('./assets/snd/test.mp3');

      expect(fetchSpy).toHaveBeenCalledWith('./assets/snd/test.mp3');
      expect(mockContext.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);
      expect(buffer).toBe(mockAudioBuffer);
    });

    it('should return cached buffer on subsequent calls', async () => {
      await getAudioBuffer('./assets/snd/test.mp3');
      const buffer = await getAudioBuffer('./assets/snd/test.mp3');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(buffer).toBe(mockAudioBuffer);
    });

    it('should cache different files separately', async () => {
      await getAudioBuffer('./assets/snd/test1.mp3');
      await getAudioBuffer('./assets/snd/test2.mp3');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledWith('./assets/snd/test1.mp3');
      expect(fetchSpy).toHaveBeenCalledWith('./assets/snd/test2.mp3');
    });

    it('should throw on non-ok response', async () => {
      fetchSpy.and.returnValue(Promise.resolve({ ok: false, status: 404 } as Response));

      await expectAsync(getAudioBuffer('./assets/snd/missing.mp3')).toBeRejectedWithError(
        /Failed to fetch audio file.*404/,
      );
    });
  });

  describe('playBuffer', () => {
    let mockContext: any;
    let mockBufferSource: any;
    let mockGainNode: any;
    let mockAudioBuffer: AudioBuffer;

    beforeEach(() => {
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
      mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
        createBufferSource: jasmine
          .createSpy('createBufferSource')
          .and.returnValue(mockBufferSource),
        createGain: jasmine.createSpy('createGain').and.returnValue(mockGainNode),
        destination: {} as AudioDestinationNode,
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);
    });

    it('should create a buffer source and start playback', async () => {
      await playBuffer(mockAudioBuffer);

      expect(mockContext.createBufferSource).toHaveBeenCalled();
      expect(mockBufferSource.buffer).toBe(mockAudioBuffer);
      expect(mockBufferSource.start).toHaveBeenCalledWith(0);
    });

    it('should connect directly to destination at full volume', async () => {
      await playBuffer(mockAudioBuffer, 100);

      expect(mockBufferSource.connect).toHaveBeenCalledWith(mockContext.destination);
      expect(mockContext.createGain).not.toHaveBeenCalled();
    });

    it('should use gain node for volume adjustment', async () => {
      await playBuffer(mockAudioBuffer, 50);

      expect(mockContext.createGain).toHaveBeenCalled();
      expect(mockGainNode.gain.value).toBe(0.5);
      expect(mockBufferSource.connect).toHaveBeenCalledWith(mockGainNode);
      expect(mockGainNode.connect).toHaveBeenCalledWith(mockContext.destination);
    });

    it('should call configureSource callback before start', async () => {
      const configure = jasmine.createSpy('configureSource');

      await playBuffer(mockAudioBuffer, 100, configure);

      expect(configure).toHaveBeenCalledWith(mockBufferSource);
      expect(mockBufferSource.start).toHaveBeenCalledWith(0);
    });

    it('should set onended handler that disconnects nodes', async () => {
      await playBuffer(mockAudioBuffer, 50);

      expect(mockBufferSource.onended).toBeDefined();
      mockBufferSource.onended!();

      expect(mockBufferSource.disconnect).toHaveBeenCalled();
      expect(mockGainNode.disconnect).toHaveBeenCalled();
    });
  });

  describe('clearAudioBufferCache', () => {
    it('should clear the buffer cache', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = {} as AudioBuffer;
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
        decodeAudioData: jasmine
          .createSpy('decodeAudioData')
          .and.returnValue(Promise.resolve(mockAudioBuffer)),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      // Create fetch spy by assigning directly to window.fetch
      const fetchSpy = jasmine.createSpy('fetch').and.returnValue(
        Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        } as Response),
      );
      (window as any).fetch = fetchSpy;

      await getAudioBuffer('./assets/snd/test.mp3');
      clearAudioBufferCache();
      await getAudioBuffer('./assets/snd/test.mp3');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('unlockAudioContext', () => {
    let addEventSpy: jasmine.Spy;

    beforeEach(() => {
      addEventSpy = spyOn(document, 'addEventListener').and.callThrough();
    });

    it('should add touchend and click event listeners', () => {
      unlockAudioContext();

      expect(addEventSpy).toHaveBeenCalledWith(
        'touchend',
        jasmine.any(Function),
        jasmine.objectContaining({ once: true }),
      );
      expect(addEventSpy).toHaveBeenCalledWith(
        'click',
        jasmine.any(Function),
        jasmine.objectContaining({ once: true }),
      );
    });

    it('should create and resume AudioContext on user gesture', () => {
      const mockResume = jasmine.createSpy('resume').and.returnValue(Promise.resolve());
      const mockContext = {
        state: 'suspended',
        resume: mockResume,
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      unlockAudioContext();
      document.dispatchEvent(new Event('touchend'));

      expect((window as any).AudioContext).toHaveBeenCalled();
      expect(mockResume).toHaveBeenCalled();
    });

    it('should be idempotent — calling twice does not double-register', () => {
      unlockAudioContext();
      unlockAudioContext();

      const touchendCalls = addEventSpy.calls
        .allArgs()
        .filter((args: any[]) => args[0] === 'touchend');
      expect(touchendCalls.length).toBe(1);
    });
  });

  describe('closeAudioContext', () => {
    it('should close the context and clear cache', () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      getAudioContext();
      closeAudioContext();

      expect(mockContext.close).toHaveBeenCalled();

      // Verify a new context is created after close
      const newMockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(newMockContext);

      const ctx = getAudioContext();
      expect(ctx).toBe(newMockContext as unknown as AudioContext);
    });
  });
});
