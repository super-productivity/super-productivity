import { PlatformCode, getCurrentPlatformCode } from '../../core/util/generate-client-id';
import { getOsLabel } from '../../core/util/get-os-label';

/**
 * Exhaustive per platform code, so widening `PlatformCode` is a compile error
 * here. Desktop and browser clients carry the OS family so two desktops on
 * different OSes are told apart with no configuration; mobile platforms
 * already name their OS.
 */
const PLATFORM_LABEL: Record<PlatformCode, { label: string; withOs: boolean }> = {
  E: { label: 'Desktop', withOs: true },
  A: { label: 'Android', withOs: false },
  I: { label: 'iOS', withOs: false },
  B: { label: 'Browser', withOs: true },
};

/**
 * Hard cap on any label that goes over the wire. Mirrored by the wire-size
 * spec (`tracking-presence-wire-size.spec.ts`) and the settings input's
 * maxLength — raise all or none.
 */
export const MAX_DEVICE_LABEL_LENGTH = 32;

/**
 * Platform-derived default label for this device, shown on OTHER devices
 * ("Tracking on Desktop (macOS)"). Deliberately coarse — no hostname or
 * model, so nothing personally identifying transits the server when
 * encryption is off. Composes the shared platform code rather than
 * re-checking IS_* flags (#9353). The parameters are test seams only.
 */
export const getDeviceLabel = (
  platform: PlatformCode = getCurrentPlatformCode(),
  userAgent: string = navigator.userAgent,
): string => {
  const { label, withOs } = PLATFORM_LABEL[platform];
  const os = withOs ? getOsLabel(userAgent) : null;
  return os ? `${label} (${os})` : label;
};

/**
 * Relayed payload fields are untrusted (with E2EE off a hostile server can
 * inject them) and the label reaches an [innerHtml] snack via translate
 * params, so it is deliberately reduced to a safe charset and capped rather
 * than escaped. Applied on BOTH ends: the producer runs it on the user's own
 * name too, so other devices show exactly what this device announced.
 */
export const sanitizeDeviceLabel = (v: unknown): string =>
  typeof v === 'string'
    ? v.replace(/[<>&"'`]/g, '').slice(0, MAX_DEVICE_LABEL_LENGTH)
    : '';

/**
 * The label this device announces: the per-device name from the SuperSync
 * private config when set, else the platform default. Blank or markup-only
 * names fall back too, so a device never announces an empty string.
 */
export const resolveDeviceLabel = (name?: string): string =>
  sanitizeDeviceLabel(name).trim() || getDeviceLabel();
