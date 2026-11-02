/**
 * Singleton AudioContext manager to avoid creating multiple AudioContext instances.
 * This prevents memory leaks and browser resource exhaustion when playing sounds frequently.
 */

let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();
let unlocked = false;
// Whether something still needs the context running while the app is backgrounded
// (e.g. focus-mode white noise). While set, suspendAudioContext() is a no-op so
// the ongoing sound is not cut off. See setAudioContextKeepAwake().
let keepAwake = false;

// A running AudioContext keeps an OS audio stream open, even when silent.
// On desktop this blocks system sleep (Windows power request) and wastes power.
// So the context suspends itself when no sound has played for a short time.
export const IDLE_SUSPEND_DELAY_MS = 5000;
// Number of sounds that need the context running (see holdAudioContext()).
let activeSounds = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const clearIdleTimer = (): void => {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

// Suspends the context after IDLE_SUSPEND_DELAY_MS if no sound holds it.
// This path ignores keepAwake. Sounds that need the context hold it instead.
const scheduleIdleSuspend = (): void => {
  clearIdleTimer();
  if (activeSounds !== 0 || !audioContext) {
    return;
  }
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeSounds === 0 && audioContext && audioContext.state === 'running') {
      void audioContext.suspend().catch(() => {});
    }
  }, IDLE_SUSPEND_DELAY_MS);
};

/**
 * Marks the context as in use. While held, the idle suspend does not run.
 * Returns an idempotent release function. Call it when the sound ends.
 */
export const holdAudioContext = (): (() => void) => {
  activeSounds++;
  clearIdleTimer();
  let released = false;
  return (): void => {
    if (released) {
      return;
    }
    released = true;
    activeSounds = Math.max(0, activeSounds - 1);
    if (activeSounds === 0) {
      scheduleIdleSuspend();
    }
  };
};

/**
 * Returns the singleton AudioContext instance, creating it if necessary.
 */
export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (
      (window as any).AudioContext || (window as any).webkitAudioContext
    )();
    // Firefox can create the context already running.
    scheduleIdleSuspend();
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
  // Capacitor's iOS asset scheme can return a readable response with status 0.
  // Network failures still reject fetch(), and decodeAudioData validates the body.
  if (!response.ok && response.status !== 0) {
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
  // Hold first, so the idle timer cannot fire while resume() is pending.
  const release = holdAudioContext();
  try {
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
      release();
    };

    source.start(0);
  } catch (e) {
    release();
    throw e;
  }
};

/**
 * Marks (or clears) a need to keep the AudioContext running even while the app is
 * backgrounded. Used by long-lived background audio such as the focus-mode white
 * noise so that suspendAudioContext() does not cut it off mid-playback.
 *
 * Single-owner: white noise is currently the only caller. If a second long-lived
 * background sound is ever added, replace this boolean with a reference count so
 * one source clearing the flag cannot release another's.
 */
export const setAudioContextKeepAwake = (keep: boolean): void => {
  keepAwake = keep;
};

/**
 * Suspends the singleton AudioContext to release the underlying audio output
 * stream. On Android a `running` AudioContext keeps an AudioTrack open in the
 * audio HAL even while completely silent — which drains the battery around the
 * clock and keeps the process alive in the background (issue #8243). Suspending
 * releases that stream; the next playback resumes it via ensureAudioContextRunning().
 *
 * No-op when the context was never created, is already suspended, or something
 * still needs it running (see setAudioContextKeepAwake).
 */
export const suspendAudioContext = (): void => {
  if (!keepAwake && audioContext && audioContext.state === 'running') {
    // suspend() returns a promise; the release begins immediately so we don't
    // await it. Swallow errors — the context may already be closing.
    void audioContext.suspend().catch(() => {});
  }
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
      // Fire-and-forget — ensureAudioContextRunning() retries before actual playback.
      // Schedule the idle suspend after resume settles, so a slow resume cannot
      // leave the context running.
      ctx.resume().then(scheduleIdleSuspend, scheduleIdleSuspend);
    } else {
      scheduleIdleSuspend();
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
  keepAwake = false;
  activeSounds = 0;
  clearIdleTimer();
};
