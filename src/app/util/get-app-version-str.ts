import { IS_ANDROID_WEB_VIEW } from './is-android-web-view';
import { androidInterface } from '../features/android/android-interface';
import { environment } from '../../environments/environment';

export const getAppVersionStr = (): string => {
  const b =
    (IS_ANDROID_WEB_VIEW && androidInterface?.getVersion?.()) || environment.version;
  return IS_ANDROID_WEB_VIEW ? `${b}A` : b;
};
