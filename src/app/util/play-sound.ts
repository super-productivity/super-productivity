import { getAudioBuffer, getAudioBufferFromRaw, playBuffer } from './audio-context';

const BASE = './assets/snd';

/**
 * Audio queue to prevent simultaneous sound playback which can cause clipping.
 * Ensures sequential playback with minimal delay between sounds.
 */
class AudioQueue {
  private queue: Array<() => Promise<void>> = [];
  private isPlaying = false;

  async enqueue(playFn: () => Promise<void>): Promise<void> {
    this.queue.push(playFn);
    if (!this.isPlaying) {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) {
      return;
    }

    this.isPlaying = true;

    while (this.queue.length > 0) {
      const playFn = this.queue.shift();
      if (playFn) {
        try {
          await playFn();
        } catch (e) {
          console.error('Error processing audio queue:', e);
        }
      }
    }

    this.isPlaying = false;
  }
}

const audioQueue = new AudioQueue();

/**
 * Plays a sound file at the specified volume.
 * Multiple concurrent calls are automatically queued to prevent audio clipping.
 *
 * @param filePath - Path to the sound file relative to assets/snd
 * @param vol - Volume level from 0 to 100 (default: 100)
 */
export const playSound = async (filePath: string, vol = 100): Promise<void> => {
  try {
    await audioQueue.enqueue(async () => {
      const buffer = await getAudioBuffer(`${BASE}/${filePath}`);
      await playBuffer(buffer, vol);
    });
  } catch (e) {
    console.error('Error playing sound:', e);
  }
};

/**
 * Plays a raw ArrayBuffer as audio at the specified volume.
 * Uses `cacheKey` to avoid re-decoding on subsequent plays.
 * Multiple concurrent calls are automatically queued to prevent audio clipping.
 *
 * @param cacheKey - Unique identifier for the decoded buffer cache (e.g. `custom:<id>`)
 * @param arrayBuffer - Raw audio data (e.g. from IndexedDB)
 * @param vol - Volume level from 0 to 100 (default: 100)
 */
export const playSoundFromBuffer = async (
  cacheKey: string,
  arrayBuffer: ArrayBuffer,
  vol = 100,
): Promise<void> => {
  try {
    await audioQueue.enqueue(async () => {
      const buffer = await getAudioBufferFromRaw(cacheKey, arrayBuffer);
      await playBuffer(buffer, vol);
    });
  } catch (e) {
    console.error('Error playing custom sound:', e);
  }
};
