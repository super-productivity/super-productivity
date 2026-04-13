import { getAudioBuffer, playBuffer } from './audio-context';

const BASE = './assets/snd';

/**
 * Plays a sound file at the specified volume.
 *
 * @param filePath - Path to the sound file relative to assets/snd
 * @param vol - Volume level from 0 to 100 (default: 100)
 */
export const playSound = async (filePath: string, vol = 100): Promise<void> => {
  try {
    const buffer = await getAudioBuffer(`${BASE}/${filePath}`);
    await playBuffer(buffer, vol);
  } catch (e) {
    console.error('Error playing sound:', e);
  }
};
