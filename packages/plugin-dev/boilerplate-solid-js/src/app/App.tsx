import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import { Task, Project } from '@super-productivity/plugin-api';
import { useTranslate } from '../utils/useTranslate';
import './App.css';

// Communication with plugin.js
const sendMessage = async (type: string, payload?: any) => {
  return new Promise((resolve) => {
    const messageId = Math.random().toString(36).substr(2, 9);

    const handler = (event: MessageEvent) => {
      if (event.data.messageId === messageId) {
        window.removeEventListener('message', handler);
        resolve(event.data.response);
      }
    };

    window.addEventListener('message', handler);
    window.parent.postMessage({ type, payload, messageId }, '*');
  });
};

function App() {
  const t = useTranslate();
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [stats, setStats] = createSignal({
    totalTasks: 0,
    completedToday: 0,
    pendingTasks: 0,
  });
  const [newTaskTitle, setNewTaskTitle] = createSignal('');
  const [selectedProjectId, setSelectedProjectId] = createSignal<string>('');
  const [settings, setSettings] = createSignal({ theme: 'light', showCompleted: true });
  const [isLoading, setIsLoading] = createSignal(true);

  // Translation signals for reactive i18n
  const [appTitle, setAppTitle] = createSignal('');
  const [refreshButton, setRefreshButton] = createSignal('');
  const [totalTasksLabel, setTotalTasksLabel] = createSignal('');
  const [completedTodayLabel, setCompletedTodayLabel] = createSignal('');
  const [pendingLabel, setPendingLabel] = createSignal('');
  const [createNewLabel, setCreateNewLabel] = createSignal('');
  const [taskPlaceholder, setTaskPlaceholder] = createSignal('');
  const [noProjectLabel, setNoProjectLabel] = createSignal('');
  const [createButtonLabel, setCreateButtonLabel] = createSignal('');
  const [loadingLabel, setLoadingLabel] = createSignal('');

  // Load translations
  createEffect(async () => {
    setAppTitle(await t('APP.TITLE'));
    setRefreshButton(await t('BUTTONS.REFRESH'));
    setTotalTasksLabel(await t('STATS.TOTAL_TASKS'));
    setCompletedTodayLabel(await t('STATS.COMPLETED_TODAY'));
    setPendingLabel(await t('STATS.PENDING'));
    setCreateNewLabel(await t('TASK.CREATE_NEW'));
    setTaskPlaceholder(await t('TASK.ENTER_TITLE'));
    setNoProjectLabel(await t('TASK.NO_PROJECT'));
    setCreateButtonLabel(await t('TASK.CREATE_BUTTON'));
    setLoadingLabel(await t('LOADING'));
  });

  // Load initial data
  onMount(async () => {
    try {
      setIsLoading(true);

      // Load settings
      const savedSettings = (await sendMessage('loadSettings')) as any;
      if (savedSettings && Object.keys(savedSettings).length > 0) {
        setSettings(savedSettings);
      }

      // Load stats
      const statsData = (await sendMessage('getStats')) as any;
      setStats(statsData);

      // Load tasks and projects
      await refreshData();
    } catch (error) {
      console.error('Failed to load initial data:', error);
    } finally {
      setIsLoading(false);
    }
  });

  // Refresh data from Super Productivity
  const refreshData = async () => {
    try {
      const [tasksData, projectsData] = await Promise.all([
        sendMessage('getTasks'),
        sendMessage('getAllProjects'),
      ]);

      setTasks(tasksData as Task[]);
      setProjects(projectsData as Project[]);
    } catch (error) {
      console.error('Failed to refresh data:', error);
    }
  };

  // Create a new task
  const createTask = async () => {
    const title = newTaskTitle().trim();
    if (!title) return;

    try {
      await sendMessage('createTask', {
        title,
        projectId: selectedProjectId() || undefined,
      });

      setNewTaskTitle('');
      await refreshData();

      // Update stats
      const statsData = (await sendMessage('getStats')) as any;
      setStats(statsData);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  // Save settings
  createEffect(() => {
    const currentSettings = settings();
    sendMessage('saveSettings', currentSettings);
  });

  // Apply theme
  createEffect(() => {
    document.body.setAttribute('data-theme', settings().theme);
  });

  return (
    <div class="app">
      <header class="app-header">
        <h1>🚀 {appTitle()}</h1>
        <button onClick={refreshData} class="refresh-btn">
          {refreshButton()}
        </button>
      </header>

      <Show
        when={isLoading()}
        fallback={
          <main class="app-main">
            {/* Stats Section */}
            <section class="stats-section">
              <div class="stat-card">
                <div class="stat-value">{stats().totalTasks}</div>
                <div class="stat-label">{totalTasksLabel()}</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{stats().completedToday}</div>
                <div class="stat-label">{completedTodayLabel()}</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{stats().pendingTasks}</div>
                <div class="stat-label">{pendingLabel()}</div>
              </div>
            </section>

            {/* Create Task Section */}
            <section class="create-task-section">
              <h2>{createNewLabel()}</h2>
              <div class="create-task-form">
                <input
                  type="text"
                  placeholder={taskPlaceholder()}
                  value={newTaskTitle()}
                  onInput={(e) => setNewTaskTitle(e.currentTarget.value)}
                  onKeyPress={(e) => e.key === 'Enter' && createTask()}
                  class="task-input"
                />
                <select
                  value={selectedProjectId()}
                  onChange={(e) => setSelectedProjectId(e.currentTarget.value)}
                  class="project-select"
                >
                  <option value="">{noProjectLabel()}</option>
                  <For each={projects()}>
                    {(project) => <option value={project.id}>{project.title}</option>}
                  </For>
                </select>
                <button onClick={createTask} class="create-btn">
                  {createButtonLabel()}
                </button>
              </div>
            </section>

            {/* Tasks List Section */}
            <section class="tasks-section">
              <h2>Recent Tasks</h2>
              <div class="tasks-list">
                <For each={tasks().slice(0, 10)}>
                  {(task) => (
                    <div class="task-item" classList={{ completed: task.isDone }}>
                      <span class="task-title">{task.title}</span>
                      <Show when={task.projectId}>
                        <span class="task-project">
                          {projects().find((p) => p.id === task.projectId)?.title}
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>

            {/* Settings Section */}
            <section class="settings-section">
              <h2>Settings</h2>
              <div class="settings-form">
                <label class="setting-item">
                  <span>Theme:</span>
                  <select
                    value={settings().theme}
                    onChange={(e) => setSettings({ ...settings(), theme: e.currentTarget.value })}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label class="setting-item">
                  <input
                    type="checkbox"
                    checked={settings().showCompleted}
                    onChange={(e) =>
                      setSettings({
                        ...settings(),
                        showCompleted: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>Show completed tasks</span>
                </label>
              </div>
            </section>
          </main>
        }
      >
        <div class="loading">{loadingLabel()}</div>
      </Show>

      <footer class="app-footer">
        <p>Built with Solid.js and Super Productivity Plugin API</p>
      </footer>
    </div>
  );
}

export default App;
