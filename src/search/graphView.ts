import type { Move } from '../core/moves';
import type { SearchTelemetryBatch, SearchTelemetryEdge, SearchTelemetryNode, SearchTelemetryStage } from '../solvers/telemetry';
import { layoutSearchNodes, type SearchGraphPoint } from './graphLayout';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MOVE_COLORS = ['#cf2928', '#0b59b8', '#39a86f'];

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function moveLabel(move: Move): string {
  return `axis ${'XYZ'[move.axis] ?? '?'} · layer ${move.layer + 1} · ${move.turns === 2 ? 'half' : move.turns === 3 ? 'inverse' : 'quarter'} turn`;
}

export class SearchGraphView {
  private readonly svg: SVGSVGElement;
  private readonly edgeGroup = svgElement('g');
  private readonly nodeGroup = svgElement('g');
  private readonly label = svgElement('text');
  private readonly nodes = new Map<string, SearchTelemetryNode>();
  private readonly edges = new Map<string, SearchTelemetryEdge>();
  private stage: SearchTelemetryStage = 'table-build';
  private explored = 0;
  private solutionPath: string[] = [];
  private pendingFrame = 0;

  constructor(container: HTMLElement) {
    this.svg = svgElement('svg');
    this.svg.classList.add('search-graph-svg');
    this.svg.setAttribute('viewBox', '0 0 900 520');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Sampled solver search graph');
    this.label.classList.add('search-graph-annotation');
    this.label.setAttribute('x', '22');
    this.label.setAttribute('y', '498');
    this.label.textContent = 'SELECT N = 2 · EXACT TABLE SAMPLE LOADS ON INITIALIZATION';
    this.svg.append(this.edgeGroup, this.nodeGroup, this.label);
    container.append(this.svg);
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.solutionPath = [];
    this.explored = 0;
    this.scheduleRender();
  }

  applyBatch(batch: SearchTelemetryBatch): void {
    if (batch.stage !== this.stage) {
      this.nodes.clear();
      this.edges.clear();
      this.solutionPath = [];
      this.explored = 0;
    }
    this.stage = batch.stage;
    this.explored = Math.max(this.explored, batch.explored);
    batch.nodes.forEach((node) => this.nodes.set(node.id, node));
    batch.edges.forEach((edge) => this.edges.set(edge.id, edge));
    if (batch.solutionPath) this.solutionPath = [...batch.solutionPath];
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.render();
    });
  }

  private render(): void {
    const nodes = [...this.nodes.values()];
    const edges = [...this.edges.values()];
    // Pocket coordinates are numeric in both the table-build and warm-solve
    // streams, so preserve the promised distance-ring reading. Other future
    // samples can use descriptive IDs and fall back to the force layout.
    const exactPocket = nodes.every((node) => /^\d+$/.test(node.id));
    const points = layoutSearchNodes(nodes, exactPocket ? 'table-build' : this.stage);
    const pointById = new Map(points.map((point) => [point.id, point]));
    const pathEdges = new Set(this.solutionPath.slice(0, -1).map((source, index) => `${source}>${this.solutionPath[index + 1]}`));
    this.edgeGroup.replaceChildren(...edges.map((edge) => this.renderEdge(edge, pointById, pathEdges)));
    this.nodeGroup.replaceChildren(...points.map((point) => this.renderNode(point)));
    const stageLabel = this.stage === 'table-build' ? 'TABLE BUILD · RADIAL DISTANCE SAMPLE' : 'WARM SOLVE · DISTANCE DESCENT';
    this.label.textContent = `${stageLabel} · ${nodes.length.toLocaleString()} NODES / ${this.explored.toLocaleString()} EXPLORED${this.solutionPath.length ? ` · PATH ${this.solutionPath.length - 1}` : ''}`;
  }

  private renderEdge(edge: SearchTelemetryEdge, points: Map<string, SearchGraphPoint>, pathEdges: Set<string>): SVGLineElement {
    const line = svgElement('line');
    const source = points.get(edge.source);
    const target = points.get(edge.target);
    if (!source || !target) return line;
    line.setAttribute('x1', source.x.toFixed(1));
    line.setAttribute('y1', source.y.toFixed(1));
    line.setAttribute('x2', target.x.toFixed(1));
    line.setAttribute('y2', target.y.toFixed(1));
    line.classList.add('search-edge');
    const path = `${edge.source}>${edge.target}`;
    line.classList.toggle('is-solution', Boolean(edge.solution) || pathEdges.has(path));
    line.setAttribute('stroke', MOVE_COLORS[edge.move.axis] ?? MOVE_COLORS[0]!);
    const title = svgElement('title');
    title.textContent = `${moveLabel(edge.move)}${line.classList.contains('is-solution') ? ' · solution path' : ''}`;
    line.append(title);
    return line;
  }

  private renderNode(point: SearchGraphPoint): SVGCircleElement {
    const circle = svgElement('circle');
    circle.classList.add('search-node');
    if (this.solutionPath.includes(point.id)) circle.classList.add('is-solution');
    if (point.distance === 0) circle.classList.add('is-solved');
    circle.setAttribute('cx', point.x.toFixed(1));
    circle.setAttribute('cy', point.y.toFixed(1));
    circle.setAttribute('r', point.distance === 0 ? '8' : this.stage === 'table-build' ? '3.4' : '5');
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'img');
    circle.setAttribute('aria-label', `Search node ${point.id}, distance ${point.distance}${this.solutionPath.includes(point.id) ? ', solution path' : ''}`);
    return circle;
  }
}
