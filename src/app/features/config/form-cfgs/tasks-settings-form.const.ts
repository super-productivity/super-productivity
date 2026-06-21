import { ConfigFormSection, TasksConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const TASKS_SETTINGS_FORM_CFG: ConfigFormSection<TasksConfig> = {
  title: T.GCF.TASKS.TITLE,
  key: 'tasks',
  items: [
    {
      key: 'isConfirmBeforeDelete',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_CONFIRM_BEFORE_DELETE,
      },
    },
    {
      key: 'isAutoAddWorkedOnToToday',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_AUTO_ADD_WORKED_ON_TO_TODAY,
      },
    },
    {
      key: 'isAutoMarkParentAsDone',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_AUTO_MARK_PARENT_AS_DONE,
      },
    },
    {
      key: 'isTrayShowCurrent',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_TRAY_SHOW_CURRENT,
      },
    },
    {
      key: 'isMarkdownFormattingInNotesEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_MARKDOWN_FORMATTING_IN_NOTES_ENABLED,
      },
    },
    {
      key: 'isPassParentDatesToSubTasks',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_PASS_PARENT_DATES_TO_SUB_TASKS,
      },
      hooks: {
        onInit: (field: any) => {
          const form = field.form;
          if (!form) return;
          const parentCtrl = field.formControl;
          const dueCtrl = form.get('isPassParentDueDateToSubTasks');
          const deadlineCtrl = form.get('isPassParentDeadlineToSubTasks');

          if (parentCtrl && dueCtrl && deadlineCtrl) {
            parentCtrl.valueChanges.subscribe((val: boolean) => {
              if (val && !dueCtrl.value && !deadlineCtrl.value) {
                dueCtrl.setValue(true);
                deadlineCtrl.setValue(true);
              }
            });

            dueCtrl.valueChanges.subscribe((val: boolean) => {
              if (!val && !deadlineCtrl.value && parentCtrl.value) {
                parentCtrl.setValue(false);
              }
            });

            deadlineCtrl.valueChanges.subscribe((val: boolean) => {
              if (!val && !dueCtrl.value && parentCtrl.value) {
                parentCtrl.setValue(false);
              }
            });
          }
        },
      },
    },
    {
      key: 'isPassParentDueDateToSubTasks',
      type: 'checkbox',
      className: 'indented-setting',
      templateOptions: {
        label: T.GCF.TASKS.IS_PASS_PARENT_DUE_DATE_TO_SUB_TASKS,
      },
      hideExpression: '!model.isPassParentDatesToSubTasks',
    },
    {
      key: 'isPassParentDeadlineToSubTasks',
      type: 'checkbox',
      className: 'indented-setting',
      templateOptions: {
        label: T.GCF.TASKS.IS_PASS_PARENT_DEADLINE_TO_SUB_TASKS,
      },
      hideExpression: '!model.isPassParentDatesToSubTasks',
    },
    {
      key: 'defaultProjectId',
      type: 'project-select',
      templateOptions: {
        label: T.GCF.TASKS.DEFAULT_PROJECT,
        // "None" is meaningless here: an unset default still routes new tasks to
        // the Inbox, so the option only confused users (#7891). Inbox is itself a
        // selectable project, so hiding "None" leaves no functionality behind.
        hideNoneOption: true,
      },
    },
    {
      key: 'notesTemplate',
      type: 'textarea',
      templateOptions: {
        rows: 5,
        label: T.GCF.TASKS.NOTES_TEMPLATE,
      },
    },
  ],
};
