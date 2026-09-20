import '@fontsource/noto-serif-tibetan/300.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import './styles.css';
import { parseNotation, formatMove } from './core/moves';
import { createScramble } from './core/scramble';
import { applyMove, isSolved } from './core/state';
import { Cube3DView } from './view3d/cube3d';
import { RingsView } from './rings/ringsView';
import { TimelineController } from './timeline/controller';
import type { SolverRequest, SolverResponse } from './solvers/worker';
import { SearchGraphView } from './search/graphView';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root is missing');

app.innerHTML = `
  <article class="atlas-shell">
    <header class="instrument-strip" aria-label="Cube controls">
      <h1 class="masthead">CUBE THEORY</h1>
      <label class="size-control">
        <span>N = <output id="size-output">3</output></span>
        <input id="size-input" type="range" min="2" max="9" value="3" step="1" aria-label="Cube size" />
      </label>
      <div class="move-controls" aria-label="Outer face moves">
        <button class="move-button is-primary" data-move="R" type="button" title="Turn right face; hold Shift for inverse">R</button>
        <button class="move-button" data-move="U" type="button" title="Turn upper face; hold Shift for inverse">U</button>
        <button class="move-button" data-move="F" type="button" title="Turn front face; hold Shift for inverse">F</button>
      </div>
    </header>

    <section class="solver-strip" aria-label="Scramble, solve, and playback">
      <div class="solver-actions">
        <button id="scramble" class="atlas-button" type="button">SCRAMBLE 25</button>
        <button id="solve" class="atlas-button is-accent" type="button" disabled>SOLVE 3×3</button>
      </div>
      <p id="solver-status" class="solver-status" role="status" aria-live="polite">BUILDING 3×3 COORDINATES · WORKER ACTIVE</p>
      <div class="playback-controls">
        <button id="play-pause" class="atlas-button playback-button" type="button" disabled>PLAY</button>
        <label class="speed-control">SPEED
          <select id="speed" aria-label="Playback speed">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
          </select>
        </label>
      </div>
    </section>

    <section class="atlas-field" aria-label="Synchronized cube views">
      <nav class="view-tabs" aria-label="Workspace views" role="tablist">
        <button id="atlas-tab" class="view-tab is-active" type="button" data-view="atlas" role="tab" aria-controls="atlas-view" aria-selected="true">ATLAS FIELD</button>
        <button id="search-tab" class="view-tab" type="button" data-view="search" role="tab" aria-controls="search-viewport" aria-selected="false">SEARCH SAMPLE</button>
      </nav>
      <div id="atlas-view" role="tabpanel" aria-labelledby="atlas-tab">
        <h2 class="field-label physical-label">PHYSICAL</h2>
        <div id="cube-viewport" class="cube-viewport"></div>
        <h2 class="field-label permutation-label">PERMUTATION</h2>
        <div id="ring-viewport" class="ring-viewport"></div>
      </div>
      <section id="search-viewport" class="search-viewport" role="tabpanel" aria-labelledby="search-tab" hidden>
        <header class="search-panel-heading">
          <h2>SEARCH SAMPLE</h2>
          <p>Bounded worker telemetry · path edges are marked in red</p>
        </header>
      </section>
      <svg class="active-trace" viewBox="0 0 1000 600" aria-hidden="true">
        <defs>
          <marker id="trace-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <path class="trace-curve" d="M 110 345 C 210 130, 340 95, 450 180" />
        <path class="trace-stem" d="M 110 345 L 110 500" />
        <path class="trace-arrow" d="M 292 119 L 320 108 L 310 136 Z" />
        <circle class="trace-origin-outer" cx="110" cy="345" r="17" />
        <circle class="trace-origin-inner" cx="110" cy="345" r="8" />
        <circle class="trace-stem-node" cx="110" cy="500" r="8" />
        <circle class="trace-destination" cx="450" cy="180" r="10" />
      </svg>
    </section>

    <footer class="timeline" aria-label="Move timeline">
      <button id="step-back" class="transport-button" type="button" aria-label="Step backward" title="Step backward">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M19 6l-9 6 9 6z" /></svg>
      </button>
      <div class="timeline-track" aria-hidden="true">
        <div id="timeline-fill" class="timeline-fill"></div>
        <div id="timeline-marks" class="timeline-marks"></div>
      </div>
      <input id="timeline-scrubber" class="timeline-scrubber" type="range" min="0" max="0" value="0" step="1" aria-label="Timeline position" />
      <button id="step-forward" class="transport-button" type="button" aria-label="Step forward" title="Step forward">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M5 6l9 6-9 6z" /></svg>
      </button>
      <button id="reset" class="reset-button" type="button">RESET</button>
      <p id="status" class="status" role="status" aria-live="polite">READY · KEYBOARD R U F L D B</p>
    </footer>
  </article>
`;

const sizeInput = document.querySelector<HTMLInputElement>('#size-input');
const sizeOutput = document.querySelector<HTMLOutputElement>('#size-output');
const cubeViewport = document.querySelector<HTMLElement>('#cube-viewport');
const ringViewport = document.querySelector<HTMLElement>('#ring-viewport');
const searchViewport = document.querySelector<HTMLElement>('#search-viewport');
const stepBack = document.querySelector<HTMLButtonElement>('#step-back');
const stepForward = document.querySelector<HTMLButtonElement>('#step-forward');
const reset = document.querySelector<HTMLButtonElement>('#reset');
const scramble = document.querySelector<HTMLButtonElement>('#scramble')!;
const solve = document.querySelector<HTMLButtonElement>('#solve')!;
const playPause = document.querySelector<HTMLButtonElement>('#play-pause')!;
const speed = document.querySelector<HTMLSelectElement>('#speed')!;
const scrubber = document.querySelector<HTMLInputElement>('#timeline-scrubber')!;
const status = document.querySelector<HTMLElement>('#status');
const solverStatus = document.querySelector<HTMLElement>('#solver-status')!;
const timelineFill = document.querySelector<HTMLElement>('#timeline-fill');
const timelineMarks = document.querySelector<HTMLElement>('#timeline-marks');
const activeTrace = document.querySelector<SVGElement>('.active-trace');

if (!sizeInput || !sizeOutput || !cubeViewport || !ringViewport || !stepBack
  || !stepForward || !reset || !scramble || !solve || !playPause || !speed || !scrubber
  || !status || !solverStatus || !timelineFill || !timelineMarks || !activeTrace || !searchViewport) {
  throw new Error('Workspace controls are incomplete');
}

const controller = new TimelineController(3);
new Cube3DView(cubeViewport, controller);
new RingsView(ringViewport, controller);
const searchGraph = new SearchGraphView(searchViewport);

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    const search = view === 'search';
    searchViewport.hidden = !search;
    const atlasView = document.querySelector<HTMLElement>('#atlas-view');
    if (atlasView) atlasView.hidden = search;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    activeTrace.toggleAttribute('hidden', search);
  });
});

const solverWorker = new Worker(new URL('./solvers/worker.ts', import.meta.url), { type: 'module' });
let requestId = 0;
const solverReady = new Set<number>();
const solverInitializing = new Set<number>();
let pocketInitializationRequestId: number | null = null;
let activeSolve: { requestId: number; size: number; state: Uint8Array } | null = null;

function sameState(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function initializeSolver(size: 2 | 3): void {
  if (solverReady.has(size) || solverInitializing.has(size)) return;
  solverInitializing.add(size);
  solverStatus.textContent = size === 2 ? 'BUILDING 2×2 EXACT TABLE · MOVE COORDINATES' : 'BUILDING 3×3 TABLES · MOVE COORDINATES';
  const message: SolverRequest = { type: 'init', requestId: ++requestId, size };
  if (size === 2) pocketInitializationRequestId = message.requestId;
  solverWorker.postMessage(message);
}

solverWorker.addEventListener('message', (event: MessageEvent<SolverResponse>) => {
  const message = event.data;
  if (message.type === 'telemetry') {
    const snapshot = controller.getSnapshot();
    const acceptsTableBuild = message.stage === 'table-build'
      && snapshot.size === 2
      && message.requestId === pocketInitializationRequestId;
    const acceptsWarmSolve = message.stage === 'warm-solve'
      && activeSolve?.size === 2
      && activeSolve.requestId === message.requestId
      && sameState(snapshot.state, activeSolve.state)
      && !snapshot.active
      && !snapshot.queued;
    if (!acceptsTableBuild && !acceptsWarmSolve) return;
    searchGraph.applyBatch(message);
    if (message.stage === 'table-build') {
      solverStatus.textContent = `EXPLORING 2×2 DISTANCE TABLE · ${message.nodes.length.toLocaleString()} SAMPLED · ${message.explored.toLocaleString()} VISITED`;
    } else {
      solverStatus.textContent = `WARM 2×2 DISTANCE DESCENT · ${message.solutionPath ? message.solutionPath.length - 1 : 0} MOVES`;
    }
    return;
  }
  if (message.type === 'progress') {
    const percent = Math.round((message.completed / message.total) * 100);
    const label = message.phase === 'coordinates' ? '3×3 MOVE COORDINATES'
      : message.phase === 'phase1' ? '3×3 PHASE I PRUNING'
        : message.phase === 'phase2' ? '3×3 PHASE II PRUNING'
          : message.phase === 'moves' ? '2×2 MOVE COORDINATES' : '2×2 EXACT DISTANCES';
    solverStatus.textContent = `BUILDING ${label} · ${percent}%${message.depth === undefined ? '' : ` · DEPTH ${message.depth}`}`;
    return;
  }
  if (message.type === 'ready') {
    const size = controller.getSnapshot().size;
    const initializedSize = message.size;
    solverInitializing.delete(initializedSize); solverReady.add(initializedSize);
    solverStatus.textContent = size === initializedSize ? `${size === 2 ? 'EXACT' : 'TWO-PHASE'} TABLES READY · ${(message.elapsedMs / 1000).toFixed(1)} S` : `SOLVER READY · SELECT N = ${initializedSize}`;
    solve.disabled = !solverReady.has(size);
    return;
  }
  if (message.type === 'error') {
    if (activeSolve?.requestId !== message.requestId && activeSolve) return;
    activeSolve = null;
    solverStatus.textContent = `SOLVER ERROR · ${message.message.toUpperCase()}`;
    solve.disabled = !solverReady.has(controller.getSnapshot().size);
    return;
  }

  if (!activeSolve || activeSolve.requestId !== message.requestId) return;
  const snapshot = controller.getSnapshot();
  if (snapshot.size !== activeSolve.size || !sameState(snapshot.state, activeSolve.state)
    || snapshot.active || snapshot.queued) {
    activeSolve = null;
    solverStatus.textContent = 'SOLUTION DISCARDED · CUBE CHANGED DURING SEARCH';
    solve.disabled = !solverReady.has(snapshot.size);
    return;
  }
  let verified = activeSolve.state;
  message.moves.forEach((move) => { verified = applyMove(verified, activeSolve!.size, move); });
  if (!isSolved(verified, activeSolve.size)) {
    activeSolve = null;
    solverStatus.textContent = 'SOLVER ERROR · RETURNED PATH FAILED VERIFICATION';
    solve.disabled = false;
    return;
  }
  activeSolve = null;
  controller.insertMoves(message.moves);
  solverStatus.textContent = `${snapshot.size === 2 ? 'OPTIMAL' : 'TWO-PHASE'} SOLUTION · ${message.moves.length} MOVES · ${message.elapsedMs.toFixed(1)} MS`;
  solve.disabled = false;
  controller.play();
});

function appendNotation(notation: string, inverse = false): void {
  const size = controller.getSnapshot().size;
  const token = inverse ? `${notation}'` : notation;
  const move = parseNotation(token, size)[0];
  if (move) controller.append(move);
}

document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => {
  button.addEventListener('click', (event) => {
    appendNotation(button.dataset.move ?? '', (event as MouseEvent).shiftKey);
  });
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, select, textarea, button')) return;
  const face = event.key.toUpperCase();
  if (!'RUFLDB'.includes(face)) return;
  event.preventDefault();
  appendNotation(face, event.shiftKey);
});

sizeInput.addEventListener('input', () => { sizeOutput.value = sizeInput.value; });
sizeInput.addEventListener('change', () => {
  const nextSize = Number(sizeInput.value);
  activeSolve = null;
  controller.reset(nextSize);
  solve.textContent = `SOLVE ${nextSize}×${nextSize}`;
  solve.disabled = !solverReady.has(nextSize);
  solverStatus.textContent = nextSize > 3 ? 'SOLVING IS AVAILABLE FOR N = 2 AND N = 3' : solverReady.has(nextSize) ? `${nextSize === 2 ? 'EXACT' : 'TWO-PHASE'} TABLES READY` : `BUILDING ${nextSize}×${nextSize} TABLES`;
  if (nextSize === 2 || nextSize === 3) initializeSolver(nextSize);
});
stepBack.addEventListener('click', () => controller.stepBack());
stepForward.addEventListener('click', () => controller.stepForward());
reset.addEventListener('click', () => { activeSolve = null; controller.reset(); });
scramble.addEventListener('click', () => {
  activeSolve = null;
  const size = controller.getSnapshot().size;
  controller.reset(size);
  controller.insertMoves(createScramble(size));
  solverStatus.textContent = size <= 3 ? 'SCRAMBLE STAGED · 25 MOVES' : 'SCRAMBLE STAGED · SOLVING REQUIRES N = 2 OR N = 3';
  controller.play();
});
solve.addEventListener('click', () => {
  const snapshot = controller.getSnapshot();
  if ((snapshot.size !== 2 && snapshot.size !== 3) || !solverReady.has(snapshot.size) || snapshot.active || snapshot.queued) return;
  const state = snapshot.state.slice();
  const id = ++requestId;
  activeSolve = { requestId: id, size: snapshot.size, state };
  solve.disabled = true;
  solverStatus.textContent = snapshot.size === 2 ? 'SOLVING · NORMALIZING D-B-L FRAME' : 'SOLVING · PHASE I SUBGROUP SEARCH';
  const message: SolverRequest = { type: 'solve', requestId: id, size: snapshot.size, state };
  solverWorker.postMessage(message);
});
playPause.addEventListener('click', () => {
  if (controller.getSnapshot().playing) controller.pause();
  else controller.play();
});
speed.addEventListener('change', () => controller.setSpeed(Number(speed.value)));
scrubber.addEventListener('input', () => controller.seek(Number(scrubber.value)));

controller.subscribe((snapshot) => {
  const total = snapshot.steps.length;
  const fraction = total === 0 ? 0 : snapshot.index / total;
  timelineFill.style.transform = `scaleX(${fraction})`;
  scrubber.max = String(total);
  scrubber.value = String(snapshot.index);
  timelineMarks.replaceChildren(...snapshot.steps.map((step, index) => {
    const mark = document.createElement('span');
    mark.className = `timeline-mark${index < snapshot.index ? ' is-complete' : ''}`;
    mark.style.left = `${((index + 1) / Math.max(1, total)) * 100}%`;
    mark.title = formatMove(step.move, snapshot.size);
    return mark;
  }));
  stepBack.disabled = Boolean(snapshot.active) || snapshot.index === 0;
  stepForward.disabled = Boolean(snapshot.active) || snapshot.index >= total;
  scrubber.disabled = Boolean(snapshot.active) || snapshot.queued > 0 || total === 0;
  playPause.disabled = (!snapshot.active && snapshot.index >= total) || snapshot.queued > 0;
  playPause.textContent = snapshot.playing ? 'PAUSE' : 'PLAY';
  playPause.setAttribute('aria-label', snapshot.playing ? 'Pause playback' : 'Play timeline');
  sizeInput.disabled = Boolean(snapshot.active) || snapshot.queued > 0;
  scramble.disabled = Boolean(snapshot.active) || snapshot.queued > 0;
  solve.disabled = !solverReady.has(snapshot.size) || Boolean(activeSolve) || Boolean(snapshot.active) || snapshot.queued > 0;
  activeTrace.classList.toggle('is-active', Boolean(snapshot.active));
  status.textContent = snapshot.active
    ? `${snapshot.playing || snapshot.active.direction !== 'forward' ? 'TURNING' : 'PAUSED'} ${formatMove(snapshot.active.move, snapshot.size)} · ${Math.round(snapshot.active.progress * 100)}%`
    : snapshot.queued
      ? `${snapshot.queued} MOVE${snapshot.queued === 1 ? '' : 'S'} QUEUED`
      : total
        ? `${snapshot.index} / ${total} · READY`
        : 'READY · KEYBOARD R U F L D B';
});

initializeSolver(3);
