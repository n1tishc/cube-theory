import { describe, expect, it } from 'vitest';
import { buildMovePermutation, invertMove, type Move } from '../src/core/moves';
import { applyMove, applyPermutation, solvedState } from '../src/core/state';
import {
  FOUR_BY_FOUR_MACROS,
  compileMovePermutation,
  compileSourceAlgorithm,
  macroById,
} from '../src/solvers/reduction/catalog';
import { buildReductionGeometry, movedPieceSlotKey } from '../src/solvers/reduction/geometry';
import { centersSolved, edgesPaired, pairedEdgeBundleCount } from '../src/solvers/reduction/invariants';
import { findSetup } from '../src/solvers/reduction/setupSearch';
import { enumerateTerminalFixtures, qualifyTerminalCatalog } from '../src/solvers/reduction/qualification';

function labeledState(size: number): Uint8Array {
  return Uint8Array.from({ length: 6 * size * size }, (_, index) => index);
}

function applyMoves(state: Uint8Array, size: number, moves: readonly Move[]): Uint8Array {
  return moves.reduce((current, move) => applyMove(current, size, move), state);
}

function outerGenerators(size: number): Move[] {
  return ([0, 1, 2] as const).flatMap((axis) => [0, size - 1].flatMap((layer) =>
    ([1, 2, 3] as const).map((turns) => ({ axis, layer, turns })),
  ));
}

describe('4×4 source notation', () => {
  it('treats lowercase source moves as one inner slice, not a wide turn', () => {
    expect(compileSourceAlgorithm("r U r'")).toEqual([
      { axis: 0, layer: 2, turns: 1 },
      { axis: 1, layer: 3, turns: 1 },
      { axis: 0, layer: 2, turns: 3 },
    ]);
    expect(compileSourceAlgorithm('d2')).toEqual([{ axis: 1, layer: 1, turns: 2 }]);
  });

  it('rejects rotations, grouping, and undeclared source syntax', () => {
    expect(() => compileSourceAlgorithm('(r U)2')).toThrow(/Unsupported/);
    expect(() => compileSourceAlgorithm('x r')).toThrow(/Unsupported/);
    expect(() => compileSourceAlgorithm('Rw')).toThrow(/Unsupported/);
  });
});

describe('4×4 executable macro catalog', () => {
  it('records a complete executable contract for every qualified entry', () => {
    expect(FOUR_BY_FOUR_MACROS.map((macro) => macro.id)).toEqual([
      'center-insert-front',
      'center-insert-opposite',
      'center-pair-cycle',
      'center-pair-swap',
      'center-last-pair',
      'edge-pair-insert',
      'edge-release-three-pairs',
      'parity-single-bundle-flip',
      'parity-bundle-permutation',
    ]);
    for (const macro of FOUR_BY_FOUR_MACROS) {
      expect(macro.size).toBe(4);
      expect(macro.source.url).toMatch(/^https:\/\//);
      expect(macro.source.notation).toBe('jaap-single-inner-slice');
      expect(macro.setup.length).toBeGreaterThan(20);
      expect(macro.desiredEffect.length).toBeGreaterThan(20);
      expect(macro.preservedInvariants.length).toBeGreaterThan(0);
      expect(macro.moves.length).toBeGreaterThan(0);
      expect(macro.permutation).toHaveLength(96);
      expect(new Set(macro.permutation).size).toBe(96);
      expect(macro.pieceCycles.length).toBeGreaterThan(0);
    }
  });

  it('measures each full permutation and supplies an exact inverse', () => {
    const identity = labeledState(4);
    for (const macro of FOUR_BY_FOUR_MACROS) {
      let direct = identity;
      for (const move of macro.moves) {
        direct = applyPermutation(direct, buildMovePermutation(4, move));
      }
      expect(applyPermutation(identity, macro.permutation)).toEqual(direct);
      expect(compileMovePermutation(4, macro.moves)).toEqual(macro.permutation);
      expect(macro.inverse).toEqual([...macro.moves].reverse().map(invertMove));
      const restored = macro.inverse.reduce(
        (state, move) => applyPermutation(state, buildMovePermutation(4, move)),
        direct,
      );
      expect(restored).toEqual(identity);
    }
  });

  it('keeps centers solved and bundles complete across parity macros', () => {
    for (const id of ['parity-single-bundle-flip', 'parity-bundle-permutation']) {
      const result = applyMoves(solvedState(4), 4, macroById(id).moves);
      expect(centersSolved(result, 4), id).toBe(true);
      expect(edgesPaired(result, 4), id).toBe(true);
      expect(pairedEdgeBundleCount(result, 4), id).toBe(12);
    }
  });

  it('keeps centers solved across edge pairing and release transactions', () => {
    for (const id of ['edge-pair-insert', 'edge-release-three-pairs']) {
      const result = applyMoves(solvedState(4), 4, macroById(id).moves);
      expect(centersSolved(result, 4), id).toBe(true);
    }
  });
});

describe('bounded outer-turn setup search', () => {
  it('covers every position of the 4×4 wing orbit with finite predecessor search', () => {
    const geometry = buildReductionGeometry(4);
    const wing = geometry.wingOrbits[0];
    const target = wing?.slotKeys[0];
    expect(target).toBeDefined();
    const generators = outerGenerators(4);

    for (const initial of wing?.slotKeys ?? []) {
      const result = findSetup({
        initial,
        key: (slotKey) => slotKey,
        isGoal: (slotKey) => slotKey === target,
        generators,
        apply: (slotKey, move) => {
          const slot = geometry.slotByKey.get(slotKey);
          if (!slot) throw new Error(`Unknown setup-search slot ${slotKey}`);
          return movedPieceSlotKey(4, slot, move.axis, move.layer, move.turns);
        },
        maxVisited: 250_000,
      });
      expect(result, initial).not.toBeNull();
      expect(result?.visited).toBeLessThanOrEqual(24);
      expect(result?.depth).toBeLessThanOrEqual(3);
      expect(result?.moves.length).toBe(result?.depth);
    }
  });

  it('terminates at explicit depth and visited limits', () => {
    const generators: Move[] = [{ axis: 0, layer: 0, turns: 1 }];
    expect(findSetup({
      initial: 0,
      key: String,
      isGoal: (state) => state === 9,
      generators,
      apply: (state) => state + 1,
      maxDepth: 2,
    })).toBeNull();
    expect(findSetup({
      initial: 0,
      key: String,
      isGoal: (state) => state === 9,
      generators,
      apply: (state) => state + 1,
      maxVisited: 2,
      maxDepth: 20,
    })).toBeNull();
  });
});

describe('exhaustive 4×4 terminal-family qualification', () => {
  it('covers both directions through all 24 proper cube frames', () => {
    const report = qualifyTerminalCatalog();
    expect(report.caseCountByFamily).toEqual({
      'last-two-centers': 48,
      'last-three-edge-pairs': 48,
      'single-unmatched-edge-pair': 48,
    });
    expect(report.fixtures).toHaveLength(144);
    expect(new Set(report.fixtures.map((fixture) => fixture.id)).size).toBe(144);
    expect(report.distinctStateCountByFamily['last-two-centers']).toBeGreaterThan(1);
    expect(report.distinctStateCountByFamily['last-three-edge-pairs']).toBeGreaterThan(1);
    expect(report.distinctStateCountByFamily['single-unmatched-edge-pair']).toBeGreaterThan(1);
  });

  it('replays every full-state fixture to solved and preserves edge-entry center locks', () => {
    for (const fixture of enumerateTerminalFixtures()) {
      const result = applyMoves(fixture.state, 4, fixture.correction);
      expect(result, fixture.id).toEqual(solvedState(4));
      if (fixture.family !== 'last-two-centers') {
        expect(centersSolved(fixture.state, 4), fixture.id).toBe(true);
        expect(fixture.pairedBundlesBefore, fixture.id).toBeLessThan(12);
      }
    }
  });

  it('keeps every qualified correction within its declared primitive bound', () => {
    const report = qualifyTerminalCatalog();
    expect(report.maximumCorrectionLength).toBe(
      Math.max(macroById('center-last-pair').moves.length, macroById('edge-release-three-pairs').moves.length),
    );
    expect(report.fixtures.every((fixture) => fixture.correction.length <= report.maximumCorrectionLength)).toBe(true);
  });
});
