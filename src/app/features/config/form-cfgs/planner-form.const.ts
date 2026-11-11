import { ConfigFormSection, PlannerConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const PLANNER_FORM_CFG: ConfigFormSection<PlannerConfig> = {
  title: T.GCF.PLANNER.TITLE,
  help: T.GCF.PLANNER.HELP,
  key: 'planner',
  items: [
    {
      key: 'isHideWeekends',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.PLANNER.L_IS_HIDE_WEEKENDS,
        description: T.GCF.PLANNER.IS_HIDE_WEEKENDS_DESCRIPTION,
      },
    },
  ],
};
