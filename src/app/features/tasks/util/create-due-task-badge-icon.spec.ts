import { createDueTaskBadgeIcon } from './create-due-task-badge-icon';

describe('createDueTaskBadgeIcon', () => {
  it('renders a transparent, neutral badge with centered white digits for small and large counts', async () => {
    for (const count of [5, 6, 10, 99, 100]) {
      const url = createDueTaskBadgeIcon(count)!;
      const image = new Image();
      image.src = url;
      await image.decode();
      expect(image.width).toBe(64);
      expect(image.height).toBe(64);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([0, 0, 0, 0]);
      expect(Array.from(context.getImageData(8, 32, 1, 1).data)).toEqual([
        55, 55, 55, 255,
      ]);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      const whitePoints: { x: number; y: number }[] = [];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] > 245 && pixels[offset + 3] > 245) {
          const pixel = offset / 4;
          whitePoints.push({ x: pixel % 64, y: Math.floor(pixel / 64) });
        }
      }
      expect(whitePoints.length).toBeGreaterThan(0);
      const ys = whitePoints.map((point) => point.y);
      const center = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(Math.abs(center - 32)).toBeLessThan(2);
    }
    expect(createDueTaskBadgeIcon(100)).toBe(createDueTaskBadgeIcon(1000));
    expect(createDueTaskBadgeIcon(5)).not.toBe(createDueTaskBadgeIcon(6));
  });
});
