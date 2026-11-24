import { Component, For } from 'solid-js';
import { PromptCategory } from '../types';
import { PROMPT_CATEGORIES } from '../prompts';
import { Card } from './shared/Card';

interface HomeViewProps {
  onSelectCategory: (category: PromptCategory) => void;
  onCustomPromptsClick: () => void;
}

const HomeView: Component<HomeViewProps> = (props) => {
  return (
    <>
      <div class="intro page-fade">
        <h2>AI Productivity Prompts</h2>
        <p class="text-muted">Choose what you need help with:</p>
      </div>

      <div class="grid page-fade">
        <For each={PROMPT_CATEGORIES}>
          {(category) => (
            <CategoryCard
              category={category}
              onClick={() => props.onSelectCategory(category)}
            />
          )}
        </For>

        <Card onClick={props.onCustomPromptsClick}>
          <h3>My Custom Prompts</h3>
          <p class="text-muted">Create & manage your own prompts</p>
        </Card>
      </div>
    </>
  );
};

// Extracted CategoryCard component
const CategoryCard: Component<{
  category: PromptCategory;
  onClick: () => void;
}> = (props) => {
  return (
    <Card onClick={props.onClick}>
      <h3>{props.category.title}</h3>
      <p class="text-muted">{props.category.prompts.length} prompts</p>
    </Card>
  );
};

export default HomeView;
