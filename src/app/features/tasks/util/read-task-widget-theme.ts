import { TaskWidgetTheme } from '../../../../../electron/shared-with-frontend/task-widget-view.model';

const isOpaque = (color: string): boolean => {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) {
    return true;
  }
  context.fillStyle = color;
  // Canvas reports opaque colors as hex, and anything translucent as rgba().
  return String(context.fillStyle).startsWith('#');
};

/**
 * The widget is a separate window that cannot see the app's stylesheet, so it
 * gets the theme's resolved colors. Reading them here keeps it matching built-in
 * themes, custom themes and each project's color without knowing about any.
 */
export const readTaskWidgetTheme = (): TaskWidgetTheme => {
  // Dark mode sets its values on the body, so the root element would miss them.
  const styles = getComputedStyle(document.body);
  const read = (name: string): string => styles.getPropertyValue(name).trim();

  // Glass-style themes make cards see-through, which works over the app's own
  // background but not over the desktop.
  const card = read('--card-bg');

  return {
    surface: isOpaque(card) ? card : read('--surface-2'),
    text: read('--text-color'),
    textMuted: read('--text-color-muted'),
    border: read('--divider-color'),
    // Unlike --c-primary, this stays readable on both light and dark surfaces.
    primary: read('--brand'),
    focus: read('--c-accent'),
    warning: read('--color-warning'),
  };
};
