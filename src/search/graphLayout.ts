import type { SearchTelemetryNode, SearchTelemetryStage } from '../solvers/telemetry';

export interface SearchGraphPoint {
  id: string;
  x: number;
  y: number;
  distance: number;
}

const TAU = Math.PI * 2;

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
  byDistance.forEach((bucket, distance) => {
    bucket.sort((left, right) => left.id.localeCompare(right.id));
    const ringRadius = distance === 0 ? 0 : radius * (distance / maxDistance);
    bucket.forEach((node, index) => {
      const angle = distance === 0 ? 0 : stableAngle(node.id) + (index / Math.max(1, bucket.length)) * TAU;
      points.push({ id: node.id, distance: node.distance, x: centerX + Math.cos(angle) * ringRadius, y: centerY + Math.sin(angle) * ringRadius });
    });
  });
  return points;
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
