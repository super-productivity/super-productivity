import { IS_ELECTRON } from '../../app.constants';
import { DistChannel } from '../../util/get-app-version-str';

/**
 * Channels whose store / package manager updates the app on its own —
 * notifying there is noise, and the Mac App Store forbids pointing users at
 * out-of-store downloads. Kept as a denylist (not an allowlist of manual
 * channels) so an unknown or future channel defaults to being told about
 * updates: never learning about them is the failure mode this feature fixes.
 */
const SELF_UPDATING_CHANNELS: readonly (DistChannel | null)[] = [
  'win-store',
  'mac-store',
  'linux-snap',
];

/** Whether this build has no update channel of its own and should check for updates. */
export const isUpdateCheckPossible = (): boolean => {
  if (!IS_ELECTRON) {
    // Mobile builds update via their stores; the web app updates via the
    // service worker (InitialPwaUpdateCheckService).
    return false;
  }
  return !SELF_UPDATING_CHANNELS.includes(window.ea?.getDistChannel?.() ?? null);
};
