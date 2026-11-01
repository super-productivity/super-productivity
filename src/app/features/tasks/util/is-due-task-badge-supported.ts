import { IS_ELECTRON } from '../../../app.constants';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';

/**
 * Platforms that can show the due-task app-icon badge today.
 * Add `|| IS_ANDROID_NATIVE` when #11147 lands (same setting + countDueTasks).
 */
export const IS_DUE_TASK_BADGE_SUPPORTED = IS_ELECTRON || IS_IOS_NATIVE;

/**
 * Whether the mobile badge sync effect should run.
 * iOS only for now; widen with Android when #11147 lands.
 */
export const IS_MOBILE_DUE_TASK_BADGE_ENABLED = IS_IOS_NATIVE;
