import { Log } from '../core/log';

// Set a default TTS rate of 0.7 to improve speech clarity for longer sentences
// fast enough to not feel sluggish, yet slow enough to remain intelligible
export const DEFAULT_TTS_RATE = 0.7;

export const speak = (text: string, volume: number, voice: string): void => {
  const synth = window.speechSynthesis;

  if (!synth) {
    Log.err('No window.speechSynthesis available.');
    return;
  }

  synth.cancel();
  const utter = new SpeechSynthesisUtterance();
  utter.text = text;
  utter.voice =
    synth.getVoices().find((v) => voice.includes(v.name)) ||
    synth.getVoices().find((v) => v.default) ||
    null;

  utter.volume = volume / 100;
  utter.rate = DEFAULT_TTS_RATE;

  synth.speak(utter);
};
