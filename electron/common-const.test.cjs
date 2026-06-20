const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { isGnomeDesktopEnv, isWaylandEnv, isGnomeWaylandEnv } = require(
  path.resolve(__dirname, 'common.const.ts'),
);

test('isGnomeDesktopEnv: detects GNOME from desktop env vars', () => {
  assert.equal(isGnomeDesktopEnv('linux', { XDG_CURRENT_DESKTOP: 'GNOME' }), true);
  assert.equal(isGnomeDesktopEnv('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }), true);
  assert.equal(isGnomeDesktopEnv('linux', { DESKTOP_SESSION: 'ubuntu' }), true);
  assert.equal(isGnomeDesktopEnv('linux', { XDG_SESSION_DESKTOP: 'gnome' }), true);
});

test('isGnomeDesktopEnv: false for non-GNOME / non-linux', () => {
  assert.equal(isGnomeDesktopEnv('linux', { XDG_CURRENT_DESKTOP: 'KDE' }), false);
  assert.equal(isGnomeDesktopEnv('linux', {}), false);
  // env vars are present but platform is not linux
  assert.equal(isGnomeDesktopEnv('win32', { XDG_CURRENT_DESKTOP: 'GNOME' }), false);
  assert.equal(isGnomeDesktopEnv('darwin', { XDG_CURRENT_DESKTOP: 'GNOME' }), false);
});

test('isWaylandEnv: detects Wayland via session type or display', () => {
  assert.equal(isWaylandEnv('linux', { XDG_SESSION_TYPE: 'wayland' }), true);
  // some sessions only set WAYLAND_DISPLAY
  assert.equal(isWaylandEnv('linux', { WAYLAND_DISPLAY: 'wayland-0' }), true);
});

test('isWaylandEnv: false for X11 / non-linux', () => {
  assert.equal(isWaylandEnv('linux', { XDG_SESSION_TYPE: 'x11' }), false);
  assert.equal(isWaylandEnv('linux', {}), false);
  assert.equal(isWaylandEnv('win32', { WAYLAND_DISPLAY: 'wayland-0' }), false);
});

test('isGnomeWaylandEnv: only true for GNOME AND Wayland together', () => {
  // GNOME + Wayland -> the one combination the kill-switch targets
  assert.equal(
    isGnomeWaylandEnv('linux', {
      XDG_CURRENT_DESKTOP: 'GNOME',
      XDG_SESSION_TYPE: 'wayland',
    }),
    true,
  );
  // GNOME on X11 keeps the feature
  assert.equal(
    isGnomeWaylandEnv('linux', {
      XDG_CURRENT_DESKTOP: 'GNOME',
      XDG_SESSION_TYPE: 'x11',
    }),
    false,
  );
  // non-GNOME Wayland (e.g. KDE) is unaffected
  assert.equal(
    isGnomeWaylandEnv('linux', {
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
    }),
    false,
  );
});
