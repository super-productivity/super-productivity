// Parallel Code plugin: adds "Start in Parallel Code" to the task context menu.
// The link carries only the task id. Parallel Code reads the title, notes,
// project and issue link through Super Productivity's Local REST API and
// pre-fills its New Task form; nothing starts until the user confirms there.

// Parallel Code is a desktop app for macOS and Linux; elsewhere the link has
// nothing to open. The enabled state syncs, so check at runtime.
var isSupportedPlatform =
  PluginAPI.cfg.platform === 'desktop' && !/Windows/i.test(navigator.userAgent);

// Task context menu entries come from the plugin API added for #9616; a build
// without it gets no entry rather than an error.
if (isSupportedPlatform && typeof PluginAPI.registerTaskContextMenuEntry === 'function') {
  PluginAPI.registerTaskContextMenuEntry({
    id: 'start-in-parallel-code',
    label: PluginAPI.translate('MENU.START_IN_PARALLEL_CODE'),
    icon: 'terminal',
    onClick: function (context) {
      // The desktop app routes window.open through its external-link handler,
      // which applies the scheme allowlist and reports a link it can't open.
      window.open(
        'parallelcode://new-task?spTaskId=' + encodeURIComponent(context.taskId),
        '_blank',
      );
    },
  });
}
