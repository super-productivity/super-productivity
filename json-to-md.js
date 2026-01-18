const fs = require('fs');

const INPUT_FILE = '/home/mchang/.config/superProductivity/backups/2026-01-18.json';
const OUTPUT_FILE = 'tasks.md';

try {
  const content = fs.readFileSync(INPUT_FILE, 'utf8');
  const backup = JSON.parse(content);
  const data = backup.data || backup;

  const tasks = data.task.entities;
  const projects = data.project.entities;
  const tags = data.tag.entities;

  let mdContent = '# Arbor Insight Tasks\n\n';

  // Helper to get tag names
  const getTags = (task) => {
    if (!task.tagIds || task.tagIds.length === 0) return '';
    return task.tagIds
      .map((id) => (tags[id] ? ` #${tags[id].title.replace(/\s+/g, '_')}` : ''))
      .join('');
  };

  // Helper to process task
  const taskToMd = (task, indent = '') => {
    const status = task.isDone ? 'x' : ' ';
    const tagStr = getTags(task);
    let line = `${indent}- [${status}] ${task.title}${tagStr}\n`;

    // Notes?
    if (task.notes) {
      // line += `${indent}  > ${task.notes.replace(/\n/g, '\n' + indent + '  > ')}\n`;
    }

    // Subtasks
    if (task.subTaskIds && task.subTaskIds.length > 0) {
      task.subTaskIds.forEach((subId) => {
        if (tasks[subId]) {
          line += taskToMd(tasks[subId], indent + '  ');
        }
      });
    }
    return line;
  };

  // 1. Process Projects
  Object.values(projects).forEach((proj) => {
    mdContent += `## ${proj.title}\n`;
    if (proj.taskIds) {
      proj.taskIds.forEach((tid) => {
        const task = tasks[tid];
        if (task && !task.parentId) {
          // Only top level tasks
          mdContent += taskToMd(task);
        }
      });
    }

    if (proj.backlogTaskIds && proj.backlogTaskIds.length > 0) {
      mdContent += `\n### Backlog\n`;
      proj.backlogTaskIds.forEach((tid) => {
        const task = tasks[tid];
        if (task) {
          mdContent += taskToMd(task);
        }
      });
    }
    mdContent += '\n';
  });

  // 2. Process Inbox / Orphans (INBOX_PROJECT)
  const inbox = projects['INBOX_PROJECT'];
  if (inbox && inbox.taskIds.length > 0) {
    mdContent += `## Inbox\n`;
    inbox.taskIds.forEach((tid) => {
      const task = tasks[tid];
      if (task && !task.parentId) {
        mdContent += taskToMd(task);
      }
    });
    mdContent += '\n';
  }

  fs.writeFileSync(OUTPUT_FILE, mdContent);
  console.log(`Exported tasks to ${OUTPUT_FILE}`);
} catch (e) {
  console.error(e);
}
