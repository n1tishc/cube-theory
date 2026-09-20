import { describe, expect, it } from 'vitest';
import { generateStickers, layerIndex } from '../src/core/geometry';
import { createRingLayout } from '../src/rings/layout';

describe('sticker-ring layout', () => {
  for (let size = 2; size <= 9; size += 1) {
    it(`places every ${size}×${size} sticker on its two rings`, () => {
      const layout = createRingLayout(size);
      const stickers = generateStickers(size);
      expect(layout.points).toHaveLength(6 * size * size);

      stickers.forEach((sticker, index) => {
        const point = layout.points[index];
        expect(point).toBeDefined();
        if (!point) return;
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        const normalAxis = sticker.normal.findIndex((value) => value !== 0);
        ([0, 1, 2] as const).filter((axis) => axis !== normalAxis).forEach((axis) => {
          const layer = layerIndex(size, sticker.pos[axis]);
          const center = layout.centers[axis];
          const radius = layout.radii[axis]?.[layer] ?? 0;
          expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(radius, 5);
        });
      });

      const centroids = Array.from({ length: 6 }, (_, faceIndex) => {
        const facePoints = layout.points.slice(faceIndex * size * size, (faceIndex + 1) * size * size);
        const centroid = facePoints.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        centroid.x /= facePoints.length;
        centroid.y /= facePoints.length;
        const radius = Math.max(...facePoints.map((point) => Math.hypot(point.x - centroid.x, point.y - centroid.y)));
        expect(radius).toBeLessThan(90);
        return centroid;
      });

      for (let a = 0; a < centroids.length; a += 1) {
        for (let b = a + 1; b < centroids.length; b += 1) {
          const first = centroids[a];
          const second = centroids[b];
          if (!first || !second) continue;
          expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(30);
        }
      }
    });
  }
});
