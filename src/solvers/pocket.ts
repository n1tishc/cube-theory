import { generateStickers, rotateQuarter, stickerKey, type Vec3 } from '../core/geometry';
import type { Move } from '../core/moves';
import { applyMove, applyPermutation, isSolved, solvedState } from '../core/state';
import type { PocketTelemetryStep } from './telemetry';

export const POCKET_PERMUTATIONS = 5_040;
export const POCKET_TWISTS = 729;
export const POCKET_STATES = POCKET_PERMUTATIONS * POCKET_TWISTS;
export const POCKET_UNSEEN = 0xff;

type Matrix = readonly [Vec3, Vec3, Vec3];

interface CornerState {
  permutation: number[];
  orientation: number[];
}

export interface PocketFrame {
  /** Proper rotation mapping input coordinates into the normalized frame. */
  matrix: Matrix;
}

export interface NormalizedPocket {
  state: Uint8Array;
  frame: PocketFrame;
  coordinate: number;
}

export interface PocketMoveTables {
  permutation: Uint16Array;
  twist: Uint16Array;
}

const CORNER_POSITIONS: readonly Vec3[] = [
  [1, 1, 1],
  [-1, 1, 1],
  [-1, 1, -1],
  [1, 1, -1],
  [1, -1, 1],
  [-1, -1, 1],
  [-1, -1, -1],
  [1, -1, -1],
];

// Standard URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB facelet order.
// A corner's twist is the index at which its U/D sticker appears.
const CORNER_NORMALS: readonly (readonly Vec3[])[] = [
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 1, 0], [0, 0, 1], [-1, 0, 0]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, -1]],
  [[0, 1, 0], [0, 0, -1], [1, 0, 0]],
  [[0, -1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [0, 0, -1], [-1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
];

const FIXED_CORNER = 6;
const MOVABLE_POSITIONS = [0, 1, 2, 3, 4, 5, 7] as const;
const MOVABLE_PIECES = [0, 1, 2, 3, 4, 5, 7] as const;
const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5_040] as const;

export const POCKET_MOVES: readonly Move[] = ([0, 1, 2] as const).flatMap((axis) =>
  ([1, 2, 3] as const).map((turns) => ({ axis, layer: 1, turns })),
);

const stickers = generateStickers(2);
const stickerIndex = new Map(stickers.map((sticker) => [
  stickerKey(sticker.pos, sticker.normal),
  sticker.index,
]));
const cornerFacelets = CORNER_POSITIONS.map((position, corner) =>
  (CORNER_NORMALS[corner] ?? []).map((normal) => {
    const index = stickerIndex.get(stickerKey(position, normal));
    if (index === undefined) throw new Error('Pocket corner geometry is incomplete');
    return index;
  }),
);
const solved = solvedState(2);
const pieceByColors = new Map<string, number>();
cornerFacelets.forEach((indices, piece) => {
  pieceByColors.set(indices.map((index) => solved[index] ?? 0).sort().join(','), piece);
});

function transformVector(matrix: Matrix, vector: Vec3): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const columns: readonly Vec3[] = [
    [right[0][0], right[1][0], right[2][0]],
    [right[0][1], right[1][1], right[2][1]],
    [right[0][2], right[1][2], right[2][2]],
  ];
  return left.map((row) => columns.map((column) =>
    row[0] * column[0] + row[1] * column[1] + row[2] * column[2],
  ) as unknown as Vec3) as unknown as Matrix;
}

function transpose(matrix: Matrix): Matrix {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function matrixKey(matrix: Matrix): string {
  return matrix.flat().join(',');
}

function quarterMatrix(axis: 0 | 1 | 2): Matrix {
  const columns = ([
    rotateQuarter([1, 0, 0], axis),
    rotateQuarter([0, 1, 0], axis),
    rotateQuarter([0, 0, 1], axis),
  ] as const);
  return [
    [columns[0][0], columns[1][0], columns[2][0]],
    [columns[0][1], columns[1][1], columns[2][1]],
    [columns[0][2], columns[1][2], columns[2][2]],
  ];
}

function buildOrientations(): Matrix[] {
  const identity: Matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const generators = [quarterMatrix(0), quarterMatrix(1), quarterMatrix(2)];
  const result: Matrix[] = [identity];
  const seen = new Set([matrixKey(identity)]);
  for (let cursor = 0; cursor < result.length; cursor += 1) {
    const current = result[cursor];
    if (!current) continue;
    for (const generator of generators) {
      const next = multiplyMatrices(generator, current);
      const key = matrixKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(next);
    }
  }
  if (result.length !== 24) throw new Error(`Expected 24 cube orientations, found ${result.length}`);
  return result;
}

const ORIENTATIONS = buildOrientations();
const orientationPermutations = new Map<string, Uint16Array>();

function orientationPermutation(matrix: Matrix): Uint16Array {
  const key = matrixKey(matrix);
  const cached = orientationPermutations.get(key);
  if (cached) return cached;
  const permutation = new Uint16Array(stickers.length);
  for (const sticker of stickers) {
    const destination = stickerIndex.get(stickerKey(
      transformVector(matrix, sticker.pos),
      transformVector(matrix, sticker.normal),
    ));
    if (destination === undefined) throw new Error('Cube orientation produced an unknown sticker slot');
    permutation[destination] = sticker.index;
  }
  orientationPermutations.set(key, permutation);
  return permutation;
}

export function rotatePocketState(state: Uint8Array, matrix: Matrix): Uint8Array {
  if (state.length !== 24) throw new Error('Pocket state must contain 24 facelets');
  return applyPermutation(state, orientationPermutation(matrix));
}

export function faceletsToCorners(state: Uint8Array): CornerState {
  if (state.length !== 24) throw new Error('Pocket state must contain 24 facelets');
  const permutation: number[] = [];
  const orientation: number[] = [];
  const seen = new Set<number>();

  cornerFacelets.forEach((indices) => {
    const colors = indices.map((index) => state[index] ?? 0);
    const piece = pieceByColors.get([...colors].sort().join(','));
    if (piece === undefined || seen.has(piece)) throw new Error('Invalid pocket-cube corner colors');
    seen.add(piece);
    const twist = colors.findIndex((color) => color === 0 || color === 3);
    if (twist < 0) throw new Error('Pocket corner is missing its U/D color');
    permutation.push(piece);
    orientation.push(twist);
  });

  if (orientation.reduce((sum, twist) => sum + twist, 0) % 3 !== 0) {
    throw new Error('Invalid pocket-cube corner twist');
  }
  return { permutation, orientation };
}

function rankPermutation(permutation: readonly number[]): number {
  let rank = 0;
  const available = [...Array(permutation.length).keys()];
  permutation.forEach((value, index) => {
    const digit = available.indexOf(value);
    if (digit < 0) throw new Error('Invalid permutation');
    rank += digit * (FACTORIAL[permutation.length - index - 1] ?? 1);
    available.splice(digit, 1);
  });
  return rank;
}

function unrankPermutation(rank: number, length: number): number[] {
  const available = [...Array(length).keys()];
  const permutation: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const factor = FACTORIAL[length - index - 1] ?? 1;
    const digit = Math.floor(rank / factor);
    rank %= factor;
    const value = available.splice(digit, 1)[0];
    if (value === undefined) throw new Error('Permutation rank is outside its coordinate');
    permutation.push(value);
  }
  return permutation;
}

export function encodePocketCorners(corners: CornerState): number {
  if (corners.permutation[FIXED_CORNER] !== FIXED_CORNER
    || corners.orientation[FIXED_CORNER] !== 0) {
    throw new Error('Pocket coordinate requires the D-B-L corner to be fixed');
  }
  const reducedPermutation = MOVABLE_POSITIONS.map((position) => {
    const piece = corners.permutation[position];
    const reduced = MOVABLE_PIECES.indexOf(piece as never);
    if (reduced < 0) throw new Error('Pocket permutation contains the fixed corner twice');
    return reduced;
  });
  let twist = 0;
  for (let index = 0; index < 6; index += 1) {
    twist = twist * 3 + (corners.orientation[MOVABLE_POSITIONS[index] ?? 0] ?? 0);
  }
  return rankPermutation(reducedPermutation) * POCKET_TWISTS + twist;
}

export function decodePocketCoordinate(coordinate: number): CornerState {
  if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate >= POCKET_STATES) {
    throw new RangeError('Pocket coordinate is outside the normalized state space');
  }
  const permutationRank = Math.floor(coordinate / POCKET_TWISTS);
  let twistRank = coordinate % POCKET_TWISTS;
  const reduced = unrankPermutation(permutationRank, 7);
  const permutation = new Array<number>(8).fill(FIXED_CORNER);
  MOVABLE_POSITIONS.forEach((position, index) => {
    permutation[position] = MOVABLE_PIECES[reduced[index] ?? 0] ?? 0;
  });

  const orientation = new Array<number>(8).fill(0);
  let sum = 0;
  for (let index = 5; index >= 0; index -= 1) {
    const value = twistRank % 3;
    twistRank = Math.floor(twistRank / 3);
    orientation[MOVABLE_POSITIONS[index] ?? 0] = value;
    sum += value;
  }
  orientation[MOVABLE_POSITIONS[6]] = (3 - (sum % 3)) % 3;
  return { permutation, orientation };
}

export function normalizePocketState(state: Uint8Array): NormalizedPocket {
  for (const matrix of ORIENTATIONS) {
    const rotated = rotatePocketState(state, matrix);
    const corners = faceletsToCorners(rotated);
    if (corners.permutation[FIXED_CORNER] === FIXED_CORNER
      && corners.orientation[FIXED_CORNER] === 0) {
      return {
        state: rotated,
        frame: { matrix },
        coordinate: encodePocketCorners(corners),
      };
    }
  }
  throw new Error('Could not normalize the D-B-L corner');
}

function moveEffect(move: Move): CornerState {
  return faceletsToCorners(applyMove(solved, 2, move));
}

function applyCornerEffect(corners: CornerState, effect: CornerState): CornerState {
  const permutation = new Array<number>(8);
  const orientation = new Array<number>(8);
  for (let destination = 0; destination < 8; destination += 1) {
    const source = effect.permutation[destination] ?? 0;
    permutation[destination] = corners.permutation[source] ?? 0;
    orientation[destination] = ((corners.orientation[source] ?? 0)
      + (effect.orientation[destination] ?? 0)) % 3;
  }
  return { permutation, orientation };
}

export function createPocketMoveTables(): PocketMoveTables {
  const effects = POCKET_MOVES.map(moveEffect);
  const permutation = new Uint16Array(POCKET_PERMUTATIONS * POCKET_MOVES.length);
  const twist = new Uint16Array(POCKET_TWISTS * POCKET_MOVES.length);

  for (let rank = 0; rank < POCKET_PERMUTATIONS; rank += 1) {
    const corners = decodePocketCoordinate(rank * POCKET_TWISTS);
    effects.forEach((effect, moveIndex) => {
      const next = applyCornerEffect(corners, effect);
      permutation[rank * POCKET_MOVES.length + moveIndex]
        = Math.floor(encodePocketCorners(next) / POCKET_TWISTS);
    });
  }

  for (let coordinate = 0; coordinate < POCKET_TWISTS; coordinate += 1) {
    const corners = decodePocketCoordinate(coordinate);
    effects.forEach((effect, moveIndex) => {
      const next = applyCornerEffect(corners, effect);
      twist[coordinate * POCKET_MOVES.length + moveIndex]
        = encodePocketCorners(next) % POCKET_TWISTS;
    });
  }
  return { permutation, twist };
}

export function nextPocketCoordinate(
  coordinate: number,
  moveIndex: number,
  tables: PocketMoveTables,
): number {
  const permutationRank = Math.floor(coordinate / POCKET_TWISTS);
  const twistRank = coordinate % POCKET_TWISTS;
  const offset = moveIndex;
  const nextPermutation = tables.permutation[permutationRank * POCKET_MOVES.length + offset];
  const nextTwist = tables.twist[twistRank * POCKET_MOVES.length + offset];
  if (nextPermutation === undefined || nextTwist === undefined) throw new Error('Move index is invalid');
  return nextPermutation * POCKET_TWISTS + nextTwist;
}

export function buildPocketDistanceTable(
  tables: PocketMoveTables,
  onProgress?: (visited: number, depth: number) => void,
  onDiscover?: (coordinate: number, parent: number, move: Move, distance: number) => void,
): Uint8Array {
  const distances = new Uint8Array(POCKET_STATES);
  distances.fill(POCKET_UNSEEN);
  const queue = new Uint32Array(POCKET_STATES);
  let head = 0;
  let tail = 1;
  let depth = 0;
  let nextDepthEnd = 1;
  distances[0] = 0;
  queue[0] = 0;

  while (head < tail) {
    const coordinate = queue[head] ?? 0;
    head += 1;
    const distance = distances[coordinate] ?? 0;
    for (let moveIndex = 0; moveIndex < POCKET_MOVES.length; moveIndex += 1) {
      const next = nextPocketCoordinate(coordinate, moveIndex, tables);
      if (distances[next] !== POCKET_UNSEEN) continue;
      distances[next] = distance + 1;
      queue[tail] = next;
      tail += 1;
      const move = POCKET_MOVES[moveIndex];
      if (move) onDiscover?.(next, coordinate, move, distance + 1);
    }
    if (head === nextDepthEnd) {
      depth += 1;
      nextDepthEnd = tail;
      onProgress?.(tail, depth);
    }
  }
  return distances;
}

function mapMoveFromNormalized(move: Move, frame: PocketFrame): Move {
  const normal: Vec3 = move.axis === 0 ? [1, 0, 0] : move.axis === 1 ? [0, 1, 0] : [0, 0, 1];
  const originalNormal = transformVector(transpose(frame.matrix), normal);
  const axis = originalNormal.findIndex((value) => value !== 0) as 0 | 1 | 2;
  const sign = originalNormal[axis] ?? 1;
  return {
    axis,
    layer: sign > 0 ? 1 : 0,
    turns: (sign > 0 || move.turns === 2 ? move.turns : 4 - move.turns) as 1 | 2 | 3,
  };
}

export function solvePocketWithTable(
  input: Uint8Array,
  distances: Uint8Array,
  tables: PocketMoveTables,
  onStep?: (step: PocketTelemetryStep) => void,
): Move[] {
  const normalized = normalizePocketState(input);
  let coordinate = normalized.coordinate;
  const normalizedSolution: Move[] = [];
  while (coordinate !== 0) {
    const distance = distances[coordinate];
    if (distance === undefined || distance === POCKET_UNSEEN) {
      throw new Error('Pocket state is absent from the distance table');
    }
    let descended = false;
    for (let moveIndex = 0; moveIndex < POCKET_MOVES.length; moveIndex += 1) {
      const next = nextPocketCoordinate(coordinate, moveIndex, tables);
      if (distances[next] === distance - 1) {
        const move = POCKET_MOVES[moveIndex];
        if (!move) continue;
        normalizedSolution.push(move);
        onStep?.({ coordinate, next, move, distance });
        coordinate = next;
        descended = true;
        break;
      }
    }
    if (!descended) throw new Error('Pocket table has no descending neighbor');
  }

  const solution = normalizedSolution.map((move) => mapMoveFromNormalized(move, normalized.frame));
  let verified = input;
  solution.forEach((move) => { verified = applyMove(verified, 2, move); });
  if (!isSolved(verified, 2)) throw new Error('Pocket solver produced an invalid solution');
  return solution;
}
