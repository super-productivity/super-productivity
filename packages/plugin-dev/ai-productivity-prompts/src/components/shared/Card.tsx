import { Component, JSX, Show } from 'solid-js';

interface CardProps {
  onClick?: () => void;
  class?: string;
  children: JSX.Element;
}

export const Card: Component<CardProps> = (props) => {
  const customClass = () => props.class || '';

  // A static card must not be a (disabled) button: disabled styling would dim it.
  return (
    <Show
      when={props.onClick}
      fallback={<div class={`card ${customClass()}`.trim()}>{props.children}</div>}
    >
      <button
        class={`card card-clickable ${customClass()}`.trim()}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Show>
  );
};
