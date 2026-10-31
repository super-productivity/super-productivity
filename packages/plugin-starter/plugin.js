// The app runs this file once when the plugin is enabled and provides the
// global `PluginAPI`. For autocomplete, see "Autocomplete and type checking"
// in README.md. Full API: https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts

// A button in the app header.
PluginAPI.registerHeaderButton({
  label: 'Say hello',
  icon: 'waving_hand',
  onClick: async () => {
    const tasks = await PluginAPI.getCurrentContextTasks();
    const openCount = tasks.filter((task) => !task.isDone).length;
    PluginAPI.showSnack({ msg: `Hello! ${openCount} open tasks here.`, type: 'SUCCESS' });
  },
});

// React to something happening in the app.
PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, () => {
  PluginAPI.showSnack({ msg: 'Nice work!', type: 'SUCCESS', ico: 'celebration' });
});
