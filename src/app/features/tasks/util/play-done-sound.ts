import { SoundConfig } from '../../config/global-config.model';
import { TaskLog } from '../../../core/log';
import { getAudioBuffer, getAudioContext } from '../../../util/audio-context';

const BASE = './assets/snd';
const PITCH_OFFSET = -400;

/**
 * Plays the task completion sound with optional pitch variation.
 * Uses a singleton AudioContext and caches audio buffers to prevent resource leaks.
 *
 * @param soundCfg - Sound configuration including volume and pitch settings
 * @param nrOfDoneTasks - Number of completed tasks (affects pitch if enabled)
 */
export const playDoneSound = (soundCfg: SoundConfig, nrOfDoneTasks: number = 0): void => {
  const speed = 1;
  const file = `${BASE}/${soundCfg.doneSound}`;
  TaskLog.log(file);

  const pitchIncrement = nrOfDoneTasks * 50;
  const pitchFactor = soundCfg.isIncreaseDoneSoundPitch
    ? PITCH_OFFSET + pitchIncrement
    : 0;

  getAudioBuffer(file)
    .then((buffer) => {
      const audioCtx = getAudioContext();
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      source.detune.value = pitchFactor;

      if (soundCfg.volume !== 100) {
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = soundCfg.volume / 100;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      } else {
        source.connect(audioCtx.destination);
      }

      source.start(0);
    })
    .catch((e) => {
      console.error('Error playing done sound:', e);
    });
};
