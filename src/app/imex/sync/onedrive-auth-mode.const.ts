import { getEnvOptional } from '../../util/env';

const _rawOfficialClientId = getEnvOptional('ONEDRIVE_CLIENT_ID') || '';

export const OFFICIAL_ONEDRIVE_CLIENT_ID = _rawOfficialClientId || null;
export const HAS_OFFICIAL_ONEDRIVE_CLIENT_ID = !!_rawOfficialClientId;
