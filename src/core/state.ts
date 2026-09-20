import type { Move } from './moves';
import { buildMovePermutation } from './moves';

export function solvedState(size: number): Uint8Array {
  const faceArea = size * size;
  const state = new Uint8Array(6 * faceArea);
  for (let face = 0; face < 6; face += 1) {
    state.fill(face, face * faceArea, (face + 1) * faceArea);
  }
  return state;
}

export function applyPermutation(state: Uint8Array, permutation: Uint16Array): Uint8Array {
  if (state.length !== permutation.length) throw new Error('State and permutation lengths differ');
  const next = new Uint8Array(state.length);
  for (let destination = 0; destination < state.length; destination += 1) {
    next[destination] = state[permutation[destination] ?? 0] ?? 0;
  }
  return next;
}

export function applyMove(state: Uint8Array, size: number, move: Move): Uint8Array {
  return applyPermutation(state, buildMovePermutation(size, move));
}

export function composePermutations(first: Uint16Array, second: Uint16Array): Uint16Array {
  if (first.length !== second.length) throw new Error('Permutation lengths differ');
  const composed = new Uint16Array(first.length);
  for (let destination = 0; destination < first.length; destination += 1) {
    composed[destination] = first[second[destination] ?? 0] ?? 0;
  }
  return composed;
}

export function isSolved(state: Uint8Array, size: number): boolean {
  const faceArea = size * size;
  for (let face = 0; face < 6; face += 1) {
    const color = state[face * faceArea];
    for (let offset = 1; offset < faceArea; offset += 1) {
      if (state[face * faceArea + offset] !== color) return false;
    }
  }
  return true;
}
