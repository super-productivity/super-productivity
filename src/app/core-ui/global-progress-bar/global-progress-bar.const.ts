import { T } from '../../t.const';
/* eslint-disable @typescript-eslint/naming-convention */

export const PROGRESS_BAR_LABEL_MAP: { [key: string]: string } = {
  SYNC: T.GPB.SYNC,

  'asset/': T.GPB.ASSETS,

  'https://api.dropboxapi.com/2/files/get_metadata': T.GPB.DBX_META,
  'https://content.dropboxapi.com/2/files/download': T.GPB.DBX_DOWNLOAD,
  'https://content.dropboxapi.com/2/files/upload': T.GPB.DBX_UPLOAD,
  'https://api.dropboxapi.com/oauth2/token': T.GPB.DBX_GEN_TOKEN,

  POLL: T.F.ISSUE.S.POLLING_CHANGES,

  '/issue/': T.GPB.JIRA_LOAD_ISSUE,

  [T.GPB.WEB_DAV_DOWNLOAD]: T.GPB.WEB_DAV_DOWNLOAD,
  [T.GPB.WEB_DAV_UPLOAD]: T.GPB.WEB_DAV_UPLOAD,
};
