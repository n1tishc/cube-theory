import type { Move } from '../core/moves';
import { buildPocketDistanceTable, createPocketMoveTables, POCKET_STATES, solvePocketWithTable, type PocketMoveTables } from './pocket';
import { createCoordinateTables, type CoordinateTables } from './kociemba/coordinates';
import { createPruningTables, solveThree, type PruningTables } from './kociemba/search';
import { SearchTelemetryCollector, SEARCH_TELEMETRY_LIMIT, type PocketTelemetryStep, type SearchTelemetryBatch } from './telemetry';

export type SolverRequest =
  | { type: 'init'; requestId: number; size?: 2 | 3 }
  | { type: 'solve'; requestId: number; size: number; state: Uint8Array };

export type SolverResponse =
  | { type: 'progress'; requestId: number; phase: 'moves' | 'distances' | 'coordinates' | 'phase1' | 'phase2'; completed: number; total: number; depth?: number }
  | ({ type: 'telemetry'; requestId: number } & SearchTelemetryBatch)
  | { type: 'ready'; requestId: number; size: 2 | 3; elapsedMs: number }
  | { type: 'solution'; requestId: number; moves: Move[]; elapsedMs: number }
  | { type: 'error'; requestId: number; message: string };

let moveTables: PocketMoveTables | null = null;
let distances: Uint8Array | null = null;
let coordinateTables: CoordinateTables | null = null;
let pruningTables: PruningTables | null = null;
const scope = self as unknown as { postMessage(message: SolverResponse): void; onmessage: ((event: MessageEvent<SolverRequest>) => void) | null };

function initializePocket(requestId: number): void {
  if (distances) { scope.postMessage({ type: 'ready', requestId, size: 2, elapsedMs: 0 }); return; }
  const startedAt = performance.now();
  const telemetry = new SearchTelemetryCollector('table-build', SEARCH_TELEMETRY_LIMIT);
  telemetry.addNode({ id: '0', distance: 0, stage: 'table-build' });
  let explored = 1;
  let sampledSinceFlush = 0;
  const flushTelemetry = (complete = false) => {
    const batch: SearchTelemetryBatch = telemetry.drain(explored, complete);
    if (batch.nodes.length || batch.edges.length || complete) {
      scope.postMessage({ type: 'telemetry', requestId, ...batch });
    }
  };
  scope.postMessage({ type: 'progress', requestId, phase: 'moves', completed: 0, total: 1 });
  moveTables = createPocketMoveTables();
  scope.postMessage({ type: 'progress', requestId, phase: 'moves', completed: 1, total: 1 });
  distances = buildPocketDistanceTable(moveTables, (visited, depth) => {
    explored = visited;
    scope.postMessage({ type: 'progress', requestId, phase: 'distances', completed: visited, total: POCKET_STATES, depth });
    flushTelemetry();
  }, (coordinate, parent, move, distance) => {
    explored += 1;
    // Keep the first frontier legible, then sample uniformly across the rest
    // of the exact table. The collector also includes endpoints for edges.
    const stride = Math.max(1, Math.ceil(POCKET_STATES / (SEARCH_TELEMETRY_LIMIT - 1_200)));
    if (explored <= 1_200 || explored % stride === 0) {
      const parentId = String(parent);
      const nodeId = String(coordinate);
      telemetry.addNode({ id: parentId, distance: Math.max(0, distance - 1), stage: 'table-build' });
      if (telemetry.addNode({ id: nodeId, parentId, distance, stage: 'table-build' })) {
        telemetry.addEdge(parentId, nodeId, move);
        sampledSinceFlush += 1;
      }
      if (sampledSinceFlush >= 160) {
        sampledSinceFlush = 0;
        flushTelemetry();
      }
    }
  });
  flushTelemetry(true);
  scope.postMessage({ type: 'ready', requestId, size: 2, elapsedMs: performance.now() - startedAt });
}

function initializeThree(requestId: number): void {
  if (pruningTables && coordinateTables) { scope.postMessage({ type: 'ready', requestId, size: 3, elapsedMs: 0 }); return; }
  const startedAt = performance.now();
  coordinateTables = createCoordinateTables((completed, total) => scope.postMessage({ type: 'progress', requestId, phase: 'coordinates', completed, total }));
  pruningTables = createPruningTables(coordinateTables, (table, completed, total, depth) => scope.postMessage({
    type: 'progress', requestId, phase: table < 2 ? 'phase1' : 'phase2', completed, total, depth,
  }));
  scope.postMessage({ type: 'ready', requestId, size: 3, elapsedMs: performance.now() - startedAt });
}

scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === 'init') { request.size === 3 ? initializeThree(request.requestId) : initializePocket(request.requestId); return; }
    const startedAt = performance.now();
    let moves: Move[];
    if (request.size === 2) {
      if (!distances || !moveTables) initializePocket(request.requestId);
      if (!distances || !moveTables) throw new Error('Pocket table initialization failed');
      const telemetry = new SearchTelemetryCollector('warm-solve', SEARCH_TELEMETRY_LIMIT);
      const descent: PocketTelemetryStep[] = [];
      moves = solvePocketWithTable(new Uint8Array(request.state), distances, moveTables, (step) => {
        descent.push(step);
      });
      descent.forEach(({ coordinate, next, distance }, index) => {
        const source = String(coordinate);
        const target = String(next);
        const move = moves[index];
        if (!move) throw new Error('Pocket telemetry path does not match the verified solution');
        telemetry.addSolutionNode(source, distance);
        telemetry.addSolutionNode(target, Math.max(0, distance - 1), source);
        telemetry.addSolutionEdge(source, target, move);
      });
      const warmBatch = telemetry.drain(telemetry.nodeCount, true);
      scope.postMessage({ type: 'telemetry', requestId: request.requestId, ...warmBatch });
    } else if (request.size === 3) {
      if (!coordinateTables || !pruningTables) initializeThree(request.requestId);
      if (!coordinateTables || !pruningTables) throw new Error('3×3 table initialization failed');
      moves = solveThree(new Uint8Array(request.state), coordinateTables, pruningTables);
    } else throw new Error('Solving is available for N = 2 and N = 3');
    scope.postMessage({ type: 'solution', requestId: request.requestId, moves, elapsedMs: performance.now() - startedAt });
  } catch (error) {
    scope.postMessage({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : 'Unknown solver error' });
  }
};
