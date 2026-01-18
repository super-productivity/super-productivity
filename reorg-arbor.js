const fs = require('fs');

const INPUT_FILE = '/home/mchang/Downloads/super-productivity-backup.json';
const OUTPUT_FILE = 'arbor-organized.json';

// IDs found by the agent in the previous step
const CEO_PROJECT_ID = '1b4f3e39-149a-4b57-b9e2-8a4de070b59f';
const CTO_PROJECT_ID = '52543ee5-cb03-4236-9250-a32dfedec163';
const INBOX_ID = 'INBOX_PROJECT';

// Keywords for categorization
const CTO_KEYWORDS = [
  'Install',
  'GitHub',
  'WebDAV',
  'Voxtype',
  'Siri',
  'Taiga',
  'Dashboard',
  'GPU',
  'pytaiga',
  'SP-MCP',
  'n8n',
  'Jira',
  'Anytype',
];
const CEO_KEYWORDS = ['Trello', 'KPI', 'Edwin'];

try {
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
  const backup = JSON.parse(fileContent);
  const data = backup.data;

  const tasks = data.task.entities;
  const projects = data.project.entities;

  // Initialize task lists for our target projects if they don't exist
  // Default structure to avoid crashes (missing theme/advancedCfg)
  const DEFAULT_PROJECT_THEME = {
    isAutoContrast: true,
    isDisableBackgroundTint: false,
    primary: '#424242',
    huePrimary: '500',
    accent: '#ff4081',
    hueAccent: '500',
    warn: '#e11826',
    hueWarn: '500',
    backgroundImageDark: '',
    backgroundImageLight: null,
  };

  const DEFAULT_ADVANCED_CFG = {
    worklogExportSettings: {
      cols: ['DATE', 'START', 'END', 'TIME_CLOCK', 'TITLES_INCLUDING_SUB'],
      roundWorkTimeTo: null,
      roundStartTimeTo: null,
      roundEndTimeTo: null,
      separateTasksBy: ' | ',
      groupBy: 'DATE',
    },
  };

  if (!projects[CEO_PROJECT_ID]) {
    console.log('Creating placeholder for CEO project structure just in case...');
    projects[CEO_PROJECT_ID] = {
      id: CEO_PROJECT_ID,
      title: 'CEO',
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
      isHiddenFromMenu: false,
      isArchived: false,
      isEnableBacklog: false,
      icon: 'list_alt',
      theme: { ...DEFAULT_PROJECT_THEME, primary: '#0000FF' }, // Blue
      advancedCfg: DEFAULT_ADVANCED_CFG,
    };
  }
  if (!projects[CTO_PROJECT_ID]) {
    console.log('Creating placeholder for CTO project structure just in case...');
    projects[CTO_PROJECT_ID] = {
      id: CTO_PROJECT_ID,
      title: 'CTO',
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
      isHiddenFromMenu: false,
      isArchived: false,
      isEnableBacklog: false,
      icon: 'list_alt',
      theme: { ...DEFAULT_PROJECT_THEME, primary: '#00FF00' }, // Green
      advancedCfg: DEFAULT_ADVANCED_CFG,
    };
  }
  if (!projects[CTO_PROJECT_ID]) {
    console.log('Creating placeholder for CTO project structure just in case...');
    projects[CTO_PROJECT_ID] = {
      id: CTO_PROJECT_ID,
      title: 'CTO',
      taskIds: [],
      backlogTaskIds: [],
    };
  }

  const ceoProject = projects[CEO_PROJECT_ID];
  const ctoProject = projects[CTO_PROJECT_ID];
  const inboxProject = projects[INBOX_ID];

  console.log(`Initial Inbox Count: ${inboxProject.taskIds.length}`);

  // Iterate through all tasks
  Object.values(tasks).forEach((task) => {
    // Only move tasks that are currently in the Inbox or have no project
    if (task.projectId === INBOX_ID || !task.projectId) {
      let targetProjectId = null;

      // Check keywords
      if (CTO_KEYWORDS.some((k) => task.title.includes(k))) {
        targetProjectId = CTO_PROJECT_ID;
      } else if (CEO_KEYWORDS.some((k) => task.title.includes(k))) {
        targetProjectId = CEO_PROJECT_ID;
      }

      // If a target is found, move the task
      if (targetProjectId) {
        console.log(
          `Moving "${task.title}" to ${targetProjectId === CEO_PROJECT_ID ? 'CEO' : 'CTO'}`,
        );

        // 1. Update Task
        task.projectId = targetProjectId;

        // 2. Add to Target Project List
        if (targetProjectId === CEO_PROJECT_ID) {
          ceoProject.taskIds.push(task.id);
        } else {
          ctoProject.taskIds.push(task.id);
        }

        // 3. Remove from Inbox List (if present)
        const inboxIndex = inboxProject.taskIds.indexOf(task.id);
        if (inboxIndex > -1) {
          inboxProject.taskIds.splice(inboxIndex, 1);
        }
      }
    }
  });

  console.log(`Final Inbox Count: ${inboxProject.taskIds.length}`);
  console.log(`CEO Task Count: ${ceoProject.taskIds.length}`);
  console.log(`CTO Task Count: ${ctoProject.taskIds.length}`);

  // Write the modified data back
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(backup, null, 2));
  console.log(`Successfully saved organized backup to ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Error processing file:', err);
}
