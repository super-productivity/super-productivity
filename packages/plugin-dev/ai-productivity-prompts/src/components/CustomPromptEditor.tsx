import { Component, createSignal, onMount } from 'solid-js';
import { CustomPrompt } from '../types';
import { CustomPromptStore } from '../customPromptStore';

interface CustomPromptEditorProps {
  prompt: CustomPrompt | null;
  index?: number;
  onSave: () => void;
  onCancel: () => void;
}

const CustomPromptEditor: Component<CustomPromptEditorProps> = (props) => {
  const [promptTitle, setPromptTitle] = createSignal<string>('');
  const [promptText, setPromptText] = createSignal<string>('');
  const [isSaving, setIsSaving] = createSignal<boolean>(false);

  const store = CustomPromptStore.getInstance();
  const isEditing = () => props.prompt !== null;

  onMount(() => {
    if (props.prompt) {
      setPromptTitle(props.prompt.title);
      setPromptText(props.prompt.template);
    }
  });

  const handleSave = async () => {
    const title = promptTitle().trim();
    const text = promptText().trim();

    if (!title) {
      alert('Please enter a title for your prompt.');
      return;
    }

    if (!text) {
      alert('Please enter a prompt template.');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing() && props.index !== undefined) {
        await store.updatePrompt(props.index, title, text);
      } else {
        await store.addPrompt(title, text);
      }
      props.onSave();
    } catch (error) {
      console.error('Error saving prompt:', error);
      alert('Error saving prompt. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div class="page-fade">
      <div class="editor-header">
        <h2 class="text-primary">
          {isEditing() ? 'Edit Custom Prompt' : 'Create Custom Prompt'}
        </h2>
      </div>

      <div class="editor-container">
        <div class="editor-instructions">
          <p class="text-muted">
            Create a custom prompt template. Your current tasks will be automatically
            appended when you use this prompt.
          </p>
          <p class="text-muted">
            <strong>Tip:</strong> Press Ctrl+Enter (or Cmd+Enter) to save quickly.
          </p>
        </div>

        <div class="editor-field">
          <label
            for="prompt-title"
            class="field-label"
          >
            Prompt Title:
          </label>
          <input
            id="prompt-title"
            type="text"
            class="prompt-title-input"
            value={promptTitle()}
            onInput={(e) => setPromptTitle(e.currentTarget.value)}
            placeholder="e.g., Daily Priority Planner"
            autocomplete="off"
          />
        </div>

        <div class="editor-field">
          <label
            for="prompt-textarea"
            class="field-label"
          >
            Prompt Template:
          </label>
          <textarea
            id="prompt-textarea"
            class="prompt-textarea"
            value={promptText()}
            onInput={(e) => setPromptText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your custom prompt here... 

Example:
Help me prioritize my tasks for maximum impact today. Consider:
- Urgency vs importance
- Dependencies between tasks  
- My current energy level
- Available time blocks

Give me a specific action plan with time estimates."
            rows="12"
            autocomplete="off"
            spellcheck={true}
          />
        </div>

        <div class="editor-actions">
          <button
            class="btn-outline"
            onClick={props.onCancel}
            disabled={isSaving()}
          >
            Cancel
          </button>
          <button
            class="btn-primary"
            onClick={handleSave}
            disabled={isSaving() || !promptTitle().trim() || !promptText().trim()}
          >
            {isSaving() ? 'Saving...' : isEditing() ? 'Update Prompt' : 'Save Prompt'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomPromptEditor;
