import { describe, expect, it } from 'vitest';
import { generateStickers, layerIndex } from '../src/core/geometry';
import { createRingLayout } from '../src/rings/layout';

describe('sticker-ring layout', () => {
  for (let size = 2; size <= 9; size += 1) {
    it(`places every ${size}×${size} sticker on its two rings`, () => {
      const layout = createRingLayout(size);
      const stickers = generateStickers(size);
      expect(layout.points).toHaveLength(6 * size * size);
      expect(layout.nodeRadius).toBeGreaterThanOrEqual(2.75);
      expect(layout.nodeRadius).toBeLessThanOrEqual(7);

      layout.centers.forEach((center, axis) => {
        layout.radii[axis]?.forEach((radius) => {
          expect(center.x - radius).toBeGreaterThanOrEqual(0);
          expect(center.x + radius).toBeLessThanOrEqual(layout.width);
          expect(center.y - radius).toBeGreaterThanOrEqual(0);
          expect(center.y + radius).toBeLessThanOrEqual(layout.height);
        });
      });

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

      const faceSize = size * size;
      for (let firstFace = 0; firstFace < 6; firstFace += 1) {
        for (let secondFace = firstFace + 1; secondFace < 6; secondFace += 1) {
          const first = layout.points.slice(firstFace * faceSize, (firstFace + 1) * faceSize);
          const second = layout.points.slice(secondFace * faceSize, (secondFace + 1) * faceSize);
          const closest = Math.min(...first.flatMap((a) => second.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
          expect(closest).toBeGreaterThan(layout.nodeRadius * 2 + 2);
        }
      }
    });
  }

  it('gives a 4×4 face enough area to distinguish its stickers', () => {
    const size = 4;
    const points = createRingLayout(size).points.slice(0, size * size);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60);
  });

  it('scales markers down as cube density increases', () => {
    expect(createRingLayout(2).nodeRadius).toBeGreaterThan(createRingLayout(5).nodeRadius);
    expect(createRingLayout(5).nodeRadius).toBeGreaterThan(createRingLayout(9).nodeRadius);
  });
});
