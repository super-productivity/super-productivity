import { T } from '../../../t.const';
import { ConfigFormSection, ShortSyntaxConfig } from '../global-config.model';

export const SHORT_SYNTAX_FORM_CFG: ConfigFormSection<ShortSyntaxConfig> = {
  title: T.GCF.SHORT_SYNTAX.TITLE,
  key: 'shortSyntax',
  help: T.GCF.SHORT_SYNTAX.HELP,
  items: [
    {
      key: 'isEnableProject',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SHORT_SYNTAX.IS_ENABLE_PROJECT,
      },
    },
    {
      key: 'isEnableTag',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SHORT_SYNTAX.IS_ENABLE_TAG,
      },
    },
    {
      key: 'isEnableDue',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SHORT_SYNTAX.IS_ENABLE_DUE,
      },
    },
    {
      key: 'isEnableNaturalLanguageDates',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SHORT_SYNTAX.IS_ENABLE_NATURAL_LANGUAGE_DATES,
      },
      // Plain-text detection is a layer on top of the due-date parsing
      hideExpression: (model: ShortSyntaxConfig) => !model.isEnableDue,
    },
    {
      key: 'urlBehavior',
      type: 'select',
      templateOptions: {
        label: T.GCF.SHORT_SYNTAX.URL_BEHAVIOR_LABEL,
        options: [
          {
            label: T.GCF.SHORT_SYNTAX.URL_BEHAVIOR_KEEP,
            value: 'keep',
          },
          {
            label: T.GCF.SHORT_SYNTAX.URL_BEHAVIOR_EXTRACT,
            value: 'extract',
          },
          {
            label: T.GCF.SHORT_SYNTAX.URL_BEHAVIOR_KEEP_AND_ATTACH,
            value: 'keep-and-attach',
          },
        ],
      },
    },
  ],
};
