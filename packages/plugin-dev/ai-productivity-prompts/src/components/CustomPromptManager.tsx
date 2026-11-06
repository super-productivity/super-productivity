import { Component, createSignal, For, onMount } from 'solid-js';
import { CustomPrompt } from '../types';
import { CustomPromptStore } from '../customPromptStore';
import { truncateText } from '../utils';
import { Button } from './shared/Button';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { EmptyState } from './shared/EmptyState';
import { Card } from './shared/Card';

interface CustomPromptManagerProps {
  onSelectPrompt: (prompt: CustomPrompt, index: number) => void;
  onEditPrompt: (prompt: CustomPrompt | null, index?: number) => void;
}

const CustomPromptManager: Component<CustomPromptManagerProps> = (props) => {
  const [prompts, setPrompts] = createSignal<CustomPrompt[]>([]);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const store = CustomPromptStore.getInstance();

  const loadPrompts = async () => {
    setIsLoading(true);
    try {
      const loadedPrompts = await store.loadPrompts();
      setPrompts(loadedPrompts);
    } catch (error) {
      console.error('Error loading custom prompts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePrompt = async (index: number) => {
    const prompt = prompts()[index];

    if (!confirm(`Delete prompt "${prompt.title}"? This cannot be undone.`)) {
      return;
    }

    try {
      await store.deletePrompt(index);
      await loadPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
      alert('Error deleting prompt. Please try again.');
    }
  };

  const CreatePromptButton = () => (
    <Button onClick={() => props.onEditPrompt(null)}>➕ Add Custom Prompt</Button>
  );

  onMount(loadPrompts);

  return (
    <div class="page-fade">
      <div class="page-header">
        <h2>My Custom Prompts</h2>
        <CreatePromptButton />
      </div>

      {isLoading() ? (
        <LoadingSpinner message="Loading custom prompts..." />
      ) : prompts().length === 0 ? (
        <EmptyState
          title="No custom prompts yet."
          message="Create your first custom prompt to get started!"
          action={<CreatePromptButton />}
        />
      ) : (
        <div class="stack">
          <For each={prompts()}>
            {(prompt, index) => (
              <PromptCard
                prompt={prompt}
                index={index()}
                onSelect={() => props.onSelectPrompt(prompt, index())}
                onEdit={() => props.onEditPrompt(prompt, index())}
                onDelete={() => handleDeletePrompt(index())}
              />
            )}
          </For>
        </div>
      )}
    </div>
  );
};

// Extracted PromptCard component
const PromptCard: Component<{
  prompt: CustomPrompt;
  index: number;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = (props) => {
  return (
    <div class="card">
      <div class="stack">
        <div class="page-header">
          <h3>{props.prompt.title}</h3>
          <div class="row">
            <Button
              variant="icon"
              onClick={props.onEdit}
              title="Edit prompt"
            >
              <span
                class="material-icons"
                aria-hidden="true"
              >
                edit
              </span>
            </Button>
            <Button
              variant="icon"
              onClick={props.onDelete}
              title="Delete prompt"
            >
              <span
                class="material-icons"
                aria-hidden="true"
              >
                delete
              </span>
            </Button>
          </div>
        </div>

        <p class="text-muted">{truncateText(props.prompt.template)}</p>

        <div class="actions">
          <Button onClick={props.onSelect}>Use This Prompt</Button>
        </div>
      </div>
    </div>
  );
};

export default CustomPromptManager;
