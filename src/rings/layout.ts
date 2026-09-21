import { generateStickers, layerIndex, type Axis, type Sticker } from '../core/geometry';

export interface Point { x: number; y: number }

export interface RingLayout {
  width: number;
  height: number;
  centers: readonly [Point, Point, Point];
  radii: readonly number[][];
  points: readonly Point[];
  nodeRadius: number;
}

function circleIntersections(a: Point, ra: number, b: Point, rb: number): readonly [Point, Point] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance > ra + rb || distance < Math.abs(ra - rb)) {
    throw new Error('Configured ring families do not intersect');
  }
  const along = (ra * ra - rb * rb + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, ra * ra - along * along));
  const midX = a.x + (along * dx) / distance;
  const midY = a.y + (along * dy) / distance;
  const offsetX = (-dy * height) / distance;
  const offsetY = (dx * height) / distance;
  return [
    { x: midX + offsetX, y: midY + offsetY },
    { x: midX - offsetX, y: midY - offsetY },
  ];
}

function normalAxis(sticker: Sticker): Axis {
  const axis = sticker.normal.findIndex((value) => value !== 0);
  return axis as Axis;
}

export function createRingLayout(size: number, width = 900, height = 620): RingLayout {
  const scale = Math.min(width / 900, height / 620);
  const centers: readonly [Point, Point, Point] = [
    { x: width * 0.38, y: height * 0.42 },
    { x: width * 0.65, y: height * 0.42 },
    { x: width * 0.515, y: height * 0.64 },
  ];
  // The six faces are the two intersection fields for each pair of ring
  // families. Their centers do not move as N grows, so higher orders must use
  // a denser layer cadence or the three inner fields overlap one another.
  const spacing = (size <= 4 ? 20.5 - size : Math.max(6, 19.5 - size * 1.5)) * scale;
  const nodeRadius = Math.max(2.75 * scale, Math.min(6 * scale, spacing * 0.38));
  const base = 170 * scale;
  const middle = (size - 1) / 2;
  const radii = [0, 1, 2].map(() =>
    Array.from({ length: size }, (_, layer) => base + (layer - middle) * spacing),
  );

  const points = generateStickers(size).map((sticker) => {
    const faceAxis = normalAxis(sticker);
    const ringAxes = ([0, 1, 2] as Axis[]).filter((axis) => axis !== faceAxis);
    const axisA = ringAxes[0];
    const axisB = ringAxes[1];
    if (axisA === undefined || axisB === undefined) throw new Error('Sticker needs two ring axes');
    const layerA = layerIndex(size, sticker.pos[axisA]);
    const layerB = layerIndex(size, sticker.pos[axisB]);
    const intersections = circleIntersections(
      centers[axisA],
      radii[axisA]?.[layerA] ?? base,
      centers[axisB],
      radii[axisB]?.[layerB] ?? base,
    );
    const sign = sticker.normal[faceAxis];
    // Alternating this orientation per omitted axis spreads the six faces into
    // six compact clusters around the triangular ring-family centers.
    const orientation = faceAxis === 1 ? -1 : 1;
    return intersections[sign * orientation > 0 ? 0 : 1];
  });

  return { width, height, centers, radii, points, nodeRadius };
}
