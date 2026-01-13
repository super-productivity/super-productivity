import { ConfigFormSection, TakeABreakConfig } from '../global-config.model';
import { T } from '../../../t.const';
/* eslint-disable @typescript-eslint/naming-convention */

export const TAKE_A_BREAK_FORM_CFG: ConfigFormSection<TakeABreakConfig> = {
  title: T.GCF.TAKE_A_BREAK.TITLE,
  key: 'takeABreak',
  help: T.GCF.TAKE_A_BREAK.HELP,
  items: [
    {
      key: 'isTakeABreakEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.IS_ENABLED,
      },
    },
    {
      key: 'isLockScreen',
      type: 'checkbox',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.IS_LOCK_SCREEN,
      },
    },
    {
      key: 'isTimedFullScreenBlocker',
      type: 'checkbox',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.IS_FULL_SCREEN_BLOCKER,
      },
    },
    {
      key: 'isFocusWindow',
      type: 'checkbox',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.IS_FOCUS_WINDOW,
      },
    },
    {
      hideExpression: (model: any) =>
        !model.isTakeABreakEnabled || !model.isTimedFullScreenBlocker,
      key: 'timedFullScreenBlockerDuration',
      type: 'duration',
      templateOptions: {
        required: true,
        isAllowSeconds: true,
        label: T.GCF.TAKE_A_BREAK.FULL_SCREEN_BLOCKER_DURATION,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      key: 'takeABreakMinWorkingTime',
      type: 'duration',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      expressionProperties: { 'templateOptions.required': 'model.isTakeABreakEnabled' },
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.MIN_WORKING_TIME,
        required: true,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      key: 'takeABreakSnoozeTime',
      type: 'duration',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      expressionProperties: { 'templateOptions.required': 'model.isTakeABreakEnabled' },
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.SNOOZE_TIME,
        required: true,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      key: 'takeABreakMessage',
      type: 'textarea',
      hideExpression: (model: any) => !model.isTakeABreakEnabled,
      expressionProperties: { 'templateOptions.required': 'model.isTakeABreakEnabled' },
      templateOptions: {
        label: T.GCF.TAKE_A_BREAK.MESSAGE,
      },
    },
    {
      type: 'tpl',
      // NOTE: does never show for repeat for some weird reason
      // hideExpression: (model: any) => !model.isTakeABreakEnabled,
      className: 'tpl',
      templateOptions: {
        tag: 'h3',
        class: 'sub-section-heading',
        text: T.GCF.TAKE_A_BREAK.MOTIVATIONAL_IMGS,
      },
    },
    {
      key: 'motivationalImgs',
      // NOTE: does never show for some weird reason
      // hideExpression: (model: any) => !model.isTakeABreakEnabled,
      expressionProperties: { 'templateOptions.required': 'model.isTakeABreakEnabled' },
      type: 'repeat',
      templateOptions: {
        addText: T.GCF.TAKE_A_BREAK.ADD_NEW_IMG,
        defaultValue: '',
      },
      fieldArray: {
        type: 'input',
        templateOptions: {
          minLength: 3,
        },
      },
    },
  ],
};
