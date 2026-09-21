import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invertMove, type Move } from '../src/core/moves';
import { createScramble } from '../src/core/scramble';
import { applyMove, isSolved, solvedState } from '../src/core/state';
import { createCoordinateTables, type CoordinateTables } from '../src/solvers/kociemba/coordinates';
import { createPruningTables, solveThree, type PruningTables } from '../src/solvers/kociemba/search';
import { ReductionSolveError, solveFourByFour, type ReductionStage } from '../src/solvers/reduction/solve';

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
const releaseCorpusEnabled = runtime.process?.env?.CUBE_RELEASE_CORPUS === '1';
const WARM_P95_TARGET_MS = 5_000;
const MAX_SOLUTION_MOVES = 20_000;

interface CorpusCase { readonly seed: number; readonly length: 100 | 500 }

interface CorpusMeasurement {
  readonly seed: number;
  readonly scrambleLength: number;
  readonly elapsedMs: number;
  readonly solutionMoves: number;
  readonly stages: Readonly<Record<ReductionStage, number>>;
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

function applyMoves(state: Uint8Array, moves: readonly Move[]): Uint8Array {
  return moves.reduce((current, move) => applyMove(current, 4, move), state);
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function corpusCases(): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (let index = 0; index < 200; index += 1) {
    cases.push({ seed: (0x4c00_0000 + index * 0x9e37_79b1) >>> 0, length: 100 });
  }
  for (let index = 0; index < 20; index += 1) {
    cases.push({ seed: (0x4c50_0000 + index * 0x85eb_ca6b) >>> 0, length: 500 });
  }
  return cases;
}

describe.skipIf(!releaseCorpusEnabled)('4×4 milestone release corpus', () => {
  let coordinates: CoordinateTables;
  let pruning: PruningTables;
  const measurements: CorpusMeasurement[] = [];
  const failures: unknown[] = [];

  beforeAll(() => {
    coordinates = createCoordinateTables();
    pruning = createPruningTables(coordinates);
  }, 30_000);

  it.each(corpusCases())('solves and replays $length-move seed $seed', async (corpusCase) => {
    const scramble = createScramble(4, corpusCase.length, seededRandom(corpusCase.seed));
    const input = applyMoves(solvedState(4), scramble);
    const startedAt = performance.now();
    try {
      const result = solveFourByFour(input, {
        solveThree: (projected) => solveThree(projected, coordinates, pruning),
      });
      const elapsedMs = performance.now() - startedAt;
      const solved = applyMoves(input, result.moves);
      const restored = applyMoves(solved, [...result.moves].reverse().map(invertMove));
      expect(isSolved(solved, 4), `seed ${corpusCase.seed}`).toBe(true);
      expect(restored, `reverse replay seed ${corpusCase.seed}`).toEqual(input);
      expect(result.moves.length, `move bound seed ${corpusCase.seed}`).toBeLessThanOrEqual(MAX_SOLUTION_MOVES);
      measurements.push({
        seed: corpusCase.seed,
        scrambleLength: corpusCase.length,
        elapsedMs,
        solutionMoves: result.moves.length,
        stages: Object.fromEntries(result.stages.map((stage) => [stage.stage, stage.elapsedMs])) as Record<ReductionStage, number>,
      });
    } catch (error) {
      failures.push({
        seed: corpusCase.seed,
        scrambleLength: corpusCase.length,
        code: error instanceof ReductionSolveError ? error.code : 'UNEXPECTED',
        stage: error instanceof ReductionSolveError ? error.stage : undefined,
        message: error instanceof Error ? error.message : String(error),
        state: Array.from(input),
      });
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }, 60_000);

  afterAll(() => {
    const elapsed = measurements.map((measurement) => measurement.elapsedMs);
    const moves = measurements.map((measurement) => measurement.solutionMoves);
    const summary = {
      environment: 'Vitest/Node; browser memory and responsiveness are separate S5.6 gates',
      cases: corpusCases().length,
      successes: measurements.length,
      failures: failures.length,
      warmMs: { p50: percentile(elapsed, 0.5), p95: percentile(elapsed, 0.95), max: Math.max(...elapsed, 0) },
      solutionMoves: { p50: percentile(moves, 0.5), p95: percentile(moves, 0.95), max: Math.max(...moves, 0) },
      stageP95Ms: Object.fromEntries((['centers', 'edge-pairing', 'parity', 'three-by-three', 'verifying'] as const)
        .map((stage) => [stage, percentile(measurements.map((measurement) => measurement.stages[stage]), 0.95)])),
    };
    console.info('4×4 release corpus summary', JSON.stringify(summary, null, 2));
    if (failures.length) console.error('4×4 release corpus failures', JSON.stringify(failures, null, 2));

    expect(failures, 'every failing seed is serialized above').toEqual([]);
    expect(summary.warmMs.p95).toBeLessThanOrEqual(WARM_P95_TARGET_MS);
  });
});
