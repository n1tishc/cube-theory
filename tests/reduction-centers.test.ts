import { describe, expect, it } from 'vitest';
import { applyMove, solvedState } from '../src/core/state';
import { createScramble } from '../src/core/scramble';
import { centersSolved } from '../src/solvers/reduction/invariants';
import { centerActionCount, FOUR_BY_FOUR_CENTER_ACTIONS, solveFourByFourCenters } from '../src/solvers/reduction/centers';

describe('4×4 center construction', () => {
  function seededRandom(initialSeed: number): () => number {
    let seed = initialSeed;
    return () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
  }

  it('deduplicates the framed physical macro action catalog', () => {
    expect(centerActionCount()).toBeGreaterThan(40);
    expect(new Set(FOUR_BY_FOUR_CENTER_ACTIONS.map((action) => action.sourceByDestination.join(','))).size)
      .toBe(centerActionCount());
  });

  it('solves multi-macro center states from the projected state alone', () => {
    const generators = [
      FOUR_BY_FOUR_CENTER_ACTIONS[3]!,
      FOUR_BY_FOUR_CENTER_ACTIONS[27]!,
      FOUR_BY_FOUR_CENTER_ACTIONS[51]!,
    ];
    let state = solvedState(4);
    for (const action of generators) for (const move of action.moves) state = applyMove(state, 4, move);
    expect(centersSolved(state, 4)).toBe(false);
    const result = solveFourByFourCenters(state, { beamWidth: 4_000, maxDepth: 8 });
    for (const move of result.moves) state = applyMove(state, 4, move);
    expect(centersSolved(state, 4)).toBe(true);
    expect(result.macroCount).toBeLessThanOrEqual(8);
  });

  it('honors explicit state and depth bounds', () => {
    let state = solvedState(4);
    for (const move of FOUR_BY_FOUR_CENTER_ACTIONS[0]!.moves) state = applyMove(state, 4, move);
    expect(() => solveFourByFourCenters(state, { maxDepth: 0 })).toThrow(/depth 0/);
    expect(() => solveFourByFourCenters(state, { maxVisited: 1 })).toThrow(/exceeded 1/);
  });

  it('solves a deterministic physical-scramble qualification matrix', () => {
    const cases = [3, 7, 11, 19, 29, 47, 71, 101]
      .map((seed) => ({ seed, length: 6 }))
      .concat([5, 13, 31, 61].map((seed) => ({ seed, length: 8 })))
      .concat([17, 23, 37, 43, 59, 73, 89, 107, 131, 163, 197, 239]
        .map((seed) => ({ seed, length: 25 })));
    for (const { seed, length } of cases) {
      let state = solvedState(4);
      for (const move of createScramble(4, length, seededRandom(seed))) state = applyMove(state, 4, move);
      let result;
      try {
        result = solveFourByFourCenters(state, { beamWidth: 6_000, maxDepth: 48 });
      } catch (error) {
        throw new Error(`length ${length}, seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const move of result.moves) state = applyMove(state, 4, move);
      expect(centersSolved(state, 4), `length ${length}, seed ${seed}`).toBe(true);
      expect(result.depth, `length ${length}, seed ${seed}`).toBeLessThanOrEqual(48);
    }
  });
});
