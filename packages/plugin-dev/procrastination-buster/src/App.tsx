import { Component, createSignal, Show, For, createEffect, onMount } from 'solid-js';
import {
  ProcrastinationType,
  getProcrastinationTypes,
  PluginMessageType,
  WindowMessageType,
} from './types';
import { ProcrastinationInfo } from './ProcrastinationInfo';
import { useTranslate } from './utils/useTranslate';
import './App.css';

type ViewState = 'home' | 'info' | 'strategies';

const App: Component = () => {
  const t = useTranslate();
  const [currentView, setCurrentView] = createSignal<ViewState>('home');
  const [selectedType, setSelectedType] = createSignal<ProcrastinationType | null>(null);
  const [procrastinationTypes, setProcrastinationTypes] = createSignal<
    ProcrastinationType[]
  >([]);

  // Translation signals
  const [homeTitle, setHomeTitle] = createSignal('');
  const [homeSubtitle, setHomeSubtitle] = createSignal('');
  const [learnMoreButton, setLearnMoreButton] = createSignal('');
  const [backButton, setBackButton] = createSignal('');
  const [strategiesTitle, setStrategiesTitle] = createSignal('');
  const [actionButton, setActionButton] = createSignal('');
  const [actionButtonTitle, setActionButtonTitle] = createSignal('');

  // Load translations and reload when language changes
  createEffect(() => {
    // Watch for language changes by accessing the currentLanguage signal
    const lang = t.currentLanguage();

    // Load all translations (this runs on mount AND when language changes)
    (async () => {
      setHomeTitle(await t('HOME.TITLE'));
      setHomeSubtitle(await t('HOME.SUBTITLE'));
      setLearnMoreButton(await t('HOME.LEARN_MORE_BUTTON'));
      setBackButton(await t('NAVIGATION.BACK'));
      setStrategiesTitle(await t('STRATEGIES.TITLE'));
      setActionButton(await t('STRATEGIES.ACTION_BUTTON'));
      setActionButtonTitle(await t('STRATEGIES.ACTION_BUTTON_TITLE'));

      // Load procrastination types with translations
      const types = await getProcrastinationTypes(t);
      setProcrastinationTypes(types);
    })();
  });

  const handleSelectType = (type: ProcrastinationType) => {
    setSelectedType(type);
    setCurrentView('strategies');
  };

  const handleBack = () => {
    setCurrentView('home');
    setSelectedType(null);
  };

  const sendPluginMessage = async (type: string, payload?: any) => {
    const pluginAPI = (window as any).PluginAPI;
    if (pluginAPI) {
      switch (type) {
        case PluginMessageType.START_FOCUS_MODE:
          return pluginAPI.dispatchAction({
            type: '[FocusMode] Show Focus Overlay',
          });
        case 'START_POMODORO':
          return pluginAPI.dispatchAction({
            type: '[Pomodoro] Start Pomodoro',
          });
      }
    }
  };

  return (
    <div class="app">
      <Show when={currentView() !== 'home'}>
        <header class="header page-fade">
          <button
            class="back-button"
            onClick={handleBack}
          >
            {backButton()}
          </button>
        </header>
      </Show>

      <main class="main">
        {/* Home View */}
        <Show when={currentView() === 'home'}>
          <div class="intro page-fade">
            <h2>{homeTitle()}</h2>
            <p class="text-muted">{homeSubtitle()}</p>
            <button
              class="info-button"
              onClick={() => setCurrentView('info')}
            >
              {learnMoreButton()}
            </button>
          </div>

          <div class="blocker-grid page-fade">
            <For each={procrastinationTypes()}>
              {(type) => (
                <button
                  class="blocker-card card card-clickable"
                  onClick={() => handleSelectType(type)}
                >
                  <h3 class="text-primary">{type.title}</h3>
                  <p class="text-muted">{type.emotion}</p>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Info View */}
        <Show when={currentView() === 'info'}>
          <ProcrastinationInfo
            onBackToWork={() => sendPluginMessage(PluginMessageType.START_FOCUS_MODE)}
          />
        </Show>

        {/* Strategies View */}
        <Show when={currentView() === 'strategies' && selectedType()}>
          <div class="strategy-container page-fade">
            <div class="selected-type">
              <h2 class="text-primary">{selectedType()!.title}</h2>
              <p class="emotion text-muted">{selectedType()!.emotion}</p>
            </div>

            <h3>{strategiesTitle()}</h3>

            <div class="strategy-list">
              <For each={selectedType()!.strategies}>
                {(strategy) => {
                  const text = typeof strategy === 'string' ? strategy : strategy.text;
                  const hasAction = typeof strategy !== 'string' && strategy.action;

                  return (
                    <div class="strategy-item card">
                      <div class="strategy-content">
                        <p class="strategy-text">{text}</p>
                        <Show when={hasAction}>
                          <button
                            class="strategy-action-btn"
                            onClick={() => sendPluginMessage('START_POMODORO')}
                            title={actionButtonTitle()}
                          >
                            {actionButton()}
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </main>
    </div>
  );
};

export default App;
