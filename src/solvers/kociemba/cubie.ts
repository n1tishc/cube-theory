import { generateStickers, rotateQuarter, stickerKey, type Vec3 } from '../../core/geometry';
import { applyMove, applyPermutation, solvedState } from '../../core/state';
import type { Move } from '../../core/moves';

export interface CubieState {
  cornerPermutation: number[];
  cornerOrientation: number[];
  edgePermutation: number[];
  edgeOrientation: number[];
}

type Matrix = readonly [Vec3, Vec3, Vec3];

const CORNER_POSITIONS: readonly Vec3[] = [
  [2, 2, 2], [-2, 2, 2], [-2, 2, -2], [2, 2, -2],
  [2, -2, 2], [-2, -2, 2], [-2, -2, -2], [2, -2, -2],
];
const CORNER_NORMALS: readonly (readonly Vec3[])[] = [
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1], [-1, 0, 0]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, -1], [1, 0, 0]],
  [[0, -1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [0, 0, -1], [-1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
];
const EDGE_POSITIONS: readonly Vec3[] = [
  [2, 2, 0], [0, 2, 2], [-2, 2, 0], [0, 2, -2],
  [2, -2, 0], [0, -2, 2], [-2, -2, 0], [0, -2, -2],
  [2, 0, 2], [-2, 0, 2], [-2, 0, -2], [2, 0, -2],
];
const EDGE_NORMALS: readonly (readonly Vec3[])[] = [
  [[0, 1, 0], [1, 0, 0]], [[0, 1, 0], [0, 0, 1]], [[0, 1, 0], [-1, 0, 0]], [[0, 1, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0]], [[0, -1, 0], [0, 0, 1]], [[0, -1, 0], [-1, 0, 0]], [[0, -1, 0], [0, 0, -1]],
  [[0, 0, 1], [1, 0, 0]], [[0, 0, 1], [-1, 0, 0]], [[0, 0, -1], [-1, 0, 0]], [[0, 0, -1], [1, 0, 0]],
];

export const KOCIEMBA_MOVES: readonly Move[] = ([0, 1, 2, 3, 4, 5] as const).flatMap((face) => {
  const axes = [1, 0, 2, 1, 0, 2] as const;
  const layers = [2, 2, 2, 0, 0, 0] as const;
  const base = [1, 1, 1, 3, 3, 3] as const;
  return ([1, 2, 3] as const).map((power) => ({
    axis: axes[face], layer: layers[face],
    turns: (power === 2 ? 2 : power === 1 ? base[face] : 4 - base[face]) as 1 | 2 | 3,
  }));
});
export const PHASE2_MOVE_INDICES = [0, 1, 2, 9, 10, 11, 4, 13, 7, 16] as const;

const stickers = generateStickers(3);
const indexByKey = new Map(stickers.map((sticker) => [stickerKey(sticker.pos, sticker.normal), sticker.index]));
const facelets = (positions: readonly Vec3[], normals: readonly (readonly Vec3[])[]) => positions.map((position, piece) =>
  (normals[piece] ?? []).map((normal) => {
    const index = indexByKey.get(stickerKey(position, normal));
    if (index === undefined) throw new Error('3×3 cubie geometry is incomplete');
    return index;
  }));
const cornerFacelets = facelets(CORNER_POSITIONS, CORNER_NORMALS);
const edgeFacelets = facelets(EDGE_POSITIONS, EDGE_NORMALS);
const solved = solvedState(3);
const cornerByColors = new Map(cornerFacelets.map((slots, piece) => [slots.map((i) => solved[i]).sort().join(','), piece]));
const edgeByColors = new Map(edgeFacelets.map((slots, piece) => [slots.map((i) => solved[i]).sort().join(','), piece]));
const cornerPrimary = cornerFacelets.map((slots) => solved[slots[0] ?? 0]);
const edgePrimary = edgeFacelets.map((slots) => solved[slots[0] ?? 0]);

function parity(permutation: readonly number[]): number {
  let value = 0;
  for (let i = 0; i < permutation.length; i += 1) for (let j = i + 1; j < permutation.length; j += 1) {
    if ((permutation[i] ?? 0) > (permutation[j] ?? 0)) value ^= 1;
  }
  return value;
}

export function faceletsToCubie(state: Uint8Array): CubieState {
  if (state.length !== 54) throw new Error('A 3×3 state must contain 54 facelets');
  const counts = new Array<number>(6).fill(0);
  state.forEach((color) => { if (color < 6) counts[color] = (counts[color] ?? 0) + 1; });
  if (counts.some((count) => count !== 9)) throw new Error('Invalid 3×3 color counts');
  const cornerPermutation: number[] = [];
  const cornerOrientation: number[] = [];
  const edgePermutation: number[] = [];
  const edgeOrientation: number[] = [];
  const seenCorners = new Set<number>();
  const seenEdges = new Set<number>();
  cornerFacelets.forEach((slots) => {
    const colors = slots.map((i) => state[i] ?? 0);
    const piece = cornerByColors.get([...colors].sort().join(','));
    if (piece === undefined || seenCorners.has(piece)) throw new Error('Invalid or repeated 3×3 corner');
    seenCorners.add(piece);
    cornerPermutation.push(piece);
    const orientation = colors.indexOf(cornerPrimary[piece] ?? 0);
    if (orientation < 0) throw new Error('A corner is missing its U/D color');
    cornerOrientation.push(orientation);
  });
  edgeFacelets.forEach((slots) => {
    const colors = slots.map((i) => state[i] ?? 0);
    const piece = edgeByColors.get([...colors].sort().join(','));
    if (piece === undefined || seenEdges.has(piece)) throw new Error('Invalid or repeated 3×3 edge');
    seenEdges.add(piece);
    edgePermutation.push(piece);
    edgeOrientation.push(colors[0] === edgePrimary[piece] ? 0 : 1);
  });
  if (cornerOrientation.reduce((sum, value) => sum + value, 0) % 3) throw new Error('Invalid 3×3 corner twist');
  if (edgeOrientation.reduce((sum, value) => sum + value, 0) % 2) throw new Error('Invalid 3×3 edge flip');
  if (parity(cornerPermutation) !== parity(edgePermutation)) throw new Error('Invalid 3×3 permutation parity');
  return { cornerPermutation, cornerOrientation, edgePermutation, edgeOrientation };
}

export function applyCubieEffect(state: CubieState, effect: CubieState): CubieState {
  const cp = new Array<number>(8); const co = new Array<number>(8);
  const ep = new Array<number>(12); const eo = new Array<number>(12);
  for (let destination = 0; destination < 8; destination += 1) {
    const source = effect.cornerPermutation[destination] ?? 0;
    cp[destination] = state.cornerPermutation[source] ?? 0;
    co[destination] = ((state.cornerOrientation[source] ?? 0) + (effect.cornerOrientation[destination] ?? 0)) % 3;
  }
  for (let destination = 0; destination < 12; destination += 1) {
    const source = effect.edgePermutation[destination] ?? 0;
    ep[destination] = state.edgePermutation[source] ?? 0;
    eo[destination] = ((state.edgeOrientation[source] ?? 0) + (effect.edgeOrientation[destination] ?? 0)) % 2;
  }
  return { cornerPermutation: cp, cornerOrientation: co, edgePermutation: ep, edgeOrientation: eo };
}

export const KOCIEMBA_EFFECTS = KOCIEMBA_MOVES.map((move) => faceletsToCubie(applyMove(solved, 3, move)));

function transform(matrix: Matrix, vector: Vec3): Vec3 { return [
  matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
  matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
  matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
]; }
function multiply(a: Matrix, b: Matrix): Matrix {
  const columns: readonly Vec3[] = [[b[0][0], b[1][0], b[2][0]], [b[0][1], b[1][1], b[2][1]], [b[0][2], b[1][2], b[2][2]]];
  return a.map((row) => columns.map((column) => row[0] * column[0] + row[1] * column[1] + row[2] * column[2]) as unknown as Vec3) as unknown as Matrix;
}
function quarterMatrix(axis: 0 | 1 | 2): Matrix {
  const c = [rotateQuarter([1, 0, 0], axis), rotateQuarter([0, 1, 0], axis), rotateQuarter([0, 0, 1], axis)] as const;
  return [[c[0][0], c[1][0], c[2][0]], [c[0][1], c[1][1], c[2][1]], [c[0][2], c[1][2], c[2][2]]];
}
function orientations(): Matrix[] {
  const identity: Matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const result = [identity]; const seen = new Set([identity.flat().join(',')]);
  for (let cursor = 0; cursor < result.length; cursor += 1) for (const generator of [quarterMatrix(0), quarterMatrix(1), quarterMatrix(2)]) {
    const next = multiply(generator, result[cursor] ?? identity); const key = next.flat().join(',');
    if (!seen.has(key)) { seen.add(key); result.push(next); }
  }
  return result;
}
const ORIENTATIONS = orientations();
function rotateState(state: Uint8Array, matrix: Matrix): Uint8Array {
  const permutation = new Uint16Array(54);
  for (const sticker of stickers) {
    const destination = indexByKey.get(stickerKey(transform(matrix, sticker.pos), transform(matrix, sticker.normal)));
    if (destination === undefined) throw new Error('Invalid cube rotation');
    permutation[destination] = sticker.index;
  }
  return applyPermutation(state, permutation);
}

export interface NormalizedCube { state: Uint8Array; cubie: CubieState; matrix: Matrix }
export function normalizeThreeState(state: Uint8Array): NormalizedCube {
  const centers = [4, 13, 22, 31, 40, 49];
  for (const matrix of ORIENTATIONS) {
    const rotated = rotateState(state, matrix);
    if (centers.every((index, face) => rotated[index] === face)) return { state: rotated, cubie: faceletsToCubie(rotated), matrix };
  }
  throw new Error('Center colors do not describe a legal cube orientation');
}

export function mapMovesFromNormalizedFrame(moves: readonly Move[], matrix: Matrix): Move[] {
  const transpose: Matrix = [[matrix[0][0], matrix[1][0], matrix[2][0]], [matrix[0][1], matrix[1][1], matrix[2][1]], [matrix[0][2], matrix[1][2], matrix[2][2]]];
  return moves.map((move) => {
    const axisVector = [0, 0, 0] as unknown as [number, number, number]; axisVector[move.axis] = 1;
    const mapped = transform(transpose, axisVector);
    const axis = mapped.findIndex((value) => value !== 0) as 0 | 1 | 2;
    const sign = mapped[axis] ?? 1;
    return { axis, layer: sign > 0 ? move.layer : 2 - move.layer, turns: (sign > 0 || move.turns === 2 ? move.turns : 4 - move.turns) as 1 | 2 | 3 };
  });
}
