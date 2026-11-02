import { setWhiteNoiseVolume, startWhiteNoise, stopWhiteNoise } from './white-noise';
import { closeAudioContext, IDLE_SUSPEND_DELAY_MS } from './audio-context';

describe('white-noise', () => {
  let originalAudioContext: typeof AudioContext;
  let mockContext: any;
  let mockGainNode: any;

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;

    mockGainNode = {
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      gain: { value: 1 },
    };
    mockContext = {
      state: 'running',
      sampleRate: 8,
      resume: jasmine.createSpy('resume').and.returnValue(Promise.resolve()),
      close: jasmine.createSpy('close'),
      suspend: jasmine.createSpy('suspend').and.returnValue(Promise.resolve()),
      createBuffer: jasmine.createSpy('createBuffer').and.callFake(() => ({
        getChannelData: () => new Float32Array(16),
      })),
      createBufferSource: jasmine.createSpy('createBufferSource').and.callFake(() => ({
        connect: jasmine.createSpy('connect'),
        disconnect: jasmine.createSpy('disconnect'),
        start: jasmine.createSpy('start'),
        stop: jasmine.createSpy('stop'),
        buffer: null,
        loop: false,
      })),
      createGain: jasmine.createSpy('createGain').and.returnValue(mockGainNode),
      destination: {} as AudioDestinationNode,
    };
    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockContext);

    // Reset module-level audio-context state.
    closeAudioContext();
  });

  afterEach(() => {
    stopWhiteNoise();
    closeAudioContext();
    (window as any).AudioContext = originalAudioContext;
  });

  it('updates the gain of the running loop', async () => {
    await startWhiteNoise(40);
    expect(mockGainNode.gain.value).toBeCloseTo(0.4);

    setWhiteNoiseVolume(10);

    expect(mockGainNode.gain.value).toBeCloseTo(0.1);
  });

  it('keeps a volume set while the context is still resuming', async () => {
    let resolveResume!: () => void;
    mockContext.state = 'suspended';
    mockContext.resume.and.returnValue(
      new Promise<void>((resolve) => (resolveResume = resolve)),
    );

    const started = startWhiteNoise(40);
    setWhiteNoiseVolume(10);
    resolveResume();
    await started;

    expect(mockContext.createGain).toHaveBeenCalled();
    expect(mockGainNode.gain.value).toBeCloseTo(0.1);
  });

  describe('context hold', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('keeps the context from idle-suspending while playing', async () => {
      await startWhiteNoise(40);

      jasmine.clock().tick(IDLE_SUSPEND_DELAY_MS * 2);

      expect(mockContext.suspend).not.toHaveBeenCalled();
    });

    it('releases the hold on stop', async () => {
      await startWhiteNoise(40);

      stopWhiteNoise();
      jasmine.clock().tick(IDLE_SUSPEND_DELAY_MS);

      expect(mockContext.suspend).toHaveBeenCalledTimes(1);
    });

    it('releases the hold when the start is cancelled while resuming', async () => {
      let resolveResume!: () => void;
      mockContext.state = 'suspended';
      mockContext.resume.and.returnValue(
        new Promise<void>((resolve) => (resolveResume = resolve)),
      );

      const started = startWhiteNoise(40);
      stopWhiteNoise();
      resolveResume();
      await started;
      mockContext.state = 'running';
      jasmine.clock().tick(IDLE_SUSPEND_DELAY_MS);

      expect(mockContext.suspend).toHaveBeenCalledTimes(1);
    });

    it('keeps a single hold when started twice', async () => {
      await startWhiteNoise(40);
      await startWhiteNoise(40);

      stopWhiteNoise();
      jasmine.clock().tick(IDLE_SUSPEND_DELAY_MS);

      expect(mockContext.suspend).toHaveBeenCalledTimes(1);
    });
  });
});
