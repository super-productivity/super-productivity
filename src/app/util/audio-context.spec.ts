import {
  getAudioContext,
  getAudioBuffer,
  clearAudioBufferCache,
  closeAudioContext,
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
      resume: jasmine.createSpy('resume'),
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
        resume: jasmine.createSpy('resume'),
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
        resume: jasmine.createSpy('resume'),
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

    it('should resume the context if suspended', () => {
      const mockContext = {
        state: 'suspended',
        resume: jasmine.createSpy('resume'),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      getAudioContext();

      expect(mockContext.resume).toHaveBeenCalled();
    });

    it('should not resume if context is running', () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume'),
        close: jasmine.createSpy('close'),
      };
      (window as any).AudioContext = jasmine
        .createSpy('AudioContext')
        .and.returnValue(mockContext);

      getAudioContext();

      expect(mockContext.resume).not.toHaveBeenCalled();
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
        resume: jasmine.createSpy('resume'),
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
  });

  describe('clearAudioBufferCache', () => {
    it('should clear the buffer cache', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = {} as AudioBuffer;
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume'),
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

  describe('closeAudioContext', () => {
    it('should close the context and clear cache', () => {
      const mockContext = {
        state: 'running',
        resume: jasmine.createSpy('resume'),
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
        resume: jasmine.createSpy('resume'),
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
