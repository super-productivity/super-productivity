import { SoundConfig } from '../../config/global-config.model';
import { TaskLog } from '../../../core/log';
import { getAudioBuffer, playBuffer } from '../../../util/audio-context';

const BASE = './assets/snd';
const PITCH_OFFSET = -400;
const MAX_PITCH = 300;

/**
 * Plays the task completion sound with optional pitch variation.
 *
 * @param soundCfg - Sound configuration including volume and pitch settings
 * @param nrOfDoneTasks - Number of completed tasks (affects pitch if enabled)
 */
export const playDoneSound = async (
  soundCfg: SoundConfig,
  nrOfDoneTasks: number = 0,
): Promise<void> => {
  const file = `${BASE}/${soundCfg.doneSound}`;
  TaskLog.log(file);

  const pitchIncrement = nrOfDoneTasks * 50;
  const pitchFactor = soundCfg.isIncreaseDoneSoundPitch
    ? Math.min(PITCH_OFFSET + pitchIncrement, MAX_PITCH)
    : 0;

  try {
    const buffer = await getAudioBuffer(file);
    await playBuffer(buffer, soundCfg.volume, (source) => {
      source.detune.value = pitchFactor;
    });
  } catch (e) {
    console.error('Error playing done sound:', e);
  }
};
