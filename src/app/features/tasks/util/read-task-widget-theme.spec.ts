import { readTaskWidgetTheme } from './read-task-widget-theme';

describe('readTaskWidgetTheme', () => {
  const VARIABLES = ['--card-bg', '--surface-2', '--brand', '--color-warning'];

  afterEach(() => {
    VARIABLES.forEach((name) => document.body.style.removeProperty(name));
  });

  it('reads the resolved colors from the body, where dark mode sets them', () => {
    document.body.style.setProperty('--card-bg', 'rgb(1, 2, 3)');
    document.body.style.setProperty('--brand', 'rgb(4, 5, 6)');
    document.body.style.setProperty('--color-warning', 'rgb(7, 8, 9)');

    expect(readTaskWidgetTheme()).toEqual(
      jasmine.objectContaining({
        surface: 'rgb(1, 2, 3)',
        primary: 'rgb(4, 5, 6)',
        warning: 'rgb(7, 8, 9)',
      }),
    );
  });

  it('follows a theme that defines a color in terms of another variable', () => {
    document.body.style.setProperty('--color-warning', 'rgb(7, 8, 9)');
    document.body.style.setProperty('--brand', 'var(--color-warning)');

    expect(readTaskWidgetTheme().primary).toBe('rgb(7, 8, 9)');
  });

  ['transparent', 'rgba(255, 255, 255, 0.05)', 'rgba(44, 46, 54, 0.88)'].forEach(
    (card) => {
      it(`does not use a see-through card such as ${card}`, () => {
        document.body.style.setProperty('--card-bg', card);
        document.body.style.setProperty('--surface-2', 'rgb(35, 35, 38)');

        expect(readTaskWidgetTheme().surface).toBe('rgb(35, 35, 38)');
      });
    },
  );
});
