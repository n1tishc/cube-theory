import { describe, expect, it } from 'vitest';
import type { Move } from '../src/core/moves';
import { applyMove, isSolved, solvedState } from '../src/core/state';
import { macroById } from '../src/solvers/reduction/catalog';
import { enumerateTerminalFixtures } from '../src/solvers/reduction/qualification';
import { ReductionSolveError, solveFourByFour } from '../src/solvers/reduction/solve';

function applyMoves(state: Uint8Array, moves: readonly Move[]): Uint8Array {
  return moves.reduce((current, move) => applyMove(current, 4, move), state);
}

describe('4×4 reduction pipeline', () => {
  it('passes an already reduced solved cube through every gated stage', () => {
    const progress: string[] = [];
    const result = solveFourByFour(solvedState(4), {
      solveThree: () => [],
      progress: ({ stage }) => progress.push(stage),
      now: () => 10,
    });
    expect(result.moves).toEqual([]);
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      'centers', 'edge-pairing', 'parity', 'three-by-three', 'verifying',
    ]);
    expect(progress).toEqual(result.stages.map((stage) => stage.stage));
    expect(result.stages.every((stage) => stage.elapsedMs === 0)).toBe(true);
  });

  it('solves every qualified center and edge terminal fixture without history', () => {
    for (const fixture of enumerateTerminalFixtures()) {
      const result = solveFourByFour(fixture.state, { solveThree: () => [] });
      expect(applyMoves(fixture.state, result.moves), fixture.id).toEqual(solvedState(4));
      expect(result.primitiveMoveCount, fixture.id).toBe(result.moves.length);
    }
  });

  it('diagnoses and physically repairs each qualified even-cube parity bit', () => {
    const cases = [
      ['parity-single-bundle-flip', 'flip'],
      ['parity-bundle-permutation', 'permutation'],
    ] as const;
    for (const [macroId, kind] of cases) {
      const macro = macroById(macroId);
      const input = applyMoves(solvedState(4), macro.inverse);
      const result = solveFourByFour(input, { solveThree: () => [] });
      expect(result.parityCorrections.map((record) => record.kind), macroId).toEqual([kind]);
      expect(result.parityCorrections[0]?.macroId).toBe(macroId);
      expect(isSolved(applyMoves(input, result.moves), 4), macroId).toBe(true);
    }
  });

  it('reports coverage, invariant, input, and move-budget failures structurally', () => {
    expect(() => solveFourByFour(solvedState(4), {
      solveThree: () => [],
      pairEdges: () => { throw new ReductionSolveError('ALGORITHM_COVERAGE', 'edge-pairing', 'fixture'); },
    })).toThrowError(expect.objectContaining<Partial<ReductionSolveError>>({ code: 'ALGORITHM_COVERAGE', stage: 'edge-pairing' }));
    expect(() => solveFourByFour(solvedState(4), {
      solveThree: () => [],
      reduceCenters: () => [{ axis: 0, layer: 1, turns: 1 }],
    })).toThrowError(expect.objectContaining<Partial<ReductionSolveError>>({ code: 'INVARIANT_FAILURE', stage: 'centers' }));
    expect(() => solveFourByFour(new Uint8Array(95), { solveThree: () => [] })).toThrowError(
      expect.objectContaining<Partial<ReductionSolveError>>({ code: 'INVALID_INPUT' }),
    );
    const fixture = enumerateTerminalFixtures().find((candidate) => candidate.correction.length > 0)!;
    expect(() => solveFourByFour(fixture.state, { solveThree: () => [], maxMoves: 0 })).toThrowError(
      expect.objectContaining<Partial<ReductionSolveError>>({ code: 'RESOURCE_LIMIT' }),
    );
  });
});
