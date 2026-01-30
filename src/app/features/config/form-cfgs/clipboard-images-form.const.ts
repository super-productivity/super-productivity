import { ConfigFormSection } from '../global-config.model';
import { T } from '../../../t.const';

export const CLIPBOARD_IMAGES_FORM: ConfigFormSection<{ [key: string]: any }> = {
  title: T.GCF.CLIPBOARD_IMAGES.TITLE,
  // @ts-ignore
  key: 'clipboardImages',
  help: T.GCF.CLIPBOARD_IMAGES.HELP,
  customSection: 'CLIPBOARD_IMAGES_CFG',
};
