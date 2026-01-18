const fs = require('fs');
const uuid = require('uuidv7').uuidv7;

const NOW = Date.now();

// --- Constants & Defaults ---
const DEFAULT_PROJECT_COLOR = '#424242'; // Dark Grey default
const CEO_COLOR = '#0000FF'; // Blue
const CTO_COLOR = '#00FF00'; // Green

const DEFAULT_THEME = {
  isAutoContrast: true,
  isDisableBackgroundTint: false,
  primary: DEFAULT_PROJECT_COLOR,
  huePrimary: '500',
  accent: '#ff4081',
  hueAccent: '500',
  warn: '#e11826',
  hueWarn: '500',
  backgroundImageDark: '',
  backgroundImageLight: '',
};

// Helper to create a Project object
function createProject(title, color) {
  const id = uuid();
  return {
    id: id,
    title: title,
    isArchived: false,
    isHiddenFromMenu: false,
    isEnableBacklog: false,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    theme: { ...DEFAULT_THEME, primary: color || DEFAULT_PROJECT_COLOR },
    advancedCfg: { worklogExportSettings: {} },
    icon: 'list_alt',
  };
}

// Helper to create a Task object
function createTask(title, projectId, parentId = null) {
  const id = uuid();
  return {
    id: id,
    projectId: projectId,
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    title: title,
    tagIds: [],
    created: NOW,
    attachments: [],
    parentId: parentId,
    reminderId: null,
    _showSubTasksMode: 2, // Show all
  };
}

// --- 1. Define Projects ---
const pCEO = createProject('CEO', CEO_COLOR);
const pCTO = createProject('CTO', CTO_COLOR);
const pInbox = {
  ...createProject('Inbox', DEFAULT_PROJECT_COLOR),
  id: 'INBOX_PROJECT',
  title: 'Inbox',
}; // Standard Inbox

// --- 2. Define Tasks (from User's Plan) ---

// M1: Install SP (Done-ish, but keeping for record in CTO/Dev)
const tM1 = createTask('M1: Install Superproductivity on CachyOS', pCTO.id);

// M2: Create Projects (We are doing this now, so mark done? No, leave for user to check off)
const tM2 = createTask('M2: Create CEO and CTO Projects in SP', pCEO.id);

// M3: Connect SP -> Trello (CEO task)
const tM3 = createTask("M3: Connect SP → Trello (Edwin's Lifeline)", pCEO.id);

// M4: Connect SP -> GitHub (CTO task)
const tM4 = createTask('M4: Connect SP → GitHub (Dev Work Visibility)', pCTO.id);

// M5: WebDAV Sync (CTO/Infra)
const tM5 = createTask('M5: WebDAV Sync to NAS (Data Sovereignty)', pCTO.id);

// M6: GitHub -> Taiga Webhook (CTO/DevOps)
const tM6 = createTask('M6: Enable GitHub → Taiga Webhook', pCTO.id);

// S1: Voxtype (CTO/Tools)
const tS1 = createTask('S1: Install Voxtype for Voice Brain Dumps', pCTO.id);

// S2: Siri -> SP API (CTO/Dev)
const tS2 = createTask('S2: Siri → SP API Bridge (iPhone Voice Capture)', pCTO.id);

// S3: Taiga -> Discord (CTO/DevOps)
const tS3 = createTask('S3: Taiga → Discord Webhook Relay', pCTO.id);

// S4: pytaiga-mcp (CTO/AI)
const tS4 = createTask('S4: Test pytaiga-mcp with Claude Desktop', pCTO.id);

// S5: SP-MCP (CTO/AI)
const tS5 = createTask('S5: Test SP-MCP with Claude Desktop', pCTO.id);

// C1: Trello -> Discord (CEO/CTO overlap, put in CEO as it relates to Edwin)
const tC1 = createTask('C1: Trello → Discord Webhook (If Edwin Wants)', pCEO.id);

// C2: KPI Automation (CEO/Metrics)
const tC2 = createTask('C2: Weekly KPI Automation Script', pCEO.id);

// C3: Dashboard/Waybar (CTO/Linux)
const tC3 = createTask('C3: Custom SP Dashboard/Waybar Integration', pCTO.id);

// C4: GPU Voxtype (CTO/Hardware)
const tC4 = createTask('C4: GPU Acceleration for Voxtype', pCTO.id);

// Wont Have (Backlog Items or Notes?) - Let's put them in a "WONT" parent task or just backlog
// For now, let's just add them as tasks in CTO but maybe tagged "Low Priority" if we had tags set up.
// Actually, let's put them in the BACKLOG of CTO project.
const tW1 = createTask('W1: Taiga ↔ Trello Bidirectional Sync', pCTO.id);
const tW2 = createTask('W2: Anytype Integration', pCTO.id);
const tW3 = createTask('W3: n8n Deployment (Security Risk)', pCTO.id);
const tW4 = createTask('W4: Jira Integration', pCTO.id);
const tW5 = createTask('W5: Make GitHub → Taiga Bidirectional', pCTO.id);

// --- 3. Assemble Data Structure ---

// Add tasks to projects
pCEO.taskIds = [tM2.id, tM3.id, tC1.id, tC2.id];
pCTO.taskIds = [
  tM1.id,
  tM4.id,
  tM5.id,
  tM6.id,
  tS1.id,
  tS2.id,
  tS3.id,
  tS4.id,
  tS5.id,
  tC3.id,
  tC4.id,
];
pCTO.backlogTaskIds = [tW1.id, tW2.id, tW3.id, tW4.id, tW5.id];

// All tasks array
const allTasks = [
  tM1,
  tM2,
  tM3,
  tM4,
  tM5,
  tM6,
  tS1,
  tS2,
  tS3,
  tS4,
  tS5,
  tC1,
  tC2,
  tC3,
  tC4,
  tW1,
  tW2,
  tW3,
  tW4,
  tW5,
];

// Entities map
const taskEntities = {};
allTasks.forEach((t) => (taskEntities[t.id] = t));

const projectEntities = {};
[pCEO, pCTO, pInbox].forEach((p) => (projectEntities[p.id] = p));

// The final JSON structure expected by Super Productivity Import
const finalJson = {
  lastActiveTime: NOW,
  project: {
    ids: [pInbox.id, pCEO.id, pCTO.id],
    entities: projectEntities,
  },
  task: {
    ids: allTasks.map((t) => t.id),
    entities: taskEntities,
  },
  // Basic empty states for other required keys to avoid crashes
  note: { ids: [], entities: {} },
  tag: { ids: [], entities: {} },
  metric: { ids: [], entities: {} },
  improvement: { ids: [], entities: {} },
  obstruction: { ids: [], entities: {} },
  simpleCounter: { ids: [], entities: {} },
  taskArchive: { ids: [], entities: {} },
  taskRepeatCfg: { ids: [], entities: {} },
  globalConfig: {
    // Minimal config to ensure it loads
    localBackup: { isEnabled: true },
    misc: { isConfirmBeforeExit: false },
  },
};

fs.writeFileSync('arbor-import.json', JSON.stringify(finalJson, null, 2));
console.log('Successfully generated arbor-import.json');
