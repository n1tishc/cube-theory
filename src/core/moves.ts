import {
  generateStickers,
  layerCoordinate,
  rotateVector,
  stickerKey,
  type Axis,
} from './geometry';

export interface Move {
  axis: Axis;
  layer: number;
  turns: 1 | 2 | 3;
}

const permutationCache = new Map<string, Uint16Array>();

export function moveKey(move: Move): string {
  return `${move.axis}:${move.layer}:${move.turns}`;
}

export function buildMovePermutation(size: number, move: Move): Uint16Array {
  const cacheKey = `${size}:${moveKey(move)}`;
  const cached = permutationCache.get(cacheKey);
  if (cached) return cached;

  const stickers = generateStickers(size);
  const indexByGeometry = new Map(
    stickers.map((sticker) => [stickerKey(sticker.pos, sticker.normal), sticker.index]),
  );
  const coordinate = layerCoordinate(size, move.layer);
  const permutation = new Uint16Array(stickers.length);

  for (const sticker of stickers) {
    const affected = sticker.pos[move.axis] === coordinate;
    const pos = affected ? rotateVector(sticker.pos, move.axis, move.turns) : sticker.pos;
    const normal = affected ? rotateVector(sticker.normal, move.axis, move.turns) : sticker.normal;
    const destination = indexByGeometry.get(stickerKey(pos, normal));
    if (destination === undefined) throw new Error('Move rotation produced an unknown sticker slot');
    // Applying the permutation uses next[destination] = state[source].
    permutation[destination] = sticker.index;
  }

  permutationCache.set(cacheKey, permutation);
  return permutation;
}

export function invertMove(move: Move): Move {
  return { ...move, turns: (move.turns === 2 ? 2 : 4 - move.turns) as 1 | 2 | 3 };
}

const FACE_CONFIG = {
  R: { axis: 0 as Axis, positive: true, baseTurns: 1 as const },
  L: { axis: 0 as Axis, positive: false, baseTurns: 3 as const },
  U: { axis: 1 as Axis, positive: true, baseTurns: 1 as const },
  D: { axis: 1 as Axis, positive: false, baseTurns: 3 as const },
  F: { axis: 2 as Axis, positive: true, baseTurns: 1 as const },
  B: { axis: 2 as Axis, positive: false, baseTurns: 3 as const },
};

type MoveFace = keyof typeof FACE_CONFIG;

export function parseNotation(input: string, size: number): Move[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  return trimmed.split(/\s+/).map((token) => {
    const match = /^(\d+)?([URFDLB])([2']?)$/.exec(token);
    if (!match) throw new Error(`Invalid move notation: ${token}`);
    const [, prefix, faceText, suffix] = match;
    const face = faceText as MoveFace;
    const depth = prefix ? Number(prefix) : 1;
    if (!Number.isInteger(depth) || depth < 1 || depth > size) {
      throw new Error(`Move ${token} addresses a layer outside a ${size}×${size} cube`);
    }
    const config = FACE_CONFIG[face];
    const layer = config.positive ? size - depth : depth - 1;
    const turns = suffix === '2'
      ? 2
      : suffix === "'"
        ? ((4 - config.baseTurns) % 4 as 1 | 3)
        : config.baseTurns;
    return { axis: config.axis, layer, turns };
  });
}

export function formatMove(move: Move, size: number): string {
  const positiveFace: readonly MoveFace[] = ['R', 'U', 'F'];
  const negativeFace: readonly MoveFace[] = ['L', 'D', 'B'];
  const positive = move.layer >= size / 2;
  const face = (positive ? positiveFace : negativeFace)[move.axis];
  if (!face) throw new Error('Unknown move axis');
  const config = FACE_CONFIG[face];
  const depth = positive ? size - move.layer : move.layer + 1;
  const prefix = depth === 1 ? '' : String(depth);
  const relativeTurns = config.baseTurns === 1 ? move.turns : (4 - move.turns) % 4;
  const suffix = relativeTurns === 2 ? '2' : relativeTurns === 3 ? "'" : '';
  return `${prefix}${face}${suffix}`;
}

export function movedStickerIndices(permutation: Uint16Array): number[] {
  const moved: number[] = [];
  permutation.forEach((source, destination) => {
    if (source !== destination) moved.push(destination);
  });
  return moved;
}
