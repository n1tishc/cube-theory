import { applyCubieEffect, KOCIEMBA_EFFECTS, PHASE2_MOVE_INDICES, type CubieState } from './cubie';

export const TWISTS = 2187;
export const FLIPS = 2048;
export const SLICES = 495;
export const PERMUTATIONS_8 = 40320;
export const SLICE_PERMUTATIONS = 24;
const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5040, 40320] as const;

export interface CoordinateTables {
  twist: Uint16Array; flip: Uint16Array; slice: Uint16Array;
  cornerPermutation: Uint16Array; udEdgePermutation: Uint16Array; slicePermutation: Uint8Array;
}

export function solvedCubie(): CubieState { return {
  cornerPermutation: [0, 1, 2, 3, 4, 5, 6, 7], cornerOrientation: new Array<number>(8).fill(0),
  edgePermutation: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], edgeOrientation: new Array<number>(12).fill(0),
}; }

export function rankPermutation(permutation: readonly number[]): number {
  let rank = 0; const available = [...Array(permutation.length).keys()];
  permutation.forEach((value, index) => { const digit = available.indexOf(value); if (digit < 0) throw new Error('Invalid permutation'); rank += digit * (FACTORIAL[permutation.length - index - 1] ?? 1); available.splice(digit, 1); });
  return rank;
}
export function unrankPermutation(rank: number, length: number): number[] {
  const available = [...Array(length).keys()]; const result: number[] = [];
  for (let index = 0; index < length; index += 1) { const factor = FACTORIAL[length - index - 1] ?? 1; const digit = Math.floor(rank / factor); rank %= factor; const value = available.splice(digit, 1)[0]; if (value === undefined) throw new Error('Permutation coordinate is out of range'); result.push(value); }
  return result;
}
export function encodeTwist(state: CubieState): number { let value = 0; for (let i = 0; i < 7; i += 1) value = value * 3 + (state.cornerOrientation[i] ?? 0); return value; }
export function decodeTwist(value: number): CubieState { const state = solvedCubie(); let sum = 0; for (let i = 6; i >= 0; i -= 1) { const digit = value % 3; value = Math.floor(value / 3); state.cornerOrientation[i] = digit; sum += digit; } state.cornerOrientation[7] = (3 - sum % 3) % 3; return state; }
export function encodeFlip(state: CubieState): number { let value = 0; for (let i = 0; i < 11; i += 1) value = value * 2 + (state.edgeOrientation[i] ?? 0); return value; }
export function decodeFlip(value: number): CubieState { const state = solvedCubie(); let sum = 0; for (let i = 10; i >= 0; i -= 1) { const digit = value & 1; value >>= 1; state.edgeOrientation[i] = digit; sum += digit; } state.edgeOrientation[11] = sum & 1; return state; }

const sliceMasks: number[] = [];
for (let mask = 0; mask < 1 << 12; mask += 1) { let count = 0; for (let bit = mask; bit; bit &= bit - 1) count += 1; if (count === 4) sliceMasks.push(mask); }
const solvedMask = 0b111100000000;
sliceMasks.splice(sliceMasks.indexOf(solvedMask), 1); sliceMasks.unshift(solvedMask);
const sliceRank = new Map(sliceMasks.map((mask, rank) => [mask, rank]));
export function encodeSlice(state: CubieState): number { let mask = 0; state.edgePermutation.forEach((piece, position) => { if (piece >= 8) mask |= 1 << position; }); const rank = sliceRank.get(mask); if (rank === undefined) throw new Error('Invalid slice coordinate'); return rank; }
export function decodeSlice(rank: number): CubieState { const mask = sliceMasks[rank]; if (mask === undefined) throw new Error('Slice coordinate is out of range'); const state = solvedCubie(); let regular = 0; let slice = 8; for (let position = 0; position < 12; position += 1) state.edgePermutation[position] = mask & (1 << position) ? slice++ : regular++; return state; }
export function encodeCornerPermutation(state: CubieState): number { return rankPermutation(state.cornerPermutation); }
export function encodeUdEdgePermutation(state: CubieState): number { return rankPermutation(state.edgePermutation.slice(0, 8)); }
export function encodeSlicePermutation(state: CubieState): number { return rankPermutation(state.edgePermutation.slice(8).map((piece) => piece - 8)); }
export function decodeCornerPermutation(rank: number): CubieState { const state = solvedCubie(); state.cornerPermutation = unrankPermutation(rank, 8); return state; }
export function decodeUdEdgePermutation(rank: number): CubieState { const state = solvedCubie(); const permutation = unrankPermutation(rank, 8); for (let i = 0; i < 8; i += 1) state.edgePermutation[i] = permutation[i] ?? 0; return state; }
export function decodeSlicePermutation(rank: number): CubieState { const state = solvedCubie(); const permutation = unrankPermutation(rank, 4); for (let i = 0; i < 4; i += 1) state.edgePermutation[i + 8] = (permutation[i] ?? 0) + 8; return state; }

function buildTable(size: number, moves: readonly number[], decode: (value: number) => CubieState, encode: (state: CubieState) => number, Type: typeof Uint16Array | typeof Uint8Array): Uint16Array | Uint8Array {
  const table = new Type(size * moves.length);
  for (let coordinate = 0; coordinate < size; coordinate += 1) for (let move = 0; move < moves.length; move += 1) table[coordinate * moves.length + move] = encode(applyCubieEffect(decode(coordinate), KOCIEMBA_EFFECTS[moves[move] ?? 0] ?? solvedCubie()));
  return table;
}
export function createCoordinateTables(onProgress?: (completed: number, total: number) => void): CoordinateTables {
  const total = 6; let completed = 0; const done = () => onProgress?.(++completed, total);
  const twist = buildTable(TWISTS, [...Array(18).keys()], decodeTwist, encodeTwist, Uint16Array) as Uint16Array; done();
  const flip = buildTable(FLIPS, [...Array(18).keys()], decodeFlip, encodeFlip, Uint16Array) as Uint16Array; done();
  const slice = buildTable(SLICES, [...Array(18).keys()], decodeSlice, encodeSlice, Uint16Array) as Uint16Array; done();
  const cornerPermutation = buildTable(PERMUTATIONS_8, PHASE2_MOVE_INDICES, decodeCornerPermutation, encodeCornerPermutation, Uint16Array) as Uint16Array; done();
  const udEdgePermutation = buildTable(PERMUTATIONS_8, PHASE2_MOVE_INDICES, decodeUdEdgePermutation, encodeUdEdgePermutation, Uint16Array) as Uint16Array; done();
  const slicePermutation = buildTable(SLICE_PERMUTATIONS, PHASE2_MOVE_INDICES, decodeSlicePermutation, encodeSlicePermutation, Uint8Array) as Uint8Array; done();
  return { twist, flip, slice, cornerPermutation, udEdgePermutation, slicePermutation };
}
