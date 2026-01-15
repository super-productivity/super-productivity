import { ConfigFormSection, IdleConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { HelperClasses } from '../../../app.constants';

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
        label: T.GCF.IDLE.MIN_IDLE_TIME,
        description: T.G.DURATION_DESCRIPTION,
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
  ],
};
