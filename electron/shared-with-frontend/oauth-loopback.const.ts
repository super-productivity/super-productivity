// Allowed range for the OAuth loopback redirect port. Shared between the renderer
// (redirectUri validation) and the Electron main process (IPC bind) so the two never drift.
export const OAUTH_LOOPBACK_PORT_MIN = 1024;
export const OAUTH_LOOPBACK_PORT_MAX = 65535;
