import { ConfigFormSection } from '../config/global-config.model';
import { T } from '../../t.const';
import { Project } from './project.model';

export const CREATE_PROJECT_BASIC_CONFIG_FORM_CONFIG: ConfigFormSection<Project> = {
  // TODO translate
  title: 'Project Settings & Theme',
  key: 'basic',

  help: `Very basic settings for your project.`,

  items: [
    {
      key: 'title',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.PROJECT.FORM_BASIC.L_TITLE,
      },
    },
    {
      key: 'theme.primary' as any,
      type: 'color',
      templateOptions: {
        label: T.F.PROJECT.FORM_THEME.L_THEME_COLOR,
      },
    },
    {
      key: 'icon',
      type: 'icon',
      templateOptions: {
        label: T.F.TAG.FORM_BASIC.L_ICON,
        description: T.G.ICON_INP_DESCRIPTION,
      },
    },
    {
      key: 'isEnableBacklog',
      type: 'checkbox',
      defaultValue: false,
      templateOptions: {
        label: T.F.PROJECT.FORM_BASIC.L_ENABLE_BACKLOG,
      },
    },
    {
      // Transient form-only field (not persisted on the Project). When checked
      // on create, the dialog provisions a Plainspace space + bound issue
      // provider. See docs/plainspace-integration-plan.md §6.
      key: 'isShareOnPlainspace' as any,
      type: 'checkbox',
      defaultValue: false,
      templateOptions: {
        label: T.PLAINSPACE.SHARE_LABEL,
        description: T.PLAINSPACE.SHARE_DESCRIPTION,
      },
    },
  ],
};
