import { Component, For } from 'solid-js';
import { PromptCategory } from '../types';
import { Card } from './shared/Card';

interface CategoryViewProps {
  category: PromptCategory;
  onSelectPrompt: (prompt: { title: string; template: string }) => void;
}

const CategoryView: Component<CategoryViewProps> = (props) => {
  return (
    <div class="stack page-fade">
      <h2 class="intro">{props.category.title}</h2>

      <h3>Available Prompts:</h3>

      <div class="stack">
        <For each={props.category.prompts}>
          {(prompt) => (
            <Card onClick={() => props.onSelectPrompt(prompt)}>
              <h4>{prompt.title}</h4>
            </Card>
          )}
        </For>
      </div>
    </div>
  );
};

export default CategoryView;
