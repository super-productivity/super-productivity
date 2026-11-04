import { Component } from 'solid-js';

interface LoadingSpinnerProps {
  message?: string;
}

export const LoadingSpinner: Component<LoadingSpinnerProps> = (props) => {
  return (
    <div class="row">
      <span class="spinner" />
      <span class="text-muted">{props.message || 'Loading...'}</span>
    </div>
  );
};
