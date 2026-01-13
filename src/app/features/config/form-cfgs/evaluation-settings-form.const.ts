import { ConfigFormSection, EvaluationConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const EVALUATION_SETTINGS_FORM_CFG: ConfigFormSection<EvaluationConfig> = {
  title: T.GCF.EVALUATION.TITLE,
  key: 'evaluation',
  items: [
    {
      key: 'isHideEvaluationSheet',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.EVALUATION.IS_HIDE_EVALUATION_SHEET,
      },
    },
  ],
};
