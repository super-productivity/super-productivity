import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';

describe('TaskRepeatCfgFormConfig', () => {
  it('should not contain startDate in essential form fields', () => {
    const startDateField = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.key === 'startDate',
    );
    expect(startDateField).toBeUndefined();
  });

  it('should not contain startTime or remindAt in advanced form fields', () => {
    const flatFields = TASK_REPEAT_CFG_ADVANCED_FORM_CFG.flatMap((field) =>
      field.fieldGroup ? field.fieldGroup : [field],
    ).flatMap((field) => (field.fieldGroup ? field.fieldGroup : [field]));

    const startTimeField = flatFields.find((field) => field.key === 'startTime');
    const remindAtField = flatFields.find((field) => field.key === 'remindAt');

    expect(startTimeField).toBeUndefined();
    expect(remindAtField).toBeUndefined();
  });
});
