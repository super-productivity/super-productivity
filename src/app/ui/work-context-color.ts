export const PRESET_COLORS: readonly string[] = [
  '#ef5350', // red
  '#ff7043', // deep orange
  '#ffa726', // orange
  '#ffca28', // amber
  '#ffee58', // yellow
  '#d4e157', // lime
  '#9ccc65', // light green
  '#66bb6a', // green
  '#29a1aa', // teal
  '#26c6da', // cyan
  '#29b6f6', // light blue
  '#42a5f5', // blue
  '#5c6bc0', // indigo
  '#7e57c2', // deep purple
  '#a05db1', // purple
  '#ab47bc', // purple alt
  '#ec407a', // pink
  '#8d6e63', // brown
  '#78909c', // blue grey
];

export const MIN_COLOR_CONTRAST_RATIO = 3;

const LIGHT_BACKGROUND = '#ffffff';
const DARK_BACKGROUND = '#242424';

const getRelativeLuminance = (hexColor: string): number => {
  const rgb = hexColor.match(/[a-f\d]{2}/gi);

  if (!rgb || rgb.length !== 3) {
    throw new Error(`Invalid hex color: ${hexColor}`);
  }

  const [r, g, b] = rgb.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  const red = 0.2126 * r;
  const green = 0.7152 * g;
  const blue = 0.0722 * b;

  return red + green + blue;
};

export const getColorContrastRatio = (color1: string, color2: string): number => {
  const luminance1 = getRelativeLuminance(color1);
  const luminance2 = getRelativeLuminance(color2);

  const lighter = Math.max(luminance1, luminance2);
  const darker = Math.min(luminance1, luminance2);

  return (lighter + 0.05) / (darker + 0.05);
};

export const getWorkContextColorsForTheme = (isDarkTheme: boolean): readonly string[] => {
  const background = isDarkTheme ? DARK_BACKGROUND : LIGHT_BACKGROUND;

  return PRESET_COLORS.filter(
    (color) => getColorContrastRatio(color, background) >= MIN_COLOR_CONTRAST_RATIO,
  );
};

// Retained for existing tag color assignment.
export const getRandomWorkContextColor = (): string => {
  const index = Math.floor(Math.random() * PRESET_COLORS.length);
  return PRESET_COLORS[index];
};

// Used for automatically assigning project colors.
export const getRandomProjectColor = (isDarkTheme: boolean): string => {
  const colors = getWorkContextColorsForTheme(isDarkTheme);
  const index = Math.floor(Math.random() * colors.length);

  return colors[index];
};
