console.log('GitHub Daily Summary Plugin loaded');

PluginAPI.registerShortcut({
  id: 'show_github_daily_summary',
  label: 'Show GitHub Daily Summary',
  onExec: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});
