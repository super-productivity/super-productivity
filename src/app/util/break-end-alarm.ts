import { ensureAudioContextRunning, getAudioBuffer } from './audio-context';
import { Log } from '../core/log';

const BASE = './assets/snd';

/**
 * Hard safety ceiling for the looping break-end alarm. If the user genuinely
 * walked away, the alarm must not sound forever into an empty room — it stops
 * itself after this long even if no break-leave transition ever arrives.
 * Intentionally non-configurable to keep the feature to a single toggle (#8593).
 */
const MAX_ALARM_DURATION = 10 * 60 * 1000; // 10 minutes

let activeSource: AudioBufferSourceNode | null = null;
let activeGain: GainNode | null = null;
let capTimeoutId: ReturnType<typeof setTimeout> | null = null;
// Monotonic generation counter. Every start() and stop() bumps it, so an
// in-flight start() whose awaits resolve late can detect that a newer start()
// or a stop() has superseded it and bail before creating a second source. This
// guarantees a restart can never leak an orphaned, unstoppable loop — even if
// two starts overlap (the single caller never overlaps them, but the primitive
// is self-contained, so it does not rely on that).
let startToken = 0;

const _teardownNodes = (): void => {
  if (capTimeoutId !== null) {
    clearTimeout(capTimeoutId);
    capTimeoutId = null;
  }
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
};

/**
 * Loops the given sound at the specified volume until stopBreakEndAlarm() is
 * called (or the hard safety ceiling elapses). Any sound already looping is
 * stopped first, so a restart can never leak a second, unstoppable source.
 *
 * NOTE: unlike startWhiteNoise(), this deliberately does NOT call
 * setAudioContextKeepAwake(). The alarm is desktop-oriented — there the
 * AudioContext keeps running while the window is unfocused, which is the whole
 * point (you stepped away from your desk) — and keepAwake is a single-owner
 * flag that white noise relies on. On mobile the context is suspended on
 * app-background (#8243), so the loop stops there by design; the setting is
 * per-device precisely because this behavior differs across platforms.
 *
 * @param filePath - Path to the sound file relative to assets/snd
 * @param volume - Volume level from 0 to 100
 */
export const startBreakEndAlarm = async (
  filePath: string,
  volume: number,
): Promise<void> => {
  // Claim a new generation and stop any current/previous loop synchronously,
  // before the first await, so a rapid start → start can never leave an
  // orphaned source running.
  const myToken = ++startToken;
  _teardownNodes();

  try {
    const ctx = await ensureAudioContextRunning();
    const buffer = await getAudioBuffer(`${BASE}/${filePath}`);
    // A newer start() or a stop() may have superseded us while we awaited.
    if (myToken !== startToken) {
      return;
    }

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

    capTimeoutId = setTimeout(() => stopBreakEndAlarm(), MAX_ALARM_DURATION);
  } catch (e) {
    Log.err('Error starting looping break-end alarm:', e);
    if (myToken === startToken) {
      stopBreakEndAlarm();
    }
  }
};

export const stopBreakEndAlarm = (): void => {
  // Bump the generation so any in-flight start() bails instead of creating a
  // source after we have torn everything down.
  startToken++;
  _teardownNodes();
};
