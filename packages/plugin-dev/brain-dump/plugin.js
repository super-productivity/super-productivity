// Brain Dump Plugin - Quickly capture many tasks at once

var _bdIntervals = { save: null, check: null };

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function countTasks(textarea) {
  if (!textarea || !textarea.value) return 0;
  return textarea.value.split('\n').filter(function (line) {
    return line.trim();
  }).length;
}

function todayStr() {
  var d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function _bdCleanup() {
  clearInterval(_bdIntervals.save);
  clearInterval(_bdIntervals.check);
  _bdIntervals.save = null;
  _bdIntervals.check = null;
}

async function openBrainDump() {
  var projectsPromise = PluginAPI.getAllProjects();
  var dataPromise = PluginAPI.loadSyncedData();
  var results = await Promise.all([projectsPromise, dataPromise]);
  var projects = results[0];
  var savedData = results[1];

  var draft = {};
  if (savedData) {
    try {
      draft = JSON.parse(savedData);
    } catch (e) {
      /* ignore corrupt draft */
    }
  }
  var savedText = draft.text || '';
  var inboxProject = projects.find(function (p) {
    return p.id === 'INBOX_PROJECT';
  });
  var savedProjectId = draft.projectId || (inboxProject ? inboxProject.id : '');
  var savedDueDay = draft.dueDay !== undefined ? draft.dueDay : todayStr();

  var activeProjects = projects.filter(function (p) {
    return !p.isArchived;
  });

  var projectOptions = activeProjects
    .map(function (p) {
      return (
        '<option value="' +
        p.id +
        '"' +
        (p.id === savedProjectId ? ' selected' : '') +
        '>' +
        escapeHtml(p.title) +
        '</option>'
      );
    })
    .join('');

  var html =
    '<div id="bd-container" style="padding:4px 0">' +
    '<div style="display:flex;gap:12px;margin-bottom:12px">' +
    '<div style="flex:1">' +
    '<label for="bd-project" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">Project</label>' +
    '<select id="bd-project" style="width:100%">' +
    '<option value="">No project</option>' +
    projectOptions +
    '</select>' +
    '<div id="bd-color-bar" style="height:3px;margin-top:4px;border-radius:2px"></div>' +
    '</div>' +
    '<div>' +
    '<label for="bd-due" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">Due date</label>' +
    '<input type="date" id="bd-due" value="' +
    escapeHtml(savedDueDay) +
    '" style="width:100%">' +
    '</div>' +
    '</div>' +
    '<textarea id="bd-input" rows="10" placeholder="One task per line..." style="width:100%;box-sizing:border-box">' +
    escapeHtml(savedText) +
    '</textarea>' +
    '<div id="bd-status" style="margin-top:4px;font-size:12px;opacity:0.5">' +
    '</div>' +
    '</div>';

  var lastSavedText = savedText;

  PluginAPI.openDialog({
    title: 'Brain Dump',
    htmlContent: html,
    buttons: [
      {
        label: 'Cancel',
        onClick: function () {
          _bdCleanup();
          return saveDraft();
        },
      },
      {
        label: 'Add Tasks',
        color: 'primary',
        icon: 'add',
        raised: true,
        onClick: function () {
          _bdCleanup();
          return submitTasks();
        },
      },
    ],
  });

  // Periodic draft save (only on change) + theme color update + status update
  _bdIntervals.save = setInterval(function () {
    var textarea = document.getElementById('bd-input');
    if (textarea && textarea.value !== lastSavedText) {
      lastSavedText = textarea.value;
      saveDraft();
    }
    updateThemeColor(activeProjects);
    updateStatus();
  }, 2000);

  _bdIntervals.check = setInterval(function () {
    if (!document.getElementById('bd-input')) {
      _bdCleanup();
    }
  }, 1000);

  // Initial updates
  setTimeout(function () {
    updateThemeColor(activeProjects);
    updateStatus();
  }, 100);
}

function updateStatus() {
  var textarea = document.getElementById('bd-input');
  var statusEl = document.getElementById('bd-status');
  if (!statusEl) return;
  var count = countTasks(textarea);
  if (count === 0) {
    statusEl.textContent = 'One task per line. Empty lines are skipped.';
  } else {
    statusEl.textContent = count + ' task' + (count !== 1 ? 's' : '') + ' to add';
  }
}

function updateThemeColor(activeProjects) {
  var select = document.getElementById('bd-project');
  var colorBar = document.getElementById('bd-color-bar');
  if (!select || !colorBar) return;

  var project = activeProjects.find(function (p) {
    return p.id === select.value;
  });

  if (project && project.theme && project.theme.primary) {
    colorBar.style.background = project.theme.primary;
  } else {
    colorBar.style.background = 'transparent';
  }
}

async function saveDraft() {
  var textarea = document.getElementById('bd-input');
  var select = document.getElementById('bd-project');
  var dueInput = document.getElementById('bd-due');
  if (textarea) {
    await PluginAPI.persistDataSynced(
      JSON.stringify({
        text: textarea.value,
        projectId: select ? select.value : '',
        dueDay: dueInput ? dueInput.value : '',
      }),
    );
  }
}

async function submitTasks() {
  var textarea = document.getElementById('bd-input');
  var select = document.getElementById('bd-project');
  var dueInput = document.getElementById('bd-due');
  if (!textarea) return;

  var lines = textarea.value.split('\n').filter(function (line) {
    return line.trim();
  });

  if (lines.length === 0) {
    PluginAPI.showSnack({
      msg: 'Nothing to add — enter at least one task.',
      type: 'WARNING',
    });
    return;
  }

  var projectId = select ? select.value : null;
  var dueDay = dueInput ? dueInput.value : null;

  for (var i = 0; i < lines.length; i++) {
    var taskData = { title: lines[i].trim() };
    if (projectId) {
      taskData.projectId = projectId;
    }
    if (dueDay) {
      taskData.dueDay = dueDay;
    }
    await PluginAPI.addTask(taskData);
  }

  // Clear textarea and draft
  textarea.value = '';
  await PluginAPI.persistDataSynced(
    JSON.stringify({ text: '', projectId: '', dueDay: '' }),
  );

  PluginAPI.showSnack({
    msg: lines.length + ' task' + (lines.length !== 1 ? 's' : '') + ' added',
    type: 'SUCCESS',
    ico: 'check',
  });
}

// Register menu entry and shortcut
PluginAPI.registerMenuEntry({
  label: 'Brain Dump',
  icon: 'lightbulb',
  onClick: openBrainDump,
});

PluginAPI.registerShortcut({
  id: 'open-brain-dump',
  label: 'Open Brain Dump',
  onExec: openBrainDump,
});
