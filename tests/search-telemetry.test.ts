import { describe, expect, it } from 'vitest';
import type { Move } from '../src/core/moves';
import { SearchTelemetryCollector, SEARCH_TELEMETRY_LIMIT, type SearchTelemetryNode } from '../src/solvers/telemetry';
import { layoutForceNodes, layoutRadialNodes, selectRadialNodes } from '../src/search/graphLayout';

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

  it('keeps the radial display sparse and connected through sampled parents', () => {
    const nodes: SearchTelemetryNode[] = [{ id: '0', distance: 0, stage: 'table-build' }];
    for (let distance = 1; distance <= 5; distance += 1) {
      const parentId = nodes.find((node) => node.distance === distance - 1)?.id ?? '0';
      for (let index = 0; index < 100; index += 1) {
        nodes.push({ id: `${distance}-${index}`, parentId, distance, stage: 'table-build' as const });
      }
    }
    const selected = selectRadialNodes(nodes);
    expect(selected.length).toBeLessThan(70);
    expect(selected.some((node) => node.distance === 5)).toBe(true);
    const ids = new Set(selected.map((node) => node.id));
    selected.filter((node) => node.distance > 0).forEach((node) => expect(ids.has(node.parentId!)).toBe(true));
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
