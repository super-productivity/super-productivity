import { app, nativeImage } from 'electron';
import { getWin } from './main-window';

// Small bitmap glyphs avoid fonts, SVG decoding and new rendering dependencies.
const GLYPHS = [
  ['111', '101', '101', '101', '111'],
  ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'],
  ['111', '001', '111', '001', '111'],
  ['101', '101', '111', '001', '001'],
  ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'],
  ['111', '001', '010', '010', '010'],
  ['111', '101', '111', '101', '111'],
  ['111', '101', '111', '001', '111'],
  ['000', '010', '111', '010', '000'],
];

export const createBadgeBitmap = (count: number): Buffer => {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distanceX = (x - 15.5) ** 2;
      const distanceY = (y - 15.5) ** 2;
      if (distanceX + distanceY <= 15.5 ** 2) {
        const rowOffset = y * size;
        const offset = (rowOffset + x) * 4;
        // nativeImage bitmap format is BGRA.
        pixels.set([80, 80, 190, 255], offset);
      }
    }
  }
  const text = count > 99 ? '99+' : String(count);
  const scale = text.length === 1 ? 4 : 2;
  const columns = text.length * 4;
  const width = (columns - 1) * scale;
  const left = Math.floor((size - width) / 2);
  const height = 5 * scale;
  const top = Math.floor((size - height) / 2);
  text.split('').forEach((character, index) => {
    GLYPHS[character === '+' ? 10 : Number(character)].forEach((row, y) => {
      row.split('').forEach((pixel, x) => {
        if (pixel !== '1') return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const glyphY = y * scale;
            const columnStart = index * 4;
            const glyphX = (columnStart + x) * scale;
            const pixelY = top + glyphY + dy;
            const pixelX = left + glyphX + dx;
            const rowOffset = pixelY * size;
            const offset = (rowOffset + pixelX) * 4;
            pixels.set([255, 255, 255, 255], offset);
          }
        }
      });
    });
  });
  return pixels;
};

export const setDueTaskBadge = (count: number): void => {
  if (process.platform === 'win32') {
    getWin()?.setOverlayIcon(
      count
        ? nativeImage.createFromBitmap(createBadgeBitmap(count), {
            width: 32,
            height: 32,
          })
        : null,
      count ? `${count} tasks due today or overdue` : '',
    );
  } else {
    // macOS Dock and Linux launchers that support Electron's badge API.
    app.setBadgeCount(count);
  }
};
