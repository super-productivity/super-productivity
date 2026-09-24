// Parallel Code plugin: adds "Start in Parallel Code" to the task context menu.
// The link carries only the task id. Parallel Code reads the title, notes,
// project and issue link through Super Productivity's Local REST API and
// pre-fills its New Task form; nothing starts until the user confirms there.

// Parallel Code is a desktop app for macOS and Linux; elsewhere the link has
// nothing to open. The enabled state syncs, so check at runtime.
var isSupportedPlatform =
  PluginAPI.cfg.platform === 'desktop' &&
  !(typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent));

// Both APIs are optional; hosts older than the ones that ship them lack them.
if (
  isSupportedPlatform &&
  typeof PluginAPI.registerTaskContextMenuEntry === 'function' &&
  typeof PluginAPI.openExternalUrl === 'function'
) {
  PluginAPI.registerTaskContextMenuEntry({
    label: PluginAPI.translate('MENU.START_IN_PARALLEL_CODE'),
    icon: 'terminal',
    onClick: function (taskId) {
      PluginAPI.openExternalUrl(
        'parallelcode://new-task?spTaskId=' + encodeURIComponent(taskId),
      ).catch(function (e) {
        PluginAPI.log.err('[parallel-code] Could not open Parallel Code', e);
      });
    },
  });
}
