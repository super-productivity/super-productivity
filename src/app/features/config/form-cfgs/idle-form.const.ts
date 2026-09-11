import { ConfigFormSection, IdleConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { HelperClasses } from '../../../app.constants';
import {
  IDLE_MIN_IDLE_TIME_MS,
  IDLE_PING_INTERVAL_MS,
} from '../../../../../electron/shared-with-frontend/idle.const';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';

export const IDLE_FORM_CFG: ConfigFormSection<IdleConfig> = {
  title: T.GCF.IDLE.TITLE,
  key: 'idle',
  help: T.GCF.IDLE.HELP,
  isHideForAndroidApp: true,
  items: [
    {
      type: 'tpl',
      className: `tpl ${HelperClasses.isHideForAdvancedFeatures}`,
      templateOptions: {
        tag: 'p',
        class: 'sub-section-heading',
        text: T.G.EXTENSION_INFO,
      },
    },
    {
      key: 'isEnableIdleTimeTracking',
      className: HelperClasses.isHideForNoAdvancedFeatures,
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.IDLE.IS_ENABLE_IDLE_TIME_TRACKING,
      },
    },
    {
      key: 'minIdleTime',
      className: HelperClasses.isHideForNoAdvancedFeatures,
      type: 'duration',
      hideExpression: '!model.isEnableIdleTimeTracking',
      templateOptions: {
        required: true,
        min: IDLE_MIN_IDLE_TIME_MS,
        label: T.GCF.IDLE.MIN_IDLE_TIME,
        description: T.GCF.IDLE.MIN_IDLE_TIME_DESCRIPTION,
        descriptionTranslateParams: {
          min: msToString(IDLE_MIN_IDLE_TIME_MS, true, true),
          interval: msToString(IDLE_PING_INTERVAL_MS, true, true),
        },
      },
    },
    {
      key: 'isOnlyOpenIdleWhenCurrentTask',
      className: HelperClasses.isHideForNoAdvancedFeatures,
      type: 'checkbox',
      hideExpression: '!model.isEnableIdleTimeTracking',
      templateOptions: {
        label: T.GCF.IDLE.IS_ONLY_OPEN_IDLE_WHEN_CURRENT_TASK,
      },
    },
    {
      key: 'isSuppressIdleDuringFocusMode',
      className: HelperClasses.isHideForNoAdvancedFeatures,
      type: 'checkbox',
      hideExpression: '!model.isEnableIdleTimeTracking',
      templateOptions: {
        label: T.GCF.IDLE.IS_SUPPRESS_IDLE_DURING_FOCUS_MODE,
      },
    },
  ],
};
