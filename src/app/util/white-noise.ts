import {
  ensureAudioContextRunning,
  setAudioContextKeepAwake,
  suspendAudioContext,
} from './audio-context';

let activeSource: AudioBufferSourceNode | null = null;
let activeGain: GainNode | null = null;
let cachedBuffer: AudioBuffer | null = null;
let startCancelled = false;

const getOrCreateWhiteNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (cachedBuffer) {
    return cachedBuffer;
  }
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 2; // 2-second loop
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // eslint-disable-next-line no-mixed-operators
    data[i] = Math.random() * 2 - 1;
  }
  cachedBuffer = buffer;
  return buffer;
};

export const startWhiteNoise = async (volume: number): Promise<void> => {
  startCancelled = false;
  const ctx = await ensureAudioContextRunning();
  if (startCancelled) {
    return;
  }
  const buffer = getOrCreateWhiteNoiseBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.value = volume / 100;
  source.connect(gain);
  gain.connect(ctx.destination);

  source.start(0);
  activeSource = source;
  activeGain = gain;
  // Keep the context running while backgrounded so the focus sound keeps playing.
  setAudioContextKeepAwake(true);
};

export const stopWhiteNoise = (): void => {
  startCancelled = true;
  setAudioContextKeepAwake(false);
  if (activeSource) {
    try {
      activeSource.stop();
    } catch (_) {
      // source may already be stopped
    }
    activeSource.disconnect();
    activeSource = null;
  }
  if (activeGain) {
    activeGain.disconnect();
    activeGain = null;
  }
  // The only long-lived background sound is gone, so release the audio output
  // stream right away. We may be backgrounded (focus session ended while the app
  // was away), where appStateChange won't fire another suspend; the next playback
  // lazily resumes the context. Without this the silent-but-running context keeps
  // draining until the next foreground/background cycle (#8243).
  suspendAudioContext();
};
