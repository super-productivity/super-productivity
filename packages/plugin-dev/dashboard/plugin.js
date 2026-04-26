console.log('Dashboard Plugin loaded');

PluginAPI.registerShortcut({
  id: 'show_dashboard',
  label: 'Show Dashboard',
  onExec: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});
