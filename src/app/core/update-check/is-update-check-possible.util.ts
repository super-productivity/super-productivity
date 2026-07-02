import { IS_ELECTRON } from '../../app.constants';
import { DistChannel } from '../../util/get-app-version-str';

/**
 * Channels whose store / package manager updates the app on its own —
 * notifying there is noise, and the Mac App Store forbids pointing users at
 * out-of-store downloads. Kept as a denylist (not an allowlist of manual
 * channels) so an unknown or future channel defaults to being told about
 * updates: never learning about them is the failure mode this feature fixes.
 *
 * `linux-flatpak` is deliberately NOT listed: Flathub updates depend on the
 * user's software-center setup (auto on GNOME Software defaults, manual for
 * CLI users), so flatpak users still get the once-per-version notice.
 */
const SELF_UPDATING_CHANNELS: readonly DistChannel[] = [
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
  const channel = window.ea?.getDistChannel?.();
  return !channel || !SELF_UPDATING_CHANNELS.includes(channel);
};
