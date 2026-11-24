import { Component, createSignal, Show } from 'solid-js';
import HomeView from './components/HomeView';
import CategoryView from './components/CategoryView';
import PromptView from './components/PromptView';
import CustomPromptManager from './components/CustomPromptManager';
import CustomPromptEditor from './components/CustomPromptEditor';
import { useNavigation } from './hooks/useNavigation';
import { Button } from './components/shared/Button';
import './App.css';

const App: Component = () => {
  const [generatedPrompt, setGeneratedPrompt] = createSignal<string>('');

  const {
    currentView,
    selectedCategory,
    selectedPrompt,
    editingPrompt,
    navigateToCategory,
    navigateToPrompt,
    navigateToCustomPrompts,
    navigateToCustomPrompt,
    navigateToCustomPromptEditor,
    navigateBack,
    saveCustomPrompt,
    cancelCustomPromptEdit,
  } = useNavigation();

  const handlePromptUpdate = (prompt: string) => {
    setGeneratedPrompt(prompt);
  };

  const showBackButton = () => currentView() !== 'home';

  return (
    <div class="page">
      <Show when={showBackButton()}>
        <header class="page-header page-fade">
          <Button
            variant="back"
            onClick={navigateBack}
          >
            ← Back
          </Button>
        </header>
      </Show>

      <main>
        <Show when={currentView() === 'home'}>
          <HomeView
            onSelectCategory={navigateToCategory}
            onCustomPromptsClick={navigateToCustomPrompts}
          />
        </Show>

        <Show when={currentView() === 'category' && selectedCategory()}>
          <CategoryView
            category={selectedCategory()!}
            onSelectPrompt={navigateToPrompt}
          />
        </Show>

        <Show when={currentView() === 'prompt' && selectedPrompt()}>
          <PromptView
            selectedPrompt={selectedPrompt()!}
            onUpdatePrompt={handlePromptUpdate}
          />
        </Show>

        <Show when={currentView() === 'custom'}>
          <CustomPromptManager
            onSelectPrompt={navigateToCustomPrompt}
            onEditPrompt={navigateToCustomPromptEditor}
          />
        </Show>

        <Show when={currentView() === 'custom-editor'}>
          <CustomPromptEditor
            prompt={editingPrompt()?.prompt || null}
            index={editingPrompt()?.index}
            onSave={saveCustomPrompt}
            onCancel={cancelCustomPromptEdit}
          />
        </Show>
      </main>
    </div>
  );
};

export default App;
