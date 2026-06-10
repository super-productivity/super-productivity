import { IS_WEB_BROWSER } from '../../../../app.constants';
import { IS_ANDROID_NATIVE } from '../../../../util/is-native-platform';
import { IssueProviderCalendar } from '../../issue.model';

export const isCalendarProviderDisabledOnCurrentPlatform = (
  calProvider: Pick<IssueProviderCalendar, 'isDisabledForWebApp'>,
  isWebBrowser = IS_WEB_BROWSER,
  isAndroidNative = IS_ANDROID_NATIVE,
): boolean => !!calProvider.isDisabledForWebApp && (isWebBrowser || isAndroidNative);
