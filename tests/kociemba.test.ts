import { beforeAll, describe, expect, it } from 'vitest';
import { applyMove, isSolved, solvedState } from '../src/core/state';
import { createScramble } from '../src/core/scramble';
import { applyCubieEffect, faceletsToCubie, KOCIEMBA_EFFECTS, KOCIEMBA_MOVES, normalizeThreeState } from '../src/solvers/kociemba/cubie';
import { createCoordinateTables, decodeCornerPermutation, decodeFlip, decodeSlice, decodeSlicePermutation, decodeTwist, decodeUdEdgePermutation, encodeCornerPermutation, encodeFlip, encodeSlice, encodeSlicePermutation, encodeTwist, encodeUdEdgePermutation, type CoordinateTables } from '../src/solvers/kociemba/coordinates';
import { createPruningTables, solveThree, type PruningTables } from '../src/solvers/kociemba/search';

describe('3×3 cubie representation', () => {
  it('agrees with sticker moves', () => {
    const solved = solvedState(3);
    for (let move = 0; move < KOCIEMBA_MOVES.length; move += 1) {
      expect(faceletsToCubie(applyMove(solved, 3, KOCIEMBA_MOVES[move]!))).toEqual(applyCubieEffect(faceletsToCubie(solved), KOCIEMBA_EFFECTS[move]!));
    }
  });

  it('round-trips phase-one coordinates', () => {
    for (const coordinate of [0, 1, 17, 511, 2047]) expect(encodeFlip(decodeFlip(coordinate))).toBe(coordinate);
    for (const coordinate of [0, 1, 17, 729, 2186]) expect(encodeTwist(decodeTwist(coordinate))).toBe(coordinate);
    for (const coordinate of [0, 1, 99, 494]) expect(encodeSlice(decodeSlice(coordinate))).toBe(coordinate);
  });

  it('round-trips phase-two coordinates', () => {
    for (const coordinate of [0, 1, 17, 5039, 40319]) {
      expect(encodeCornerPermutation(decodeCornerPermutation(coordinate))).toBe(coordinate);
      expect(encodeUdEdgePermutation(decodeUdEdgePermutation(coordinate))).toBe(coordinate);
    }
    for (const coordinate of [0, 1, 11, 23]) expect(encodeSlicePermutation(decodeSlicePermutation(coordinate))).toBe(coordinate);
  });

  it('normalizes a legal middle-slice state', () => {
    const state = applyMove(solvedState(3), 3, { axis: 0, layer: 1, turns: 1 });
    expect(() => normalizeThreeState(state)).not.toThrow();
  });

  it('rejects impossible edge flips', () => {
    const state = solvedState(3); const copy = state.slice();
    [copy[5], copy[10]] = [copy[10]!, copy[5]!];
    expect(() => faceletsToCubie(copy)).toThrow();
  });
});

describe('3×3 two-phase search', () => {
  let coordinates: CoordinateTables; let pruning: PruningTables;
  beforeAll(() => { coordinates = createCoordinateTables(); pruning = createPruningTables(coordinates); }, 30_000);

  it('solves reproducible scrambles and verifies every path', () => {
    let seed = 0x5eed1234;
    const lengths: number[] = [];
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
    for (let sample = 0; sample < 200; sample += 1) {
      let state = solvedState(3); createScramble(3, 25, random).forEach((move) => { state = applyMove(state, 3, move); });
      const solution = solveThree(state, coordinates, pruning);
      solution.forEach((move) => { state = applyMove(state, 3, move); });
      expect(isSolved(state, 3)).toBe(true); expect(solution.length).toBeLessThanOrEqual(30);
      lengths.push(solution.length);
    }
    lengths.sort((a, b) => a - b);
    expect(lengths[99]).toBeLessThanOrEqual(25);
  }, 60_000);

  it('solves a state reached through a middle-slice turn after center normalization', () => {
    const input = applyMove(solvedState(3), 3, { axis: 0, layer: 1, turns: 1 });
    let result = input; solveThree(input, coordinates, pruning).forEach((move) => { result = applyMove(result, 3, move); });
    expect(isSolved(result, 3)).toBe(true);
  });
});
