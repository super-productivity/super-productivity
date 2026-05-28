import { getEnvOptional } from '../../util/env';
import { IS_ELECTRON } from '../../app.constants';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';

const _rawOfficialClientId = getEnvOptional('ONEDRIVE_CLIENT_ID') || '';

export const OFFICIAL_ONEDRIVE_CLIENT_ID = _rawOfficialClientId || null;
export const HAS_OFFICIAL_ONEDRIVE_CLIENT_ID = !!_rawOfficialClientId;

export const IS_ONEDRIVE_SUPPORTED = IS_ELECTRON || IS_NATIVE_PLATFORM;
