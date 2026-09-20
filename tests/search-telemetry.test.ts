import { describe, expect, it } from 'vitest';
import type { Move } from '../src/core/moves';
import { SearchTelemetryCollector, SEARCH_TELEMETRY_LIMIT } from '../src/solvers/telemetry';
import { layoutForceNodes, layoutRadialNodes } from '../src/search/graphLayout';

const move: Move = { axis: 0, layer: 1, turns: 1 };

describe('bounded search telemetry', () => {
  it('caps sampled nodes while retaining a highlighted descent path', () => {
    const collector = new SearchTelemetryCollector('warm-solve', 4);
    collector.addSolutionNode('12', 3);
    collector.addSolutionNode('8', 2, '12');
    collector.addSolutionEdge('12', '8', move);
    collector.addSolutionNode('4', 1, '8');
    collector.addSolutionEdge('8', '4', { ...move, turns: 2 });
    collector.addSolutionNode('0', 0, '4');
    collector.addSolutionEdge('4', '0', { ...move, turns: 3 });
    collector.addNode({ id: 'overflow', distance: 8, stage: 'warm-solve' });

    const batch = collector.drain(42, true);
    expect(batch.nodes).toHaveLength(4);
    expect(batch.edges).toHaveLength(3);
    expect(batch.solutionPath).toEqual(['12', '8', '4', '0']);
    expect(collector.nodeCount).toBeLessThanOrEqual(SEARCH_TELEMETRY_LIMIT);
  });

  it('keeps table-build and warm-solve stages distinct', () => {
    const table = new SearchTelemetryCollector('table-build');
    const warm = new SearchTelemetryCollector('warm-solve');
    expect(table.drain(1).stage).toBe('table-build');
    expect(warm.drain(1).stage).toBe('warm-solve');
  });
});

describe('search graph layouts', () => {
  it('places exact-table coordinates on distance rings', () => {
    const nodes = [0, 1, 2, 3].map((distance) => ({ id: String(distance), distance, stage: 'table-build' as const }));
    const points = layoutRadialNodes(nodes, 900, 520);
    const solved = points.find((point) => point.id === '0');
    const farthest = points.find((point) => point.id === '3');
    expect(solved).toBeDefined();
    expect(farthest).toBeDefined();
    if (solved && farthest) expect(Math.hypot(farthest.x - 450, farthest.y - 270)).toBeGreaterThan(100);
  });

  it('returns bounded coordinates for general samples', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => ({ id: String(index), distance: index % 8, stage: 'warm-solve' as const }));
    layoutForceNodes(nodes).forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(18);
      expect(point.x).toBeLessThanOrEqual(882);
      expect(point.y).toBeGreaterThanOrEqual(18);
      expect(point.y).toBeLessThanOrEqual(502);
    });
  });
});
