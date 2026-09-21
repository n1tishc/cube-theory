import type { SearchTelemetryNode, SearchTelemetryStage } from '../solvers/telemetry';

export interface SearchGraphPoint {
  id: string;
  x: number;
  y: number;
  distance: number;
}

const TAU = Math.PI * 2;

/** Keep the diagram readable even though the worker retains thousands of samples. */
export const SEARCH_GRAPH_RING_BASE = 1;

function stableAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
  return ((hash >>> 0) / 0x1_0000_0000) * TAU;
}

/** Exact 2×2 coordinates are arranged in distance rings around solved. */
export function layoutRadialNodes(nodes: readonly SearchTelemetryNode[], width = 900, height = 520): SearchGraphPoint[] {
  const centerX = width * 0.5;
  const centerY = height * 0.52;
  const radius = Math.min(width, height) * 0.41;
  const maxDistance = Math.max(1, ...nodes.map((node) => node.distance));
  const byDistance = new Map<number, SearchTelemetryNode[]>();
  nodes.forEach((node) => {
    const bucket = byDistance.get(node.distance) ?? [];
    bucket.push(node);
    byDistance.set(node.distance, bucket);
  });
  const points: SearchGraphPoint[] = [];
  const angleById = new Map<string, number>();
  [...byDistance.entries()].sort(([left], [right]) => left - right).forEach(([distance, bucket]) => {
    bucket.sort((left, right) => {
      const leftParentAngle = left.parentId ? angleById.get(left.parentId) : undefined;
      const rightParentAngle = right.parentId ? angleById.get(right.parentId) : undefined;
      if (leftParentAngle !== undefined && rightParentAngle !== undefined && leftParentAngle !== rightParentAngle) {
        return leftParentAngle - rightParentAngle;
      }
      return left.id.localeCompare(right.id);
    });
    const ringRadius = distance === 0 ? 0 : radius * (distance / maxDistance);
    const rotation = -Math.PI / 2 + stableAngle(`ring-${distance}`) * 0.025;
    bucket.forEach((node, index) => {
      const angle = distance === 0 ? 0 : rotation + (index / Math.max(1, bucket.length)) * TAU;
      angleById.set(node.id, angle);
      points.push({ id: node.id, distance: node.distance, x: centerX + Math.cos(angle) * ringRadius, y: centerY + Math.sin(angle) * ringRadius });
    });
  });
  return points;
}

function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * items.length / count)]!);
}

/**
 * Chooses a sparse, mostly connected set for display. The full sample remains
 * available to the status counter; this only controls visual density.
 */
export function selectRadialNodes(nodes: readonly SearchTelemetryNode[]): SearchTelemetryNode[] {
  const ordered = [...nodes].sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
  const selected = new Map<string, SearchTelemetryNode>();
  const maxDistance = Math.max(0, ...ordered.map((node) => node.distance));

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const ring = ordered.filter((node) => node.distance === distance);
    const connected = distance === 0
      ? ring
      : ring.filter((node) => node.parentId && selected.has(node.parentId));
    const candidates = connected.length ? connected : ring;
    const capacity = distance === 0 ? 1 : SEARCH_GRAPH_RING_BASE + distance;
    evenlySpaced(candidates, capacity).forEach((node) => selected.set(node.id, node));
  }

  return [...selected.values()];
}

/** A bounded deterministic force layout for non-pocket/general samples. */
export function layoutForceNodes(nodes: readonly SearchTelemetryNode[], width = 900, height = 520): SearchGraphPoint[] {
  const points = nodes.map((node, index) => ({
    id: node.id,
    distance: node.distance,
    x: width * (0.2 + ((index * 37) % 61) / 100),
    y: height * (0.18 + ((index * 53) % 61) / 100),
  }));
  const iterations = Math.min(18, Math.max(4, Math.ceil(points.length / 160)));
  const neighborSpan = 8;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    points.forEach((point, index) => {
      let dx = (width * 0.5 - point.x) * 0.015;
      let dy = (height * 0.5 - point.y) * 0.015;
      // Keep layout work linear in the sample bound. A small deterministic
      // neighborhood is enough for a legible general-search sketch and does
      // not monopolize the main thread if a future worker sends 3,000 nodes.
      for (let offset = -neighborSpan; offset <= neighborSpan; offset += 1) {
        if (offset === 0) continue;
        const otherIndex = (index + offset + points.length) % points.length;
        const other = points[otherIndex];
        if (!other) continue;
        const x = point.x - other.x;
        const y = point.y - other.y;
        const distance = Math.max(18, Math.hypot(x, y));
        const force = Math.min(3.5, 320 / (distance * distance));
        dx += (x / distance) * force;
        dy += (y / distance) * force;
      }
      point.x = Math.max(18, Math.min(width - 18, point.x + dx));
      point.y = Math.max(18, Math.min(height - 18, point.y + dy));
    });
  }
  return points;
}

export function layoutSearchNodes(
  nodes: readonly SearchTelemetryNode[],
  stage: SearchTelemetryStage,
  width = 900,
  height = 520,
): SearchGraphPoint[] {
  return stage === 'table-build'
    ? layoutRadialNodes(nodes, width, height)
    : layoutForceNodes(nodes, width, height);
}
