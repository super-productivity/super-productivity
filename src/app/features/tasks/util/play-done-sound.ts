import { SoundConfig } from '../../config/global-config.model';
import { TaskLog } from '../../../core/log';
import { getAudioBuffer, playBuffer } from '../../../util/audio-context';

const BASE = './assets/snd';
const PITCH_PER_TASK = 50;
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

  // detune 0 plays the sample at its natural pitch. When the toggle is off we
  // never shift it; when on, pitch only ever rises above that baseline (50 cents
  // per completed task, clamped to MAX_PITCH) and never drops below it (#8265).
  const pitchFactor = soundCfg.isIncreaseDoneSoundPitch
    ? Math.min(nrOfDoneTasks * PITCH_PER_TASK, MAX_PITCH)
    : 0;

  try {
    const buffer = await getAudioBuffer(file);
    await playBuffer(buffer, soundCfg.volume, (source) => {
      source.detune.value = pitchFactor;
    });
  } catch (e) {
    TaskLog.err('Error playing done sound:', e);
  }
};
