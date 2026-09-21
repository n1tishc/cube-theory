import { describe, expect, it } from 'vitest';
import { applyMove, solvedState } from '../src/core/state';
import { createScramble } from '../src/core/scramble';
import { solveFourByFourCenters } from '../src/solvers/reduction/centers';
import {
  edgeActionCount,
  FOUR_BY_FOUR_EDGE_ACTIONS,
  pairFourByFourEdges,
} from '../src/solvers/reduction/edges';
import { centersSolved, edgesPaired } from '../src/solvers/reduction/invariants';

describe('4×4 edge pairing', () => {
  function seededRandom(initialSeed: number): () => number {
    let seed = initialSeed;
    return () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
  }

  it('deduplicates center-preserving framed transactions', () => {
    expect(edgeActionCount()).toBeGreaterThan(40);
    expect(new Set(FOUR_BY_FOUR_EDGE_ACTIONS.map((action) => action.sourceByDestination.join(','))).size)
      .toBe(edgeActionCount());
    for (const action of FOUR_BY_FOUR_EDGE_ACTIONS) {
      let state = solvedState(4);
      for (const move of action.moves) state = applyMove(state, 4, move);
      expect(centersSolved(state, 4), action.id).toBe(true);
    }
  });

  it('pairs a multi-transaction state from projected wings alone', () => {
    let state = solvedState(4);
    for (const index of [3, 17, 41]) {
      for (const move of FOUR_BY_FOUR_EDGE_ACTIONS[index]!.moves) state = applyMove(state, 4, move);
    }
    expect(centersSolved(state, 4)).toBe(true);
    expect(edgesPaired(state, 4)).toBe(false);
    const result = pairFourByFourEdges(state, { maxDepth: 8 });
    for (const move of result.moves) state = applyMove(state, 4, move);
    expect(centersSolved(state, 4)).toBe(true);
    expect(edgesPaired(state, 4)).toBe(true);
    expect(result.transactionCount).toBeLessThanOrEqual(8);
  });

  it('enforces center entry and search bounds', () => {
    let state = solvedState(4);
    state = applyMove(state, 4, { axis: 0, layer: 1, turns: 1 });
    expect(() => pairFourByFourEdges(state)).toThrow(/solved centers/);

    state = solvedState(4);
    for (const move of FOUR_BY_FOUR_EDGE_ACTIONS[0]!.moves) state = applyMove(state, 4, move);
    expect(() => pairFourByFourEdges(state, { maxDepth: 0 })).toThrow(/depth 0/);
    expect(() => pairFourByFourEdges(state, { maxVisited: 1 })).toThrow(/exceeded 1/);
  });

  it('pairs wings after center reduction of physical scrambles', () => {
    for (const seed of [
      17, 23, 37, 43, 59, 73, 89, 107, 131, 163, 197, 239,
      271, 307, 349, 397, 449, 503, 563, 617, 677, 739, 809, 877,
    ]) {
      let state = solvedState(4);
      for (const move of createScramble(4, 25, seededRandom(seed))) state = applyMove(state, 4, move);
      try {
        for (const move of solveFourByFourCenters(state).moves) state = applyMove(state, 4, move);
      } catch (error) {
        throw new Error(`center seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
      expect(centersSolved(state, 4), `seed ${seed}`).toBe(true);
      let result;
      try {
        result = pairFourByFourEdges(state);
      } catch (error) {
        throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const move of result.moves) state = applyMove(state, 4, move);
      expect(centersSolved(state, 4), `seed ${seed}`).toBe(true);
      expect(edgesPaired(state, 4), `seed ${seed}`).toBe(true);
    }
  }, 30_000);
});
