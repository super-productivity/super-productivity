/**
 * Singleton AudioContext manager to avoid creating multiple AudioContext instances.
 * This prevents memory leaks and browser resource exhaustion when playing sounds frequently.
 */

let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();

/**
 * Returns the singleton AudioContext instance, creating it if necessary.
 * Handles the AudioContext suspended state that can occur due to browser autoplay policies.
 */
export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new ((window as any).AudioContext ||
      (window as any).webkitAudioContext)();
  }

  // Resume if suspended (can happen due to browser autoplay policies)
  // Intentionally fire-and-forget - audio playback is async anyway
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }

  return audioContext!;
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
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  audioBufferCache.set(filePath, audioBuffer);
  return audioBuffer;
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
};
