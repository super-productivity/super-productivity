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

function parseTasksWithSubTasks(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  var lines = text.split('\n').filter(function (line) {
    return line.trim().length > 0;
  });

  if (lines.length === 0) {
    return null;
  }

  var parsedLines = [];
  var plainTextCount = 0;

  // Parse all lines
  for (var l = 0; l < lines.length; l++) {
    var parsed = parseLineStructure(lines[l]);
    if (parsed) {
      parsedLines.push(parsed);
      if (!parsed.isBullet) {
        plainTextCount++;
      }
    }
  }

  // Check if we have mixed input (both bullets and plain text)
  var hasBullets = parsedLines.some(function (p) {
    return p.isBullet;
  });
  var hasPlainText = parsedLines.some(function (p) {
    return !p.isBullet;
  });

  if (hasBullets && hasPlainText) {
    PluginAPI.showSnack({
      msg:
        'Warning: ' +
        plainTextCount +
        ' plain-text line(s) detected. These will be added as regular tasks.',
      type: 'WARNING',
    });
  }

  // Find the minimum indentation level to normalize
  var bulletLines = parsedLines.filter(function (p) {
    return p.isBullet;
  });
  if (bulletLines.length > 0) {
    var minIndentLevel = Math.min.apply(
      Math,
      bulletLines.map(function (line) {
        return line.indentLevel;
      }),
    );

    // Normalize indentation levels
    parsedLines.forEach(function (line) {
      if (line.isBullet) {
        line.indentLevel -= minIndentLevel;
      }
    });
  }

  var mainTasks = [];
  var i = 0;
  var deeplyNestedWarnings = [];

  while (i < parsedLines.length) {
    var currentLine = parsedLines[i];

    // Process main tasks (indent level 0 or plain text)
    if (
      (currentLine.isBullet && currentLine.indentLevel === 0) ||
      !currentLine.isBullet
    ) {
      var task = {
        title: currentLine.content,
        isCompleted: currentLine.isCompleted,
        subTasks: [],
      };

      // Look ahead for sub-tasks (only if current is a bullet).
      // Plain-text lines between the parent and its indented bullets must
      // not terminate the sub-task scan — skip over them so the indented
      // bullet still attaches to this parent. The plain-text line itself
      // will be picked up as its own top-level task by the outer loop.
      if (currentLine.isBullet) {
        var j = i + 1;
        while (j < parsedLines.length) {
          var subLine = parsedLines[j];
          // Stop at the next top-level bullet — a new main task starts here.
          if (subLine.isBullet && subLine.indentLevel === 0) break;
          if (subLine.isBullet && subLine.indentLevel > 0) {
            if (subLine.indentLevel > 1) {
              deeplyNestedWarnings.push({
                title: subLine.content,
                depth: subLine.indentLevel,
              });
            }
            task.subTasks.push({
              title: subLine.content,
              isCompleted: subLine.isCompleted,
            });
          }
          // Plain-text lines are intentionally skipped here; they are handled
          // by the outer loop on its next iteration.
          j++;
        }
      }

      mainTasks.push(task);
      i++;
    } else {
      // Orphan indented bullet (already consumed as sub-task above, or no parent).
      i++;
    }
  }

  // Show warning for deeply-nested items
  if (deeplyNestedWarnings.length > 0) {
    PluginAPI.showSnack({
      msg:
        deeplyNestedWarnings.length +
        ' deeply-nested item(s) flattened to sub-task level. Sub-tasks in Super Productivity do not support nesting.',
      type: 'INFO',
    });
  }

  return mainTasks;
}

function parseLineStructure(line) {
  // Calculate indentation level
  var indentMatch = line.match(/^(\s*)/);
  var indentLevel = 0;
  if (indentMatch && indentMatch[1]) {
    var whitespace = indentMatch[1];
    var tabCount = (whitespace.match(/\t/g) || []).length;
    var spaceCount = (whitespace.match(/ /g) || []).length;
    // Support both 2-space and 4-space conventions
    // For 4-space indent: Math.floor(4/4) = 1
    // For 2-space indent: Math.floor(2/2) = 1
    indentLevel = tabCount + Math.floor(spaceCount / 4) || Math.floor(spaceCount / 2);
  }

  var trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return null;
  }

  // Check for checkbox list items: - [ ] or - [x]
  var checkboxMatch = trimmedLine.match(/^-\s*\[([ x])\]\s*(.+)$/);
  if (checkboxMatch) {
    return {
      indentLevel: indentLevel,
      content: checkboxMatch[2].trim(),
      isCompleted: checkboxMatch[1] === 'x',
      isBullet: true,
    };
  }

  // Check for bullet list items: - or *
  var bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
  if (bulletMatch) {
    return {
      indentLevel: indentLevel,
      content: bulletMatch[1].trim(),
      isCompleted: false,
      isBullet: true,
    };
  }

  // Plain text lines no longer silently dropped
  return {
    indentLevel: 0,
    content: trimmedLine,
    isCompleted: false,
    isBullet: false,
  };
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

  // SUGGESTION: Expose expected format to users
  var placeholderText =
    'One task per line. For sub-tasks, indent with 4 spaces:\n\n- Main task\n    - Sub task\n    - Another sub task\n\nPlain text tasks are also supported.';

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
    '<textarea id="bd-input" rows="10" placeholder="' +
    escapeHtml(placeholderText) +
    '" style="width:100%;box-sizing:border-box">' +
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
    statusEl.textContent =
      'One task per line. Empty lines are skipped.\n - Use - for bullet points\n    indent 4 spaces for sub-tasks.';
  } else {
    statusEl.textContent =
      count +
      ' item' +
      (count !== 1 ? 's' : '') +
      ' detected (including sub-tasks) to add.';
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

  var text = textarea.value.trim();
  if (text.length === 0) {
    PluginAPI.showSnack({
      msg: 'Nothing to add — enter at least one task.',
      type: 'WARNING',
    });
    return;
  }

  var projectId = select ? select.value : null;
  var dueDay = dueInput ? dueInput.value : null;

  // Try to parse with structure first
  var parsedTasks = parseTasksWithSubTasks(text);
  if (parsedTasks && parsedTasks.length > 0) {
    // Create structured tasks with sub-tasks
    for (var i = 0; i < parsedTasks.length; i++) {
      var mainTask = parsedTasks[i];
      var taskData = {
        title: mainTask.title,
        isDone: mainTask.isCompleted,
      };
      if (projectId) {
        taskData.projectId = projectId;
      }
      if (dueDay) {
        taskData.dueDay = dueDay;
      }

      var parentTaskId = await PluginAPI.addTask(taskData);

      // Create sub-tasks if any
      if (mainTask.subTasks && mainTask.subTasks.length > 0) {
        for (var j = 0; j < mainTask.subTasks.length; j++) {
          var subTask = mainTask.subTasks[j];
          var subTaskData = {
            title: subTask.title,
            parentId: parentTaskId,
            isDone: subTask.isCompleted,
          };
          if (projectId) {
            subTaskData.projectId = projectId;
          }
          // dueDay is intentionally NOT forwarded: sub-tasks inherit the
          // parent's date in Super Productivity, and the plugin bridge
          // drops the field for sub-task creation.
          await PluginAPI.addTask(subTaskData);
        }
      }
    }

    var totalTasks =
      parsedTasks.length +
      parsedTasks.reduce(function (sum, task) {
        return sum + (task.subTasks ? task.subTasks.length : 0);
      }, 0);

    PluginAPI.showSnack({
      msg: totalTasks + ' task' + (totalTasks !== 1 ? 's' : '') + ' added',
      type: 'SUCCESS',
      ico: 'check',
    });
  } else {
    // Fallback to simple line-by-line parsing
    var lines = text.split('\n').filter(function (line) {
      return line.trim();
    });

    for (var k = 0; k < lines.length; k++) {
      var taskData = { title: lines[k].trim() };
      if (projectId) {
        taskData.projectId = projectId;
      }
      if (dueDay) {
        taskData.dueDay = dueDay;
      }
      await PluginAPI.addTask(taskData);
    }

    PluginAPI.showSnack({
      msg: lines.length + ' task' + (lines.length !== 1 ? 's' : '') + ' added',
      type: 'SUCCESS',
      ico: 'check',
    });
  }

  // Clear textarea and draft
  textarea.value = '';
  await PluginAPI.persistDataSynced(
    JSON.stringify({ text: '', projectId: '', dueDay: '' }),
  );
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
