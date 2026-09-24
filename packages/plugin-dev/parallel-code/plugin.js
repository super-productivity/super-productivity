// Parallel Code plugin: adds "Start in Parallel Code" to the task context menu.
// The link carries only the task id. Parallel Code reads the title, notes,
// project and issue link through Super Productivity's Local REST API and
// pre-fills its New Task form; nothing starts until the user confirms there.

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
