import type { Move } from '../core/moves';

/** Search samples are intentionally small enough to keep message traffic cheap. */
export const SEARCH_TELEMETRY_LIMIT = 3_000;

export type SearchTelemetryStage = 'table-build' | 'warm-solve';

export interface SearchTelemetryNode {
  id: string;
  parentId?: string;
  distance: number;
  stage: SearchTelemetryStage;
}

export interface SearchTelemetryEdge {
  id: string;
  source: string;
  target: string;
  move: Move;
  stage: SearchTelemetryStage;
  solution?: boolean;
}

export interface SearchTelemetryBatch {
  stage: SearchTelemetryStage;
  nodes: SearchTelemetryNode[];
  edges: SearchTelemetryEdge[];
  solutionPath?: string[];
  explored: number;
  complete?: boolean;
}

function moveKey(move: Move): string {
  return `${move.axis}:${move.layer}:${move.turns}`;
}

/**
 * Collects a bounded, mergeable event stream. Nodes are keyed by solver
 * coordinates instead of serialized cube states, so even the exact 2×2 table
 * remains cheap to inspect.
 */
export class SearchTelemetryCollector {
  private readonly nodes = new Map<string, SearchTelemetryNode>();
  private readonly edges = new Map<string, SearchTelemetryEdge>();
  private readonly emittedNodes = new Set<string>();
  private readonly emittedEdges = new Set<string>();
  private readonly path: string[] = [];

  constructor(
    readonly stage: SearchTelemetryStage,
    readonly limit = SEARCH_TELEMETRY_LIMIT,
  ) {}

  get nodeCount(): number { return this.nodes.size; }
  get edgeCount(): number { return this.edges.size; }

  addNode(node: SearchTelemetryNode): boolean {
    const existing = this.nodes.get(node.id);
    if (existing) {
      if (node.parentId && !existing.parentId) existing.parentId = node.parentId;
      if (node.distance < existing.distance) existing.distance = node.distance;
      return true;
    }
    if (this.nodes.size >= this.limit) return false;
    this.nodes.set(node.id, { ...node });
    return true;
  }

  addEdge(source: string, target: string, move: Move, solution = false): boolean {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return false;
    const id = `${source}>${target}:${moveKey(move)}`;
    const existing = this.edges.get(id);
    if (existing) {
      if (solution) existing.solution = true;
      return true;
    }
    this.edges.set(id, { id, source, target, move, stage: this.stage, solution });
    return true;
  }

  addSolutionNode(id: string, distance: number, parentId?: string): void {
    this.addNode({ id, distance, parentId, stage: this.stage });
    if (!this.path.includes(id)) this.path.push(id);
  }

  addSolutionEdge(source: string, target: string, move: Move): void {
    this.addEdge(source, target, move, true);
  }

  drain(explored: number, complete = false): SearchTelemetryBatch {
    const nodes = [...this.nodes.values()].filter((node) => !this.emittedNodes.has(node.id));
    const edges = [...this.edges.values()].filter((edge) => !this.emittedEdges.has(edge.id));
    nodes.forEach((node) => this.emittedNodes.add(node.id));
    edges.forEach((edge) => this.emittedEdges.add(edge.id));
    const batch: SearchTelemetryBatch = { stage: this.stage, nodes, edges, explored, complete };
    if (complete && this.path.length) batch.solutionPath = [...this.path];
    return batch;
  }
}

export interface PocketTelemetryStep {
  coordinate: number;
  next: number;
  move: Move;
  distance: number;
}

