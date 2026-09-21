import type { Move } from '../../core/moves';
import { applyMove, isSolved } from '../../core/state';
import { macroById } from './catalog';
import { solveFourByFourCenters } from './centers';
import { pairFourByFourEdges } from './edges';
import { centersSolved, edgesPaired } from './invariants';
import { projectReducedState, solveReducedWithThree } from './projection';
import { enumerateTerminalFixtures, type TerminalFixture } from './qualification';

export type ReductionStage = 'centers' | 'edge-pairing' | 'parity' | 'three-by-three' | 'verifying';
export type ReductionErrorCode = 'INVALID_INPUT' | 'INVARIANT_FAILURE' | 'ALGORITHM_COVERAGE' | 'RESOURCE_LIMIT';

export interface StageRange {
  readonly stage: ReductionStage;
  readonly from: number;
  readonly to: number;
  readonly elapsedMs: number;
}

export interface ParityCorrectionRecord {
  readonly kind: 'flip' | 'permutation';
  readonly macroId: string;
  readonly fromMove: number;
  readonly toMove: number;
}

export interface FourByFourSolution {
  readonly moves: readonly Move[];
  readonly stages: readonly StageRange[];
  readonly parityCorrections: readonly ParityCorrectionRecord[];
  readonly primitiveMoveCount: number;
}

export interface ReductionProgress {
  readonly stage: ReductionStage;
  readonly completed?: number;
  readonly total?: number;
}

export interface FourByFourReductionOptions {
  readonly solveThree: (state: Uint8Array) => readonly Move[];
  readonly reduceCenters?: (state: Uint8Array) => readonly Move[];
  readonly pairEdges?: (state: Uint8Array) => readonly Move[];
  readonly progress?: (progress: ReductionProgress) => void;
  readonly now?: () => number;
  readonly maxMoves?: number;
}

export class ReductionSolveError extends Error {
  constructor(readonly code: ReductionErrorCode, readonly stage: ReductionStage, message: string) {
    super(message);
    this.name = 'ReductionSolveError';
  }
}

function stateKey(state: Uint8Array): string { return state.join(','); }

const terminalFixtures = enumerateTerminalFixtures();
const centerFixtures = new Map(terminalFixtures
  .filter((fixture) => fixture.family === 'last-two-centers')
  .map((fixture) => [stateKey(fixture.state), fixture]));
const edgeFixtures = new Map(terminalFixtures
  .filter((fixture) => fixture.family !== 'last-two-centers')
  .map((fixture) => [stateKey(fixture.state), fixture]));

function qualifiedCorrection(fixtures: ReadonlyMap<string, TerminalFixture>, state: Uint8Array): readonly Move[] {
  return fixtures.get(stateKey(state))?.correction ?? [];
}

export function reduceQualifiedCenters(state: Uint8Array): readonly Move[] {
  if (centersSolved(state, 4)) return [];
  const correction = qualifiedCorrection(centerFixtures, state);
  if (correction.length) return correction;
  try {
    return solveFourByFourCenters(state).moves;
  } catch (error) {
    throw new ReductionSolveError(
      'ALGORITHM_COVERAGE', 'centers', error instanceof Error ? error.message : 'Center search failed',
    );
  }
}

export function pairQualifiedEdges(state: Uint8Array): readonly Move[] {
  if (edgesPaired(state, 4)) return [];
  const correction = qualifiedCorrection(edgeFixtures, state);
  if (correction.length) return correction;
  try {
    return pairFourByFourEdges(state).moves;
  } catch (error) {
    throw new ReductionSolveError(
      'ALGORITHM_COVERAGE', 'edge-pairing', error instanceof Error ? error.message : 'Edge pairing failed',
    );
  }
}

function validateInput(state: Uint8Array): void {
  if (state.length !== 96) throw new ReductionSolveError('INVALID_INPUT', 'centers', 'A 4×4 state must contain 96 facelets');
  const counts = new Array<number>(6).fill(0);
  for (const color of state) {
    if (color >= 6) throw new ReductionSolveError('INVALID_INPUT', 'centers', 'A 4×4 state contains an invalid color');
    counts[color] = (counts[color] ?? 0) + 1;
  }
  if (counts.some((count) => count !== 16)) {
    throw new ReductionSolveError('INVALID_INPUT', 'centers', 'A 4×4 state must contain sixteen facelets of each color');
  }
}

export function solveFourByFour(input: Uint8Array, options: FourByFourReductionOptions): FourByFourSolution {
  validateInput(input);
  const now = options.now ?? (() => performance.now());
  const maxMoves = options.maxMoves ?? 20_000;
  const moves: Move[] = [];
  const stages: StageRange[] = [];
  const parityCorrections: ParityCorrectionRecord[] = [];
  let state: Uint8Array = input.slice();

  const run = (stage: ReductionStage, operation: () => readonly Move[]): void => {
    options.progress?.({ stage });
    const startedAt = now();
    const from = moves.length;
    const additions = operation();
    if (moves.length + additions.length > maxMoves) {
      throw new ReductionSolveError('RESOURCE_LIMIT', stage, `Reduction exceeds the ${maxMoves} move limit`);
    }
    for (const move of additions) state = applyMove(state, 4, move);
    moves.push(...additions);
    stages.push({ stage, from, to: moves.length, elapsedMs: now() - startedAt });
  };

  run('centers', () => (options.reduceCenters ?? reduceQualifiedCenters)(state));
  if (!centersSolved(state, 4)) throw new ReductionSolveError('INVARIANT_FAILURE', 'centers', 'Center reduction did not solve every center block');

  run('edge-pairing', () => (options.pairEdges ?? pairQualifiedEdges)(state));
  if (!centersSolved(state, 4) || !edgesPaired(state, 4)) {
    throw new ReductionSolveError('INVARIANT_FAILURE', 'edge-pairing', 'Edge pairing did not preserve solved centers and complete every bundle');
  }

  run('parity', () => {
    const corrections: Move[] = [];
    let parityState: Uint8Array = state;
    let projection = projectReducedState(parityState, 4);
    const append = (kind: 'flip' | 'permutation', macroId: string) => {
      const macroMoves = macroById(macroId).moves;
      const fromMove = moves.length + corrections.length;
      for (const move of macroMoves) parityState = applyMove(parityState, 4, move);
      corrections.push(...macroMoves);
      parityCorrections.push({ kind, macroId, fromMove, toMove: fromMove + macroMoves.length });
      projection = projectReducedState(parityState, 4);
    };
    if (projection.diagnostics.flipParity) append('flip', 'parity-single-bundle-flip');
    if (projection.diagnostics.permutationParity) append('permutation', 'parity-bundle-permutation');
    if (projection.diagnostics.flipParity || projection.diagnostics.permutationParity) {
      throw new ReductionSolveError('INVARIANT_FAILURE', 'parity', 'Bounded parity correction did not produce a legal virtual 3×3');
    }
    return corrections;
  });

  run('three-by-three', () => solveReducedWithThree(state, 4, options.solveThree).moves);
  run('verifying', () => []);
  if (!isSolved(state, 4)) throw new ReductionSolveError('INVARIANT_FAILURE', 'verifying', 'Full 4×4 solution replay did not finish solved');

  return { moves, stages, parityCorrections, primitiveMoveCount: moves.length };
}
