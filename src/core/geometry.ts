export type Axis = 0 | 1 | 2;
export type Vec3 = readonly [number, number, number];
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

export interface Sticker {
  index: number;
  face: Face;
  faceIndex: number;
  row: number;
  col: number;
  pos: Vec3;
  normal: Vec3;
}

interface FaceDefinition {
  face: Face;
  normal: Vec3;
  right: Vec3;
  down: Vec3;
}

export const FACE_ORDER: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

export const FACE_DEFINITIONS: readonly FaceDefinition[] = [
  { face: 'U', normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  { face: 'R', normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  { face: 'F', normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  { face: 'D', normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  { face: 'L', normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
  { face: 'B', normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
];

function addScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

export function layerCoordinate(size: number, layer: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer >= size) {
    throw new RangeError(`Layer ${layer} is outside a ${size}×${size} cube`);
  }
  return -(size - 1) + 2 * layer;
}

export function layerIndex(size: number, coordinate: number): number {
  return (coordinate + size - 1) / 2;
}

export function generateStickers(size: number): Sticker[] {
  if (!Number.isInteger(size) || size < 2 || size > 9) {
    throw new RangeError('Cube size must be an integer from 2 to 9');
  }

  const stickers: Sticker[] = [];
  const edge = size - 1;

  FACE_DEFINITIONS.forEach((definition, faceIndex) => {
    const origin: Vec3 = [
      definition.normal[0] * edge,
      definition.normal[1] * edge,
      definition.normal[2] * edge,
    ];

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const across = layerCoordinate(size, col);
        const down = layerCoordinate(size, row);
        const pos = addScaled(addScaled(origin, definition.right, across), definition.down, down);
        stickers.push({
          index: stickers.length,
          face: definition.face,
          faceIndex,
          row,
          col,
          pos,
          normal: definition.normal,
        });
      }
    }
  });

  return stickers;
}

export function stickerKey(pos: Vec3, normal: Vec3): string {
  return `${pos.join(',')}|${normal.join(',')}`;
}

/**
 * Positive turns are clockwise while looking from the positive end of an axis
 * toward the origin. This is the negative of the usual right-hand rotation.
 */
export function rotateQuarter(vector: Vec3, axis: Axis): Vec3 {
  const [x, y, z] = vector;
  switch (axis) {
    case 0: return [x, z, -y];
    case 1: return [-z, y, x];
    case 2: return [y, -x, z];
  }
}

export function rotateVector(vector: Vec3, axis: Axis, turns: 1 | 2 | 3): Vec3 {
  let result = vector;
  for (let turn = 0; turn < turns; turn += 1) result = rotateQuarter(result, axis);
  return result;
}
