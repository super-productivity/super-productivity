import { TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS } from './task-repeat-cfg-form.const';
import { TaskReminderOptionId } from '../../tasks/task.model';

describe('TaskRepeatCfgFormConfig', () => {
  describe('remindAt field', () => {
    const remindAtField = TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS.flatMap((field) =>
      field.fieldGroup ? field.fieldGroup : [field],
    )
      .flatMap((field) => (field.fieldGroup ? field.fieldGroup : [field]))
      .find((field) => field.key === 'remindAt');

    it('should have a remindAt field configured', () => {
      expect(remindAtField).toBeDefined();
    });

    it('should have a defaultValue of AtStart to prevent undefined remindAt bug', () => {
      // This test ensures the fix for the bug where repeatable tasks with time
      // were always scheduled with remindAt set to "never" because the form
      // field lacked a defaultValue, causing Formly to not properly bind
      // the initial model value.
      expect(remindAtField?.defaultValue).toBe(TaskReminderOptionId.AtStart);
    });

    it('should be hidden when startTime is not set', () => {
      expect(remindAtField?.hideExpression).toBe('!model.startTime');
    });

    it('should be a required select field', () => {
      expect(remindAtField?.type).toBe('select');
      expect(remindAtField?.templateOptions?.required).toBe(true);
    });
  });
});
