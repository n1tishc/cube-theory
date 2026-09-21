import type { Move } from '../core/moves';
import type { SearchTelemetryBatch } from './telemetry';

export type SolverPhase =
  | 'moves' | 'distances' | 'coordinates' | 'phase1' | 'phase2'
  | 'centers' | 'edge-pairing' | 'parity' | 'three-by-three' | 'verifying';

export type SolverRequest =
  | { type: 'init'; requestId: number; size?: 2 | 3 | 4 }
  | { type: 'solve'; requestId: number; size: number; state: Uint8Array; qaDelayMs?: number };

export type SolverResponse =
  | { type: 'progress'; requestId: number; phase: SolverPhase; completed: number; total: number; depth?: number }
  | ({ type: 'telemetry'; requestId: number } & SearchTelemetryBatch)
  | { type: 'ready'; requestId: number; size: 2 | 3 | 4; elapsedMs: number }
  | { type: 'solution'; requestId: number; moves: Move[]; elapsedMs: number }
  | { type: 'error'; requestId: number; code: 'INVALID_INPUT' | 'INVARIANT_FAILURE' | 'ALGORITHM_COVERAGE' | 'RESOURCE_LIMIT' | 'INTERNAL'; message: string };
