import { generateStickers, layerCoordinate, type Axis } from '../core/geometry';
import { buildMovePermutation } from '../core/moves';
import type { TimelineController, TimelineSnapshot } from '../timeline/controller';
import { createRingLayout, type Point, type RingLayout } from './layout';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#f6f2df', '#cb2d2a', '#2f9b62', '#f4d33f', '#e77728', '#1268bf'];
const COLOR_NAMES = ['white', 'red', 'green', 'yellow', 'orange', 'blue'];

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function ease(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

export class RingsView {
  private readonly svg: SVGSVGElement;
  private readonly ringsGroup = svgElement('g');
  private readonly stickersGroup = svgElement('g');
  private readonly annotation = svgElement('text');
  private layout: RingLayout | null = null;
  private size = 0;
  private dots: SVGCircleElement[] = [];
  private ringElements = new Map<string, SVGCircleElement>();

  constructor(container: HTMLElement, controller: TimelineController) {
    this.svg = svgElement('svg');
    this.svg.classList.add('rings-svg');
    this.svg.setAttribute('viewBox', '0 0 900 620');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Sticker-ring permutation graph');
    this.annotation.classList.add('axis-annotation');
    this.annotation.setAttribute('x', '28');
    this.annotation.setAttribute('y', '592');
    this.annotation.textContent = 'CLICK A RING · SHIFT FOR INVERSE';
    this.svg.append(this.ringsGroup, this.stickersGroup, this.annotation);
    container.append(this.svg);

    controller.subscribe((snapshot) => this.render(snapshot, controller));
  }

  private rebuild(size: number, controller: TimelineController): void {
    this.size = size;
    this.layout = createRingLayout(size);
    this.ringsGroup.replaceChildren();
    this.stickersGroup.replaceChildren();
    this.ringElements.clear();

    this.layout.centers.forEach((center, axis) => {
      this.layout?.radii[axis]?.forEach((radius, layer) => {
        const visible = svgElement('circle');
        visible.setAttribute('cx', String(center.x));
        visible.setAttribute('cy', String(center.y));
        visible.setAttribute('r', String(radius));
        visible.classList.add('ring-line', `ring-family-${axis}`);
        this.ringsGroup.append(visible);
        this.ringElements.set(`${axis}:${layer}`, visible);

        const hit = svgElement('circle');
        hit.setAttribute('cx', String(center.x));
        hit.setAttribute('cy', String(center.y));
        hit.setAttribute('r', String(radius));
        hit.classList.add('ring-hit');
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('role', 'button');
        hit.setAttribute('aria-label', `Turn axis ${'XYZ'[axis]} layer ${layer + 1}`);
        const turn = (inverse: boolean) => controller.append({
          axis: axis as Axis,
          layer,
          turns: inverse ? 3 : 1,
        });
        hit.addEventListener('click', (event) => turn((event as MouseEvent).shiftKey));
        hit.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            turn(event.shiftKey);
          }
        });
        this.ringsGroup.append(hit);
      });
    });

    const stickers = generateStickers(size);
    this.dots = stickers.map((sticker) => {
      const dot = svgElement('circle');
      dot.classList.add('sticker-dot');
      dot.setAttribute('r', String(Math.max(4.2, 7.8 - size * 0.38)));
      dot.setAttribute('aria-label', `${sticker.face} row ${sticker.row + 1}, column ${sticker.col + 1}`);
      this.stickersGroup.append(dot);
      return dot;
    });
  }

  private render(snapshot: TimelineSnapshot, controller: TimelineController): void {
    if (snapshot.size !== this.size || !this.layout) this.rebuild(snapshot.size, controller);
    const layout = this.layout;
    if (!layout) return;

    this.ringElements.forEach((ring) => ring.classList.remove('is-active'));
    const stickers = generateStickers(snapshot.size);
    const active = snapshot.active;
    let destinationOfSource: Uint16Array | null = null;
    let progress = 0;

    if (active) {
      this.ringElements.get(`${active.move.axis}:${active.move.layer}`)?.classList.add('is-active');
      const permutation = buildMovePermutation(snapshot.size, active.move);
      destinationOfSource = new Uint16Array(permutation.length);
      permutation.forEach((source, destination) => { destinationOfSource![source] = destination; });
      progress = ease(active.progress);
    }

    this.dots.forEach((dot, source) => {
      const sticker = stickers[source];
      const start = layout.points[source];
      if (!sticker || !start) return;
      let point = start;
      let colorIndex = snapshot.state[source] ?? 0;

      if (active && destinationOfSource) {
        colorIndex = active.before[source] ?? 0;
        const destination = destinationOfSource[source] ?? source;
        const end = layout.points[destination] ?? start;
        if (destination !== source) {
          const coordinate = layerCoordinate(snapshot.size, active.move.layer);
          const ringSticker = sticker.pos[active.move.axis] === coordinate
            && sticker.normal[active.move.axis] === 0;
          point = ringSticker
            ? this.interpolateOnRing(start, end, active.move.axis, active.move.turns, progress, layout)
            : { x: lerp(start.x, end.x, progress), y: lerp(start.y, end.y, progress) };
        }
      }

      dot.setAttribute('cx', point.x.toFixed(2));
      dot.setAttribute('cy', point.y.toFixed(2));
      dot.setAttribute('fill', COLORS[colorIndex] ?? '#f6f2df');
      dot.setAttribute('data-color', COLOR_NAMES[colorIndex] ?? 'unknown');
    });
  }

  private interpolateOnRing(
    start: Point,
    end: Point,
    axis: Axis,
    turns: 1 | 2 | 3,
    progress: number,
    layout: RingLayout,
  ): Point {
    const center = layout.centers[axis];
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let delta = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
    if (turns === 1) while (delta < 0) delta += Math.PI * 2;
    if (turns === 3) while (delta > 0) delta -= Math.PI * 2;
    if (turns === 2) {
      while (delta < 0) delta += Math.PI * 2;
      if (delta < Math.PI * 0.75) delta += Math.PI * 2;
    }
    const angle = startAngle + delta * progress;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  }
}
