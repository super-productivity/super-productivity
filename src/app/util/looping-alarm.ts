import { ensureAudioContextRunning, getAudioBuffer } from './audio-context';
import { Log } from '../core/log';

const BASE = './assets/snd';

/**
 * Hard safety ceiling for the looping alarm. If the user genuinely walked away,
 * the alarm must not sound forever into an empty room — it stops itself after
 * this long even if its caller never stops it.
 * Intentionally non-configurable to keep each feature to a single toggle (#8593).
 */
const MAX_ALARM_DURATION = 10 * 60 * 1000; // 10 minutes

let activeSource: AudioBufferSourceNode | null = null;
let activeGain: GainNode | null = null;
let capTimeoutId: ReturnType<typeof setTimeout> | null = null;
// Monotonic generation counter. Every start() and non-stale stop() bumps it, so an
// in-flight start() whose awaits resolve late can detect that a newer start()
// or a stop() has superseded it and bail before creating a second source. This
// guarantees a restart can never leak an orphaned, unstoppable loop — even if
// two starts overlap.
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
 * Loops the given sound at the specified volume until stopLoopingAlarm() is
 * called (or the hard safety ceiling elapses). Shared by the focus-mode
 * break-end alarm and alarm-style reminders on desktop, so only one alarm sounds
 * at a time: any sound already looping is stopped first, so a restart can never
 * leak a second, unstoppable source.
 *
 * NOTE: unlike startWhiteNoise(), this deliberately does NOT call
 * setAudioContextKeepAwake(). The alarm is desktop-oriented — there the
 * AudioContext keeps running while the window is unfocused, which is the whole
 * point (you stepped away from your desk) — and keepAwake is a single-owner
 * flag that white noise relies on. On mobile the context is suspended on
 * app-background (#8243), so the loop stops there by design; the break-end
 * setting is per-device precisely because this behavior differs across
 * platforms, and alarm-style reminders only start the loop on desktop.
 *
 * @param filePath - Path to the sound file relative to assets/snd
 * @param volume - Volume level from 0 to 100
 * @returns This loop's token; pass it to stopLoopingAlarm() to stop only this loop
 */
export const startLoopingAlarm = async (
  filePath: string,
  volume: number,
): Promise<number> => {
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
      return myToken;
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

    capTimeoutId = setTimeout(() => stopLoopingAlarm(myToken), MAX_ALARM_DURATION);
  } catch (e) {
    Log.err('Error starting looping alarm:', e);
    stopLoopingAlarm(myToken);
  }
  return myToken;
};

export const stopLoopingAlarm = (token?: number): void => {
  // A token from an older start() means a newer loop owns the sound: leave it.
  if (token !== undefined && token !== startToken) {
    return;
  }
  // Bump the generation so any in-flight start() bails instead of creating a
  // source after we have torn everything down.
  startToken++;
  _teardownNodes();
};
