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

  it('should leave voice null when no voices are available so the browser uses its default', () => {
    const cancelSpy = jasmine.createSpy('cancel');
    const speakSpy = jasmine.createSpy('speak');

    const mockSynth = {
      cancel: cancelSpy,
      speak: speakSpy,
      getVoices: () => [],
    };

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

  it('should log an error if speechSynthesis is not available', () => {
    spyOn(Log, 'err');

    spyOnProperty(window, 'speechSynthesis', 'get').and.returnValue(undefined as any);

    speak('hello', 50, 'Test Voice');

    expect(Log.err).toHaveBeenCalledWith('No window.speechSynthesis available.');
  });
});
