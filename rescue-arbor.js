const fs = require('fs');

// Path to the latest auto-backup found in the previous step
const INPUT_FILE = '/home/mchang/.config/superProductivity/backups/2026-01-16.json';
const OUTPUT_FILE = 'arbor-rescue.json';

// Legacy tags to remove
const TAGS_TO_REMOVE = [
  'PRI_URGENT',
  'PRI_NOW',
  'PRI_SOON',
  'PRI_LATER',
  'EM_IMPORTANT',
  'EM_URGENT',
];

try {
  console.log(`Reading backup from: ${INPUT_FILE}`);
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
  const backup = JSON.parse(fileContent);

  // Handle different backup structures (wrapper vs direct)
  const data = backup.data || backup;

  // 1. DISABLE DOMINA MODE (Crash Prevention)
  if (data.globalConfig && data.globalConfig.dominaMode) {
    console.log('Disabling Domina Mode...');
    data.globalConfig.dominaMode.isEnabled = false;
  }

  // 2. CLEANUP REDUNDANT TAGS
  console.log('Removing redundant tags...');

  // Remove tag entities
  TAGS_TO_REMOVE.forEach((tagId) => {
    if (data.tag.entities[tagId]) {
      delete data.tag.entities[tagId];
    }
  });

  // Remove IDs from the tag list
  data.tag.ids = data.tag.ids.filter((id) => !TAGS_TO_REMOVE.includes(id));

  // Remove tag references from all tasks
  let tasksUpdated = 0;
  Object.values(data.task.entities).forEach((task) => {
    if (task.tagIds) {
      const originalLength = task.tagIds.length;
      task.tagIds = task.tagIds.filter((id) => !TAGS_TO_REMOVE.includes(id));
      if (task.tagIds.length !== originalLength) {
        tasksUpdated++;
      }
    }
  });
  console.log(`Cleaned tags from ${tasksUpdated} tasks.`);

  // 3. ENSURE THEMES (Safety Check)
  // We know CEO/CTO projects might exist, let's double check they have themes
  Object.values(data.project.entities).forEach((p) => {
    if (!p.theme || !p.theme.primary) {
      console.log(`Fixing missing theme for project: ${p.title}`);
      p.theme = {
        isAutoContrast: true,
        isDisableBackgroundTint: false,
        primary: '#424242', // Default safe grey
        huePrimary: '500',
        accent: '#ff4081',
        hueAccent: '500',
        warn: '#e11826',
        hueWarn: '500',
        backgroundImageDark: '',
        backgroundImageLight: null,
      };
    }
  });

  // Write the rescued file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(backup, null, 2));
  console.log(`Successfully generated ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Error processing file:', err);
}
