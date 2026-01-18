const fs = require('fs');

const INPUT_FILE = '/home/mchang/Downloads/arbor-psych-flow-manual-v3.json';
const OUTPUT_FILE = 'arbor-template.json';

try {
  console.log(`Reading base backup from: ${INPUT_FILE}`);
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
  let backup = JSON.parse(fileContent);
  let data = backup.data || backup;

  // 1. NUKE TASKS (The Clean Slate)
  console.log('Clearing all tasks...');
  data.task.ids = [];
  data.task.entities = {};

  // Clear Task Archive too
  data.archiveYoung = {
    task: { ids: [], entities: {} },
    timeTracking: { tag: {}, project: {} },
    lastTimeTrackingFlush: 0,
  };
  data.archiveOld = {
    task: { ids: [], entities: {} },
    timeTracking: { tag: {}, project: {} },
    lastTimeTrackingFlush: 0,
  };

  // 2. NUKE LINKS (Ghost Integrations)
  console.log('Clearing issue providers...');
  data.issueProvider.ids = [];
  data.issueProvider.entities = {};

  // 3. RESET PROJECTS (Empty Shells)
  console.log('Resetting Projects to empty shells...');
  Object.values(data.project.entities).forEach((p) => {
    p.taskIds = [];
    p.backlogTaskIds = [];
    p.noteIds = [];
    // Keep theme, icon, title (The Structure)
  });

  // 4. RESET TAGS (Empty Shells)
  console.log('Resetting Tags to empty shells...');
  Object.values(data.tag.entities).forEach((t) => {
    t.taskIds = [];
    // Keep theme, icon, title, color (The Workflow)
  });

  // 5. SAFETY CONFIGS (No Sound, No Sync, No Celebration)
  if (!data.globalConfig) data.globalConfig = {};

  // Sound
  if (!data.globalConfig.sound) data.globalConfig.sound = {};
  data.globalConfig.sound.isPlayDoneSound = false;
  data.globalConfig.sound.doneSound = null; // Ensure null

  // Celebration
  if (!data.globalConfig.misc) data.globalConfig.misc = {};
  data.globalConfig.misc.isDisableCelebration = true;

  // Sync
  if (!data.globalConfig.sync) data.globalConfig.sync = {};
  data.globalConfig.sync.isEnabled = false;

  // Domina
  if (data.globalConfig.dominaMode) {
    data.globalConfig.dominaMode.isEnabled = false;
  }

  // 6. CLEAR PLUGINS
  console.log('Clearing plugin data...');
  data.pluginMetadata = [];
  data.pluginUserData = [];

  // Re-wrap
  if (backup.data) {
    backup.data = data;
  } else {
    backup = data;
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(backup, null, 2));
  console.log(`Successfully generated ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Error:', err);
}
