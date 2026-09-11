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

export const getRandomWorkContextColor = (): string => {
  const index = Math.floor(Math.random() * PRESET_COLORS.length);
  return PRESET_COLORS[index];
};
