import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from './android-interface';

/**
 * Whether the Android tracking service shows the "time estimate exceeded"
 * notification itself (#11896), so the web app must not post a second one.
 * Decided from the web side rather than by asking native what it tracks right
 * now: the service starts asynchronously, so a task that is already over its
 * estimate is checked here before native has picked it up. False on APKs
 * without the bridge method and during focus mode, which replaces the
 * tracking service.
 */
export const isTimeEstimateNotifiedNatively = (isFocusModeActive: boolean): boolean =>
  IS_ANDROID_WEB_VIEW && !!androidInterface.setTrackingTimeEstimate && !isFocusModeActive;
