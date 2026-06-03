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
