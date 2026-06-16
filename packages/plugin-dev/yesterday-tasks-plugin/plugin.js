console.log("Yesterday's Tasks Plugin loaded");

// Register a keyboard shortcut
PluginAPI.registerShortcut({
  id: 'show_yesterday',
  label: PluginAPI.translate('SHORTCUT.SHOW_YESTERDAY_TASKS'),
  onExec: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});
