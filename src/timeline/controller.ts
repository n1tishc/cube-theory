import type { Move } from '../core/moves';
import { invertMove } from '../core/moves';
import { applyMove, solvedState } from '../core/state';

export interface Step { move: Move; before: Uint8Array; after: Uint8Array }

export const MAX_TIMELINE_MOVES = 20_000;

export async function prepareTimelineSteps(
  initial: Uint8Array,
  size: number,
  moves: readonly Move[],
  yieldToMain: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  chunkSize = 128,
): Promise<Step[]> {
  if (moves.length > MAX_TIMELINE_MOVES) throw new Error(`Solution exceeds the ${MAX_TIMELINE_MOVES.toLocaleString()} move resource limit`);
  const steps: Step[] = [];
  let state = initial;
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index]!;
    if (move.layer < 0 || move.layer >= size) throw new Error('Move is outside this cube');
    const after = applyMove(state, size, move);
    steps.push({ move, before: state, after });
    state = after;
    if ((index + 1) % chunkSize === 0) await yieldToMain();
  }
  return steps;
}

export interface ActiveTransition extends Step {
  progress: number;
  direction: 'append' | 'forward' | 'back';
}

export interface TimelineSnapshot {
  size: number;
  state: Uint8Array;
  steps: readonly Step[];
  index: number;
  queued: number;
  active: ActiveTransition | null;
  playing: boolean;
  speed: number;
}

type Listener = (snapshot: TimelineSnapshot) => void;

export class TimelineController {
  private size: number;
  private state: Uint8Array;
  private steps: Step[] = [];
  private index = 0;
  private queue: Move[] = [];
  private active: ActiveTransition | null = null;
  private activeCommit: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private animationFrame = 0;
  private animationStartedAt = 0;
  private readonly baseDuration: number;
  private playing = false;
  private speed = 1;

  constructor(size = 3, duration = 250) {
    this.size = size;
    this.state = solvedState(size);
    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.baseDuration = reduceMotion ? 1 : duration;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): TimelineSnapshot { return this.snapshot(); }

  append(move: Move): void {
    if (move.layer < 0 || move.layer >= this.size) return;
    this.playing = false;
    this.queue.push(move);
    this.emit();
    this.startNextAppend();
  }

  insertMoves(moves: readonly Move[]): void {
    if (this.active || this.queue.length) throw new Error('Wait for the current move to finish');
    this.playing = false;
    if (this.index < this.steps.length) this.steps.splice(this.index);
    let state = this.state;
    for (const move of moves) {
      if (move.layer < 0 || move.layer >= this.size) throw new Error('Move is outside this cube');
      const after = applyMove(state, this.size, move);
      this.steps.push({ move, before: state, after });
      state = after;
    }
    this.emit();
  }

  insertPreparedSteps(steps: readonly Step[], expectedState: Uint8Array): boolean {
    if (this.active || this.queue.length || this.state.length !== expectedState.length
      || !this.state.every((value, index) => value === expectedState[index])) return false;
    this.playing = false;
    if (this.index < this.steps.length) this.steps.splice(this.index);
    this.steps.push(...steps);
    this.emit();
    return true;
  }

  play(): void {
    if (this.queue.length || this.index >= this.steps.length) return;
    this.playing = true;
    if (this.active) {
      if (this.active.direction === 'forward') this.resumeActive();
      return;
    }
    this.startForward();
  }

  pause(): void {
    this.playing = false;
    if (this.active?.direction === 'forward') cancelAnimationFrame(this.animationFrame);
    this.emit();
  }

  setSpeed(speed: number): void {
    if (![0.5, 1, 2].includes(speed)) throw new Error('Playback speed must be 0.5×, 1×, or 2×');
    this.speed = speed;
    if (this.active && this.playing) this.resumeActive();
    this.emit();
  }

  seek(index: number): void {
    if (this.active || this.queue.length) return;
    const target = Math.max(0, Math.min(this.steps.length, Math.round(index)));
    this.playing = false;
    this.index = target;
    this.state = target === 0
      ? (this.steps[0]?.before ?? solvedState(this.size))
      : (this.steps[target - 1]?.after ?? solvedState(this.size));
    this.emit();
  }

  stepBack(): void {
    if (this.active || this.queue.length || this.index === 0) return;
    this.playing = false;
    const step = this.steps[this.index - 1];
    if (!step) return;
    this.animate({ move: invertMove(step.move), before: this.state, after: step.before, progress: 0, direction: 'back' }, () => { this.index -= 1; });
  }

  stepForward(): void {
    if (this.active || this.queue.length || this.index >= this.steps.length) return;
    this.playing = false;
    this.startForward();
  }

  reset(size = this.size): void {
    cancelAnimationFrame(this.animationFrame);
    this.size = size;
    this.state = solvedState(size);
    this.steps = [];
    this.index = 0;
    this.queue = [];
    this.active = null;
    this.activeCommit = null;
    this.playing = false;
    this.emit();
  }

  private startForward(): void {
    const step = this.steps[this.index];
    if (!step) { this.playing = false; this.emit(); return; }
    this.animate({ ...step, progress: 0, direction: 'forward' }, () => { this.index += 1; });
  }

  private startNextAppend(): void {
    if (this.active) return;
    const move = this.queue.shift();
    if (!move) return;
    if (this.index < this.steps.length) this.steps.splice(this.index);
    const step: Step = { move, before: this.state, after: applyMove(this.state, this.size, move) };
    this.animate({ ...step, progress: 0, direction: 'append' }, () => { this.steps.push(step); this.index += 1; });
  }

  private animate(transition: ActiveTransition, commit: () => void): void {
    this.active = transition;
    this.activeCommit = commit;
    this.animationStartedAt = performance.now();
    this.runActive();
  }

  private resumeActive(): void {
    if (!this.active) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationStartedAt = performance.now() - this.active.progress * this.duration;
    this.runActive();
  }

  private runActive(): void {
    const transition = this.active;
    if (!transition) return;
    const frame = (now: number) => {
      if (this.active !== transition) return;
      transition.progress = Math.min(1, (now - this.animationStartedAt) / this.duration);
      this.emit();
      if (transition.progress < 1) {
        if (transition.direction !== 'forward' || this.playing) this.animationFrame = requestAnimationFrame(frame);
        return;
      }
      this.state = transition.after;
      this.activeCommit?.();
      this.active = null;
      this.activeCommit = null;
      this.emit();
      if (transition.direction === 'append') this.startNextAppend();
      else if (transition.direction === 'forward' && this.playing) this.startForward();
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private get duration(): number { return this.baseDuration / this.speed; }

  private snapshot(): TimelineSnapshot {
    return { size: this.size, state: this.state, steps: this.steps, index: this.index, queued: this.queue.length, active: this.active, playing: this.playing, speed: this.speed };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
