import type { Move } from '../../core/moves';
import { applyMove, isSolved, solvedState } from '../../core/state';
import { invertAlgorithm } from './algorithms';
import { macroById, type QualifiedMacro } from './catalog';
import { CUBE_FRAMES, transformMove, type CubeFrame } from './frame';
import { centersSolved, pairedEdgeBundleCount } from './invariants';

export type TerminalFamily = 'last-two-centers' | 'last-three-edge-pairs' | 'single-unmatched-edge-pair';

export interface TerminalFixture {
  readonly id: string;
  readonly family: TerminalFamily;
  readonly macroId: string;
  readonly frame: CubeFrame;
  readonly direction: 'forward' | 'inverse';
  readonly state: Uint8Array;
  readonly correction: readonly Move[];
  readonly pairedBundlesBefore: number;
}

export interface TerminalQualificationReport {
  readonly fixtures: readonly TerminalFixture[];
  readonly caseCountByFamily: Readonly<Record<TerminalFamily, number>>;
  readonly distinctStateCountByFamily: Readonly<Record<TerminalFamily, number>>;
  readonly maximumCorrectionLength: number;
}

const TERMINAL_MACROS: Readonly<Record<TerminalFamily, string>> = {
  'last-two-centers': 'center-last-pair',
  'last-three-edge-pairs': 'edge-release-three-pairs',
  'single-unmatched-edge-pair': 'edge-pair-insert',
};

function applyMoves(state: Uint8Array, moves: readonly Move[]): Uint8Array {
  return moves.reduce((current, move) => applyMove(current, 4, move), state);
}

function conjugated(frame: CubeFrame, moves: readonly Move[]): Move[] {
  return moves.map((move) => transformMove(frame, 4, move));
}

function fixtureFor(
  family: TerminalFamily,
  macro: QualifiedMacro,
  frame: CubeFrame,
  direction: 'forward' | 'inverse',
): TerminalFixture {
  const sourceCorrection = direction === 'forward' ? macro.moves : macro.inverse;
  const correction = conjugated(frame, sourceCorrection);
  const state = applyMoves(solvedState(4), invertAlgorithm(correction));
  return {
    id: `${family}:${frame.id}:${direction}`,
    family,
    macroId: macro.id,
    frame,
    direction,
    state,
    correction,
    pairedBundlesBefore: pairedEdgeBundleCount(state, 4),
  };
}

/**
 * Enumerates the complete symmetry closure of the documented 4×4
 * terminal families. Each fixture is constructive: applying its correction
 * must solve the exact full-facelet predecessor, not merely a projection.
 */
export function enumerateTerminalFixtures(): TerminalFixture[] {
  return (Object.entries(TERMINAL_MACROS) as [TerminalFamily, string][]).flatMap(
    ([family, macroId]) => {
      const macro = macroById(macroId);
      return CUBE_FRAMES.flatMap((frame) => [
        fixtureFor(family, macro, frame, 'forward'),
        fixtureFor(family, macro, frame, 'inverse'),
      ]);
    },
  );
}

export function qualifyTerminalCatalog(): TerminalQualificationReport {
  const fixtures = enumerateTerminalFixtures();
  const families = Object.keys(TERMINAL_MACROS) as TerminalFamily[];
  for (const fixture of fixtures) {
    if (fixture.family !== 'last-two-centers' && !centersSolved(fixture.state, 4)) {
      throw new Error(`${fixture.id} violates the solved-center entry invariant`);
    }
    const result = applyMoves(fixture.state, fixture.correction);
    if (!isSolved(result, 4)) throw new Error(`${fixture.id} correction failed full-state replay`);
  }

  const count = (family: TerminalFamily) => fixtures.filter((fixture) => fixture.family === family);
  return {
    fixtures,
    caseCountByFamily: Object.fromEntries(families.map((family) => [family, count(family).length])) as Record<TerminalFamily, number>,
    distinctStateCountByFamily: Object.fromEntries(families.map((family) => [
      family,
      new Set(count(family).map((fixture) => fixture.state.join(','))).size,
    ])) as Record<TerminalFamily, number>,
    maximumCorrectionLength: Math.max(...fixtures.map((fixture) => fixture.correction.length)),
  };
}
