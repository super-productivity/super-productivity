import { Log } from '../core/log';

// Set a default TTS rate of 0.7 to improve speech clarity for longer sentences
// fast enough to not feel sluggish, yet slow enough to remain intelligible
export const DEFAULT_TTS_RATE = 0.7;

export const speak = (text: string, volume: number, voice: string): void => {
  // Validating parameters
  if (typeof text !== 'string') {
    Log.err('text must be a string');
    return;
  }

  if (typeof voice !== 'string') {
    Log.err('voice must be a string');
    return;
  }

  // Ensuring that the volume is always between 0 and 100
  volume = Math.max(0, Math.min(100, volume));

  const synth = window.speechSynthesis;

  if (!synth) {
    Log.err('No window.speechSynthesis available.');
    return;
  }

  // Stop any ongoing speech before starting a new one
  synth.cancel();

  // Create the utterance object that holds what to say and how to say it
  const utter = new SpeechSynthesisUtterance();
  utter.text = text;

  // Voice Selection Logic (Fallback chain):
  // 1. Try to find a voice that matches the user's requested `voice` string
  // 2. If not found, fall back to the browser's default voice
  // 3. If no default is marked (or voices list is empty), set to null so the browser picks its preferred one
  utter.voice =
    synth.getVoices().find((v) => voice.includes(v.name)) ||
    synth.getVoices().find((v) => v.default) ||
    null;

  console.log(volume);

  // Set properties:
  // - volume: API expects 0.0 to 1.0, so we divide the normalized 0-100 value by 100
  // - rate: apply our chosen default speed
  utter.volume = volume / 100;
  utter.rate = DEFAULT_TTS_RATE;

  synth.speak(utter);
};
