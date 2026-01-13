import { ConfigFormSection, SoundConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { playDoneSound } from '../../tasks/util/play-done-sound';
import { playSound } from '../../../util/play-sound';

export const SOUND_OPTS = [
  { label: 'NONE', value: null },
  { label: 'Small Ding', value: 'ding-small-bell.mp3' },
  { label: 'Ding', value: 'copper-bell-ding.mp3' },
  { label: 'Sound 1', value: 'done1.mp3' },
  { label: 'Sound 2', value: 'done2.mp3' },
  { label: 'Sound 3', value: 'done3.mp3' },
  { label: 'Sound 4', value: 'done4.mp3' },
  { label: 'Sound 5', value: 'done5.mp3' },
  { label: 'Sound 6', value: 'done6.mp3' },
  { label: 'Sound 7', value: 'done7.mp3' },
];
export const SOUND_FORM_CFG: ConfigFormSection<SoundConfig> = {
  title: T.GCF.SOUND.TITLE,
  key: 'sound',
  items: [
    {
      key: 'volume',
      type: 'slider',
      templateOptions: {
        type: 'number',
        min: 0,
        max: 100,
        label: T.GCF.SOUND.VOLUME,
        required: true,
      },
    },
    {
      key: 'doneSound',
      type: 'select',
      templateOptions: {
        label: T.GCF.SOUND.DONE_SOUND,
        options: SOUND_OPTS,
        change: ({ model }) => playDoneSound(model),
      },
    },
    {
      key: 'isIncreaseDoneSoundPitch',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SOUND.IS_INCREASE_DONE_PITCH,
      },
      hideExpression: (model: any) => {
        return !model.doneSound;
      },
    },
    {
      key: 'breakReminderSound',
      type: 'select',
      templateOptions: {
        label: T.GCF.SOUND.BREAK_REMINDER_SOUND,
        options: SOUND_OPTS,
        change: ({ model }) => playSound(model.breakReminderSound, model.volume),
      },
    },
    {
      key: 'trackTimeSound',
      type: 'select',
      templateOptions: {
        label: T.GCF.SOUND.TRACK_TIME_SOUND,
        options: SOUND_OPTS,
        change: ({ model }) => playSound(model.trackTimeSound, model.volume),
      },
    },
  ],
};
