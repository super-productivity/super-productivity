// API Test Plugin - Comprehensive test of all plugin API methods
console.log('API Test Plugin initializing...', PluginAPI);

// Plugin configuration
let pluginConfig = null;

// Load plugin configuration on startup
async function loadPluginConfig() {
  try {
    pluginConfig = await PluginAPI.getConfig();
    console.log('Plugin configuration loaded:', pluginConfig);

    if (pluginConfig) {
      // Apply configuration settings
      if (pluginConfig.logLevel) {
        console.log(`Log level set to: ${pluginConfig.logLevel}`);
      }
      if (pluginConfig.enabled === false) {
        console.log('Plugin is disabled by configuration');
        PluginAPI.showSnack({
          msg: 'API Test Plugin is disabled',
          type: 'WARNING',
        });
      }
    } else {
      console.log('No configuration found, using defaults');
    }
  } catch (error) {
    console.error('Failed to load plugin configuration:', error);
  }
}

// Initialize configuration
loadPluginConfig();

// Helper function to log results
function logResult(method, result, error = null) {
  // Check log level from config
  const logLevel = pluginConfig?.logLevel || 'info';

  if (error) {
    console.error(`API Test - ${method} failed:`, error);
    PluginAPI.showSnack({
      msg: `${method} failed: ${error.message}`,
      type: 'ERROR',
    });
  } else {
    if (logLevel === 'debug' || logLevel === 'info') {
      console.log(`API Test - ${method} success:`, result);
    }
  }
}

// Test data persistence
async function testDataPersistence() {
  console.log('=== Testing Data Persistence ===');

  try {
    // Save some test data
    const testData = {
      timestamp: new Date().toISOString(),
      counter: Math.floor(Math.random() * 100),
      message: 'Hello from API Test Plugin!',
    };

    await PluginAPI.persistDataSynced(JSON.stringify(testData));
    logResult('persistDataSynced', 'Data saved successfully');

    // Load it back
    const loadedData = await PluginAPI.loadSyncedData();
    const parsed = loadedData ? JSON.parse(loadedData) : null;
    logResult('loadSyncedData', parsed);

    PluginAPI.showSnack({
      msg: 'Data persistence test passed',
      type: 'SUCCESS',
    });
  } catch (error) {
    logResult('Data Persistence', null, error);
  }
}

// Test task operations
async function testTaskOperations() {
  console.log('=== Testing Task Operations ===');

  try {
    // Get all tasks
    const allTasks = await PluginAPI.getTasks();
    logResult('getTasks', `Found ${allTasks.length} tasks`);

    // Get archived tasks
    const archivedTasks = await PluginAPI.getArchivedTasks();
    logResult('getArchivedTasks', `Found ${archivedTasks.length} archived tasks`);

    // Get current context tasks
    const contextTasks = await PluginAPI.getCurrentContextTasks();
    logResult('getCurrentContextTasks', `Found ${contextTasks.length} context tasks`);

    // Create a test task
    const newTaskId = await PluginAPI.addTask({
      title: 'API Test Task - ' + new Date().toLocaleTimeString(),
      notes: 'This task was created by the API Test Plugin to test the addTask method',
      timeEstimate: 1800000, // 30 minutes in milliseconds
    });
    logResult('addTask', `Created task with ID: ${newTaskId}`);

    // Update the task
    if (newTaskId) {
      await PluginAPI.updateTask(newTaskId, {
        notes: 'Updated: This task was modified by the API Test Plugin',
        timeEstimate: 3600000, // 1 hour
      });
      logResult('updateTask', 'Task updated successfully');
    }

    PluginAPI.showSnack({
      msg: 'Task operations test completed',
      type: 'SUCCESS',
    });
  } catch (error) {
    logResult('Task Operations', null, error);
  }
}

// Test project operations
async function testProjectOperations() {
  console.log('=== Testing Project Operations ===');

  try {
    // Get all projects
    const projects = await PluginAPI.getAllProjects();
    logResult('getAllProjects', `Found ${projects.length} projects`);

    // Create a test project
    const newProject = await PluginAPI.addProject({
      title: 'API Test Project - ' + new Date().toLocaleDateString(),
      themeColor: '#' + Math.floor(Math.random() * 16777215).toString(16), // Random color
    });
    logResult('addProject', `Created project: ${newProject.title}`);

    // Update the project
    if (newProject && newProject.id) {
      await PluginAPI.updateProject(newProject.id, {
        title: newProject.title + ' (Updated)',
      });
      logResult('updateProject', 'Project updated successfully');
    }

    PluginAPI.showSnack({
      msg: 'Project operations test completed',
      type: 'SUCCESS',
    });
  } catch (error) {
    logResult('Project Operations', null, error);
  }
}

// Test tag operations
async function testTagOperations() {
  console.log('=== Testing Tag Operations ===');

  try {
    // Get all tags
    const tags = await PluginAPI.getAllTags();
    logResult('getAllTags', `Found ${tags.length} tags`);

    // Create a test tag
    const newTag = await PluginAPI.addTag({
      title: 'API Test Tag - ' + Date.now(),
      color: '#' + Math.floor(Math.random() * 16777215).toString(16), // Random color
    });
    logResult('addTag', `Created tag: ${newTag.title}`);

    // Update the tag
    if (newTag && newTag.id) {
      await PluginAPI.updateTag(newTag.id, {
        title: newTag.title + ' (Updated)',
      });
      logResult('updateTag', 'Tag updated successfully');
    }

    PluginAPI.showSnack({
      msg: 'Tag operations test completed',
      type: 'SUCCESS',
    });
  } catch (error) {
    logResult('Tag Operations', null, error);
  }
}

// Test UI methods
function testUIOperations() {
  console.log('=== Testing UI Operations ===');

  // Test different snack types
  const snackTypes = ['SUCCESS', 'ERROR', 'INFO'];
  let snackIndex = 0;

  const showNextSnack = () => {
    if (snackIndex < snackTypes.length) {
      const type = snackTypes[snackIndex];
      PluginAPI.showSnack({
        msg: `Test ${type} snack message`,
        type: type,
        ico: type === 'SUCCESS' ? 'check' : type === 'ERROR' ? 'error' : 'info',
      });
      snackIndex++;
      setTimeout(showNextSnack, 1500);
    }
  };

  showNextSnack();

  // Test notification
  setTimeout(() => {
    PluginAPI.notify({
      title: 'API Test Plugin',
      body: 'This is a test notification from the API Test Plugin',
    });
    logResult('notify', 'Notification sent');
  }, 5000);
}

// Register hooks to test them
PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, (taskData) => {
  console.log('API Test - TASK_COMPLETE hook fired:', taskData);
});

PluginAPI.registerHook(PluginAPI.Hooks.TASK_UPDATE, (taskData) => {
  console.log('API Test - TASK_UPDATE hook fired:', taskData);
});

PluginAPI.registerHook(PluginAPI.Hooks.TASK_DELETE, (taskData) => {
  console.log('API Test - TASK_DELETE hook fired:', taskData);
});

PluginAPI.registerHook(PluginAPI.Hooks.CURRENT_TASK_CHANGE, (taskData) => {
  console.log('API Test - CURRENT_TASK_CHANGE hook fired:', taskData);
});

// Register UI elements

PluginAPI.registerShortcut({
  id: 'run_api_tests',
  label: 'Run All API Tests',
  onExec: runAllTests,
});

// Main test runner
async function runAllTests() {
  PluginAPI.showSnack({
    msg: 'Running all API tests...',
    type: 'INFO',
    ico: 'play_arrow',
  });

  console.log('========================================');
  console.log('Starting API Test Plugin Test Suite');
  console.log('========================================');

  // Run tests sequentially
  await testDataPersistence();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await testTaskOperations();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await testProjectOperations();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await testTagOperations();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  testUIOperations();

  console.log('========================================');
  console.log('API Test Suite Completed');
  console.log('========================================');
}

// Show initialization message
setTimeout(() => {
  PluginAPI.showSnack({
    msg: 'API Test Plugin ready! Use header button to run tests.',
    type: 'SUCCESS',
    ico: 'check',
  });
}, 500);
