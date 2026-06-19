import { ConfigFormSection } from '../config/global-config.model';
import { T } from '../../t.const';
import { Project } from './project.model';

// The create-project form carries one transient field beyond the Project model:
// `isShareOnPlainspace` (read on submit, then stripped — never persisted). Typing
// the section with it keeps the field key type-safe instead of an `as any` cast.
export type CreateProjectFormModel = Project & { isShareOnPlainspace?: boolean };

export const CREATE_PROJECT_BASIC_CONFIG_FORM_CONFIG: ConfigFormSection<CreateProjectFormModel> =
  {
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
        // Create-only: editing an existing project (model has an id) can't
        // provision sharing here, so hide it rather than show a dead control.
        key: 'isShareOnPlainspace',
        type: 'checkbox',
        defaultValue: false,
        hideExpression: '!!model.id',
        templateOptions: {
          label: T.PLAINSPACE.SHARE_LABEL,
          description: T.PLAINSPACE.SHARE_DESCRIPTION,
        },
      },
    ],
  };
