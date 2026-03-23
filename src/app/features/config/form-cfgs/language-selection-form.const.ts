import { ConfigFormSection, LocalizationConfig } from '../global-config.model';
import { LanguageCode, DateTimeLocales } from '../../../core/locale.constants';
import { T } from '../../../t.const';

export const LANGUAGE_SELECTION_FORM_FORM: ConfigFormSection<LocalizationConfig> = {
  title: T.GCF.LANG.TITLE,
  key: 'localization',
  items: [
    {
      key: 'lng',
      type: 'select',
      templateOptions: {
        label: T.GCF.LANG.LABEL,
        options: [
          // TODO sort by popular
          // TODO add translation
          { label: 'System default', value: null },
          { label: T.GCF.LANG.AR, value: LanguageCode.ar },
          { label: T.GCF.LANG.CS, value: LanguageCode.cs },
          { label: T.GCF.LANG.DE, value: LanguageCode.de },
          { label: T.GCF.LANG.ES, value: LanguageCode.es },
          { label: T.GCF.LANG.EN, value: LanguageCode.en },
          { label: T.GCF.LANG.FA, value: LanguageCode.fa },
          { label: T.GCF.LANG.FI, value: LanguageCode.fi },
          { label: T.GCF.LANG.FR, value: LanguageCode.fr },
          { label: T.GCF.LANG.HR, value: LanguageCode.hr },
          { label: T.GCF.LANG.ID, value: LanguageCode.id },
          { label: T.GCF.LANG.IT, value: LanguageCode.it },
          { label: T.GCF.LANG.JA, value: LanguageCode.ja },
          { label: T.GCF.LANG.KO, value: LanguageCode.ko },
          { label: T.GCF.LANG.NB, value: LanguageCode.nb },
          { label: T.GCF.LANG.NL, value: LanguageCode.nl },
          { label: T.GCF.LANG.PL, value: LanguageCode.pl },
          { label: T.GCF.LANG.PT, value: LanguageCode.pt },
          { label: T.GCF.LANG.PT_BR, value: LanguageCode.pt_br },
          { label: T.GCF.LANG.RU, value: LanguageCode.ru },
          { label: T.GCF.LANG.SK, value: LanguageCode.sk },
          { label: T.GCF.LANG.SV, value: LanguageCode.sv },
          { label: T.GCF.LANG.TR, value: LanguageCode.tr },
          { label: T.GCF.LANG.UK, value: LanguageCode.uk },
          { label: T.GCF.LANG.ZH, value: LanguageCode.zh },
          { label: T.GCF.LANG.ZH_TW, value: LanguageCode.zh_tw },
          { label: T.GCF.LANG.RO, value: LanguageCode.ro },
          { label: T.GCF.LANG.RO_MD, value: LanguageCode.ro_md },
        ],
      },
    },
    {
      key: 'firstDayOfWeek',
      type: 'select',
      templateOptions: {
        label: T.GCF.MISC.FIRST_DAY_OF_WEEK,
        options: [
          // TODO add translation
          { label: 'System default', value: null },
          { label: T.F.TASK_REPEAT.F.SUNDAY, value: 0 },
          { label: T.F.TASK_REPEAT.F.MONDAY, value: 1 },
          { label: T.F.TASK_REPEAT.F.TUESDAY, value: 2 },
          { label: T.F.TASK_REPEAT.F.WEDNESDAY, value: 3 },
          { label: T.F.TASK_REPEAT.F.THURSDAY, value: 4 },
          { label: T.F.TASK_REPEAT.F.FRIDAY, value: 5 },
          { label: T.F.TASK_REPEAT.F.SATURDAY, value: 6 },
        ],
      },
    },
    {
      key: 'dateTimeLocale',
      type: 'select',
      templateOptions: {
        label: T.GCF.LANG.TIME_LOCALE,
        description: T.GCF.LANG.TIME_LOCALE_DESCRIPTION,
        options: [
          // TODO sort by popular
          { label: T.GCF.LANG.TIME_LOCALE_AUTO, value: null },
          { label: T.GCF.LANG.TIME_LOCALE_EN_US, value: DateTimeLocales.en_us },
          { label: T.GCF.LANG.TIME_LOCALE_EN_GB, value: DateTimeLocales.en_gb },
          { label: T.GCF.LANG.TIME_LOCALE_TR_TR, value: DateTimeLocales.tr_tr },
          { label: T.GCF.LANG.TIME_LOCALE_DE_DE, value: DateTimeLocales.de_de },
          { label: T.GCF.LANG.TIME_LOCALE_FR_FR, value: DateTimeLocales.fr_fr },
          { label: T.GCF.LANG.TIME_LOCALE_ES_ES, value: DateTimeLocales.es_es },
          { label: T.GCF.LANG.TIME_LOCALE_IT_IT, value: DateTimeLocales.it_it },
          { label: T.GCF.LANG.TIME_LOCALE_PT_BR, value: DateTimeLocales.pt_br },
          { label: T.GCF.LANG.TIME_LOCALE_RU_RU, value: DateTimeLocales.ru_ru },
          { label: T.GCF.LANG.TIME_LOCALE_ZH_CN, value: DateTimeLocales.zh_cn },
          { label: T.GCF.LANG.TIME_LOCALE_JA_JP, value: DateTimeLocales.ja_jp },
          { label: T.GCF.LANG.TIME_LOCALE_KO_KR, value: DateTimeLocales.ko_kr },
          { label: T.GCF.LANG.TIME_LOCALE_UK_UA, value: DateTimeLocales.uk_ua },
          { label: T.GCF.LANG.TIME_LOCALE_CS_CZ, value: DateTimeLocales.cs_cz },
          { label: T.GCF.LANG.TIME_LOCALE_SK_SK, value: DateTimeLocales.sk_sk },
          { label: T.GCF.LANG.TIME_LOCALE_RO_RO, value: DateTimeLocales.ro_ro },
          { label: T.GCF.LANG.TIME_LOCALE_RO_MD, value: DateTimeLocales.ro_md },
        ],
      },
    },
  ],
};
