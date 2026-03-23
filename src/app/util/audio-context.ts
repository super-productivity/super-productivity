/**
 * Singleton AudioContext manager to avoid creating multiple AudioContext instances.
 * This prevents memory leaks and browser resource exhaustion when playing sounds frequently.
 */

let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();
let unlocked = false;

/**
 * Returns the singleton AudioContext instance, creating it if necessary.
 */
export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (
      (window as any).AudioContext || (window as any).webkitAudioContext
    )();
  }

  return audioContext!;
};

/**
 * Returns the singleton AudioContext after ensuring it is in the "running" state.
 * Awaits resume() if the context is suspended (e.g., iOS after backgrounding).
 */
export const ensureAudioContextRunning = async (): Promise<AudioContext> => {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
};

/**
 * Retrieves a cached audio buffer or fetches and decodes it if not cached.
 * @param filePath - Path to the audio file
 * @returns Promise resolving to the decoded AudioBuffer
 */
export const getAudioBuffer = async (filePath: string): Promise<AudioBuffer> => {
  const cached = audioBufferCache.get(filePath);
  if (cached) {
    return cached;
  }

  const ctx = getAudioContext();
  const response = await fetch(filePath);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio file ${filePath}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  audioBufferCache.set(filePath, audioBuffer);
  return audioBuffer;
};

/**
 * Plays a decoded audio buffer at the given volume with optional source configuration.
 * Handles gain routing and node cleanup after playback.
 *
 * @param buffer - Decoded AudioBuffer to play
 * @param volume - Volume level from 0 to 100 (default: 100)
 * @param configureSource - Optional callback to configure the source node (e.g., detune, playbackRate)
 */
export const playBuffer = async (
  buffer: AudioBuffer,
  volume: number = 100,
  configureSource?: (source: AudioBufferSourceNode) => void,
): Promise<void> => {
  const audioCtx = await ensureAudioContextRunning();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  configureSource?.(source);

  let gainNode: GainNode | null = null;
  if (volume !== 100) {
    gainNode = audioCtx.createGain();
    gainNode.gain.value = volume / 100;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  } else {
    source.connect(audioCtx.destination);
  }

  source.onended = (): void => {
    source.disconnect();
    if (gainNode) {
      gainNode.disconnect();
    }
  };

  source.start(0);
};

/**
 * Registers one-time touchend/click listeners that create and resume the AudioContext
 * on the first user gesture. This is required on iOS where AudioContext can only be
 * unlocked from within a user gesture event handler.
 */
export const unlockAudioContext = (): void => {
  if (unlocked) {
    return;
  }
  unlocked = true;

  const ac = new AbortController();
  const onGesture = (): void => {
    ac.abort();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      // Fire-and-forget — ensureAudioContextRunning() retries before actual playback
      ctx.resume().catch(() => {});
    }
  };

  const opts = { once: true, signal: ac.signal };
  document.addEventListener('touchend', onGesture, opts);
  document.addEventListener('click', onGesture, opts);
};

/**
 * Clears the audio buffer cache. Useful for testing or memory management.
 */
export const clearAudioBufferCache = (): void => {
  audioBufferCache.clear();
};

/**
 * Closes the AudioContext and clears all caches.
 * Should only be called when audio is no longer needed (e.g., app shutdown).
 */
export const closeAudioContext = (): void => {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  audioBufferCache.clear();
  unlocked = false;
};
