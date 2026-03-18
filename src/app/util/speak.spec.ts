import { speak, DEFAULT_TTS_RATE } from './speak';
import { Log } from '../core/log';

describe('speak()', () => {
  beforeEach(() => {
    // Fake SpeechSynthesisUtterance constructor
    (window as any).SpeechSynthesisUtterance = function () {
      this.text = '';
      this.voice = null;
      this.volume = 1;
      this.rate = 1;
    };
  });

  // Verifies the happy path: the correct voice is selected, and text, volume, and rate are set properly
  it('should speak with requested voice and correct properties when synth is available', () => {
    const cancelSpy = jasmine.createSpy('cancel');
    const speakSpy = jasmine.createSpy('speak');

    const requestedVoice = { name: 'Test Voice', default: false };
    const defaultVoice = { name: 'Default Voice', default: true };

    const mockSynth = {
      cancel: cancelSpy,
      speak: speakSpy,
      getVoices: () => [requestedVoice, defaultVoice],
    };

    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello world', 50, 'Test Voice');

    expect(cancelSpy).toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalled();

    const utterance = speakSpy.calls.mostRecent().args[0];

    expect(utterance.text).toBe('hello world');
    expect(utterance.volume).toBe(0.5);
    expect(utterance.rate).toBe(DEFAULT_TTS_RATE);
    expect(utterance.voice).toBe(requestedVoice);
  });

  // Verifies that if the requested voice name doesn't match any available voice, the browser's default voice is used instead
  it('should fall back to the default voice when the requested voice is not found', () => {
    const cancelSpy = jasmine.createSpy('cancel');
    const speakSpy = jasmine.createSpy('speak');

    const notRequestedVoice = { name: 'Not Requested Voice', default: false };
    const defaultVoice = { name: 'Default Voice', default: true };

    const mockSynth = {
      cancel: cancelSpy,
      speak: speakSpy,
      getVoices: () => [notRequestedVoice, defaultVoice],
    };

    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello world', 50, 'Test Voice');

    expect(cancelSpy).toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalled();

    const utterance = speakSpy.calls.mostRecent().args[0];

    expect(utterance.text).toBe('hello world');
    expect(utterance.volume).toBe(0.5);
    expect(utterance.rate).toBe(DEFAULT_TTS_RATE);
    expect(utterance.voice).toBe(defaultVoice);
  });

  // Verifies that when no voices are available at all, the voice is set to null so the browser picks its own default
  it('should leave voice null when no voices are available so the browser uses its default', () => {
    const cancelSpy = jasmine.createSpy('cancel');
    const speakSpy = jasmine.createSpy('speak');

    const mockSynth = {
      cancel: cancelSpy,
      speak: speakSpy,
      getVoices: () => [],
    };

    mockSynth.getVoices = () => [];

    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello world', 50, 'Any Voice');

    expect(mockSynth.cancel).toHaveBeenCalled();
    expect(mockSynth.speak).toHaveBeenCalled();

    const utterance = mockSynth.speak.calls.mostRecent().args[0];

    expect(utterance.text).toBe('hello world');
    expect(utterance.volume).toBe(0.5);
    expect(utterance.rate).toBe(DEFAULT_TTS_RATE);
    expect(utterance.voice).toBeNull();
  });

  // Verifies that a negative volume is clamped to 0 (the minimum), resulting in a normalized value of 0
  it('should clamp volume to 0 when a negative value is passed', () => {
    const speakSpy = jasmine.createSpy('speak');
    const mockSynth = {
      cancel: jasmine.createSpy('cancel'),
      speak: speakSpy,
      getVoices: () => [{ name: 'V', default: true }],
    };
    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello', -10, 'V');

    const utterance = speakSpy.calls.mostRecent().args[0];
    expect(utterance.volume).toBe(0);
  });

  // Verifies that a volume as null is clamped to 0 (the minimum), resulting in a normalized value of 1
  it('should clamp volume to 0 when null is passed', () => {
    const speakSpy = jasmine.createSpy('speak');
    const mockSynth = {
      cancel: jasmine.createSpy('cancel'),
      speak: speakSpy,
      getVoices: () => [{ name: 'V', default: true }],
    };
    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello', null as any, 'V');

    const utterance = speakSpy.calls.mostRecent().args[0];
    expect(utterance.volume).toBe(0);
  });

  // Verifies that a volume above 100 is clamped to 100 (the maximum), resulting in a normalized value of 1
  it('should clamp volume to 100 when a value above 100 is passed', () => {
    const speakSpy = jasmine.createSpy('speak');
    const mockSynth = {
      cancel: jasmine.createSpy('cancel'),
      speak: speakSpy,
      getVoices: () => [{ name: 'V', default: true }],
    };
    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(mockSynth as any);

    speak('hello', 200, 'V');

    const utterance = speakSpy.calls.mostRecent().args[0];
    expect(utterance.volume).toBe(1);
  });

  // Verifies that passing a non-string value (e.g. a number) for the voice parameter logs an error
  it('should log an error if voice is not a string', () => {
    spyOn(Log, 'err');

    speak('hello', 50, 123 as any);

    expect(Log.err).toHaveBeenCalledWith('voice must be a string');
  });

  // Verifies that passing null for voice also triggers the type validation error
  it('should log an error if voice is null', () => {
    spyOn(Log, 'err');

    speak('hello', 50, null as any);

    expect(Log.err).toHaveBeenCalledWith('voice must be a string');
  });

  // Verifies that passing a non-string value (e.g. a number) for the text parameter logs an error
  it('should log an error if text is not a string', () => {
    spyOn(Log, 'err');

    speak(123 as any, 50, 'Test Voice');

    expect(Log.err).toHaveBeenCalledWith('text must be a string');
  });

  // Verifies that passing null for text also triggers the type validation error
  it('should log an error if text is null', () => {
    spyOn(Log, 'err');

    speak(null as any, 50, 'Test Voice');

    expect(Log.err).toHaveBeenCalledWith('text must be a string');
  });

  // Verifies that a meaningful error is logged when the browser doesn't support speechSynthesis
  it('should log an error if speechSynthesis is not available', () => {
    spyOn(Log, 'err');

    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(undefined as any);

    speak('hello', 50, 'Test Voice');

    expect(Log.err).toHaveBeenCalledWith('No window.speechSynthesis available.');
  });
});
