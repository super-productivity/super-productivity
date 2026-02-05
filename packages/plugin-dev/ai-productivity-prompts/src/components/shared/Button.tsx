import { Component, JSX } from 'solid-js';

interface ButtonProps {
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'back';
  disabled?: boolean;
  title?: string;
  class?: string;
  children: JSX.Element;
}

export const Button: Component<ButtonProps> = (props) => {
  const getButtonClass = () => {
    const customClass = props.class || '';
    switch (props.variant) {
      case 'back':
      case 'secondary':
        return `btn-outline ${customClass}`.trim();
      case 'primary':
      default:
        return `btn-primary ${customClass}`.trim();
    }
  };

  return (
    <button
      class={getButtonClass()}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.children}
    </button>
  );
};
