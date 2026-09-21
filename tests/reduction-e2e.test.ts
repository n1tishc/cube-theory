import { beforeAll, describe, expect, it } from 'vitest';
import { createScramble } from '../src/core/scramble';
import { applyMove, isSolved, solvedState } from '../src/core/state';
import { createCoordinateTables, type CoordinateTables } from '../src/solvers/kociemba/coordinates';
import { createPruningTables, solveThree } from '../src/solvers/kociemba/search';
import type { PruningTables } from '../src/solvers/kociemba/search';
import { solveFourByFour } from '../src/solvers/reduction/solve';

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed;
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

describe('4×4 end-to-end reduction', () => {
  let coordinates: CoordinateTables;
  let pruning: PruningTables;

  beforeAll(() => {
    coordinates = createCoordinateTables();
    pruning = createPruningTables(coordinates);
  }, 30_000);

  it('solves full physical scrambles through reduction and lifted 3×3 moves', () => {
    const observedParity = new Set<string>();
    for (const seed of [17, 23, 37, 43, 59, 73, 89, 107, 131, 163, 197, 239]) {
      let state = solvedState(4);
      for (const move of createScramble(4, 25, seededRandom(seed))) state = applyMove(state, 4, move);
      const result = solveFourByFour(state, {
        solveThree: (projected) => solveThree(projected, coordinates, pruning),
      });
      for (const move of result.moves) state = applyMove(state, 4, move);
      expect(isSolved(state, 4), `seed ${seed}`).toBe(true);
      expect(result.stages.map((stage) => stage.stage)).toEqual([
        'centers', 'edge-pairing', 'parity', 'three-by-three', 'verifying',
      ]);
      expect(result.primitiveMoveCount).toBe(result.moves.length);
      result.parityCorrections.forEach((correction) => observedParity.add(correction.kind));
    }
    expect(observedParity).toEqual(new Set(['flip', 'permutation']));
  }, 60_000);

  it('solves release-corpus edge-search regressions within the bounded search', () => {
    for (const seed of [2_880_678_742, 3_085_107_925, 2_902_260_191]) {
      let state = solvedState(4);
      for (const move of createScramble(4, 100, seededRandom(seed))) state = applyMove(state, 4, move);
      const result = solveFourByFour(state, {
        solveThree: (projected) => solveThree(projected, coordinates, pruning),
      });
      for (const move of result.moves) state = applyMove(state, 4, move);
      expect(isSolved(state, 4), `seed ${seed}`).toBe(true);
    }
  }, 30_000);
});
