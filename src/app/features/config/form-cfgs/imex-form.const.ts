import { DOCS_URL } from '../../../app.constants';
import { ConfigFormSection } from '../global-config.model';
import { T } from '../../../t.const';

export const IMEX_FORM: ConfigFormSection<{ [key: string]: any }> = {
  title: T.GCF.IMEX.TITLE,
  // @ts-ignore
  key: 'IMEX_YEAH',
  help: T.GCF.IMEX.HELP,
  docsUrl: `${DOCS_URL}explanation/managing-your-data/`,
  customSection: 'FILE_IMPORT_EXPORT',
};
