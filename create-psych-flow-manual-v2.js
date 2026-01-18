const fs = require('fs');

const INPUT_FILE = '/home/mchang/.config/superProductivity/backups/2026-01-18.json';
const OUTPUT_FILE = 'arbor-psych-flow-manual.json';

// New Tag IDs (Found from MCP output earlier)
const TAG_IDS = {
  URGENT: 'fHH5wla3YDQR6yTTipusa', // Red/Fire
  NOW: 'Y0XoLn-56g50a1qinkSQW', // Yellow/Sun
  SOON: 'QTCR7khFdReGaexLx8Lzi', // Green/Seed
  LATER: 'NicluOIEYi8vvRkK1u5ts', // Blue/Ocean
};

const TRASH_TAGS = ['TAG_QUICK_WIN', 'TAG_DEEP_FOCUS', 'TAG_LOW_ENERGY', 'TAG_FUN'];

try {
  console.log(`Reading backup from: ${INPUT_FILE}`);
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
  let backup = JSON.parse(fileContent);

  // Handle wrapper vs direct
  let data = backup.data || backup;

  // 1. DELETE TRASH TAGS
  console.log('Deleting trash tags...');
  TRASH_TAGS.forEach((id) => {
    if (data.tag.entities[id]) {
      delete data.tag.entities[id];
    }
  });
  data.tag.ids = data.tag.ids.filter((id) => !TRASH_TAGS.includes(id));

  // 2. CONFIGURE THE BOARD
  console.log('Injecting Psych Flow Board...');
  const psychBoard = {
    id: 'PSYCH_FLOW_BOARD',
    title: '🧠 Psych Flow',
    cols: 2,
    panels: [
      {
        id: 'PANEL_URGENT',
        title: '🚒 URGENT (High/Neg)',
        taskIds: [], // App will autopopulate based on tags
        taskDoneState: 3, // UnDone
        includedTagIds: [TAG_IDS.URGENT],
        excludedTagIds: [],
        scheduledState: 1,
        backlogState: 1,
        isParentTasksOnly: false,
      },
      {
        id: 'PANEL_NOW',
        title: '☀️ NOW (High/Pos)',
        taskIds: [],
        taskDoneState: 3,
        includedTagIds: [TAG_IDS.NOW],
        excludedTagIds: [],
        scheduledState: 1,
        backlogState: 1,
        isParentTasksOnly: false,
      },
      {
        id: 'PANEL_SOON',
        title: '🌱 SOON (Low/Neg)',
        taskIds: [],
        taskDoneState: 3,
        includedTagIds: [TAG_IDS.SOON],
        excludedTagIds: [],
        scheduledState: 1,
        backlogState: 1,
        isParentTasksOnly: false,
      },
      {
        id: 'PANEL_LATER',
        title: '🌊 LATER (Low/Pos)',
        taskIds: [],
        taskDoneState: 3,
        includedTagIds: [TAG_IDS.LATER],
        excludedTagIds: [],
        scheduledState: 1,
        backlogState: 1,
        isParentTasksOnly: false,
      },
    ],
  };

  // Remove old board if exists, add new one to the front
  if (!data.boards.boardCfgs) {
    data.boards.boardCfgs = [];
  }
  data.boards.boardCfgs = data.boards.boardCfgs.filter(
    (b) => b.id !== 'PSYCH_FLOW_BOARD' && b.id !== 'DOPAMINE_BOARD',
  );
  data.boards.boardCfgs.unshift(psychBoard);

  // 3. CLEAN UP TASK TAGS (Remove deleted tags from tasks)
  Object.values(data.task.entities).forEach((task) => {
    if (task.tagIds) {
      task.tagIds = task.tagIds.filter((id) => !TRASH_TAGS.includes(id));
    }
  });

  // 4. DISABLE SOUND (Prevent Freeze on Done)
  if (!data.globalConfig) data.globalConfig = {};
  if (!data.globalConfig.sound) data.globalConfig.sound = {};
  console.log('Disabling Done Sound to prevent freeze...');
  data.globalConfig.sound.isPlayDoneSound = false;
  data.globalConfig.sound.doneSound = null;

  // 5. DISABLE PLUGINS (Safety Nuke)
  if (data.pluginMetadata) {
    console.log('Clearing plugin metadata...');
    data.pluginMetadata = [];
  }
  if (data.pluginUserData) {
    console.log('Clearing plugin user data...');
    data.pluginUserData = [];
  }

  // 6. DISABLE SYNC (The Real Killer)
  if (!data.globalConfig) data.globalConfig = {};
  if (!data.globalConfig.sync) data.globalConfig.sync = {};
  console.log('Disabling Sync to prevent Cert Error Freeze...');
  data.globalConfig.sync.isEnabled = false;

  // Re-wrap if needed
  if (backup.data) {
    backup.data = data;
  } else {
    backup = data;
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(backup, null, 2));
  console.log(`Successfully generated ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Error processing file:', err);
}
