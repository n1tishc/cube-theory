import type { SolverRequest, SolverResponse } from './protocol';

export const COLD_WATCHDOG_MS = 120_000;
export const WARM_WATCHDOG_MS = 60_000;

export interface WorkerPort {
  postMessage(message: SolverRequest): void;
  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (event: WorkerEventMap[K]) => void): void;
  terminate(): void;
}

export interface WorkerEventMap {
  message: MessageEvent<SolverResponse>;
  error: ErrorEvent;
  messageerror: MessageEvent<unknown>;
}

export type SolverClientEvent =
  | { type: 'message'; generation: number; message: SolverResponse }
  | { type: 'cancelled'; generation: number; reason: string }
  | { type: 'timeout'; generation: number; requestId: number; operation: 'init' | 'solve' }
  | { type: 'failed'; generation: number; operation: 'init' | 'solve' | null; message: string };

interface PendingRequest { operation: 'init' | 'solve'; timer: ReturnType<typeof setTimeout> }

export class SolverWorkerClient {
  private worker!: WorkerPort;
  private generation = 0;
  private nextRequestId = 0;
  private pending = new Map<number, PendingRequest>();
  private ready = new Set<2 | 3 | 4>();
  private lastProgressAt = -Infinity;

  constructor(
    private readonly createWorker: () => WorkerPort,
    private readonly receive: (event: SolverClientEvent) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: typeof setTimeout = globalThis.setTimeout.bind(globalThis),
    private readonly unschedule: typeof clearTimeout = globalThis.clearTimeout.bind(globalThis),
  ) { this.replaceWorker(); }

  get currentGeneration(): number { return this.generation; }
  isReady(size: number): boolean { return (size === 2 || size === 3 || size === 4) && this.ready.has(size); }

  initialize(size: 2 | 3 | 4): number {
    const requestId = ++this.nextRequestId;
    this.lastProgressAt = -Infinity;
    this.watch(requestId, 'init', COLD_WATCHDOG_MS);
    this.worker.postMessage({ type: 'init', requestId, size });
    return requestId;
  }

  solve(size: 2 | 3 | 4, state: Uint8Array, qaDelayMs = 0): number {
    if (!this.ready.has(size)) throw new Error(`The ${size}×${size} solver is not initialized`);
    const requestId = ++this.nextRequestId;
    this.lastProgressAt = -Infinity;
    this.watch(requestId, 'solve', WARM_WATCHDOG_MS);
    this.worker.postMessage({ type: 'solve', requestId, size, state, ...(qaDelayMs > 0 ? { qaDelayMs } : {}) });
    return requestId;
  }

  cancel(reason: string): void {
    const cancelledGeneration = this.generation;
    this.worker.terminate();
    this.clearPending();
    this.ready.clear();
    this.replaceWorker();
    this.receive({ type: 'cancelled', generation: cancelledGeneration, reason });
  }

  dispose(): void { this.worker.terminate(); this.clearPending(); }

  private replaceWorker(): void {
    const worker = this.createWorker();
    const generation = ++this.generation;
    worker.addEventListener('message', (event) => {
      if (generation !== this.generation || worker !== this.worker) return;
      this.handle(generation, event.data);
    });
    worker.addEventListener('error', (event) => {
      this.fail(worker, generation, event.message || 'Solver worker stopped unexpectedly');
    });
    worker.addEventListener('messageerror', () => {
      this.fail(worker, generation, 'Solver worker returned an unreadable message');
    });
    this.worker = worker;
  }

  private fail(worker: WorkerPort, generation: number, message: string): void {
    if (generation !== this.generation || worker !== this.worker) return;
    const operation = this.pending.values().next().value?.operation ?? null;
    worker.terminate();
    this.clearPending();
    this.ready.clear();
    this.replaceWorker();
    this.receive({ type: 'failed', generation, operation, message });
  }

  private handle(generation: number, message: SolverResponse): void {
    if (!this.pending.has(message.requestId)) return;
    if (message.type === 'progress') {
      const now = this.now();
      if (now - this.lastProgressAt < 100 && message.completed < message.total) return;
      this.lastProgressAt = now;
    }
    if (message.type === 'ready') {
      this.ready.add(message.size);
      const pending = this.pending.get(message.requestId);
      if (pending?.operation === 'init') this.finish(message.requestId);
    } else if (message.type === 'solution' || message.type === 'error') {
      this.finish(message.requestId);
    }
    this.receive({ type: 'message', generation, message });
  }

  private watch(requestId: number, operation: 'init' | 'solve', delay: number): void {
    const generation = this.generation;
    const timer = this.schedule(() => {
      if (generation !== this.generation || !this.pending.has(requestId)) return;
      this.receive({ type: 'timeout', generation, requestId, operation });
      this.cancel(`${operation} watchdog expired`);
    }, delay);
    this.pending.set(requestId, { operation, timer });
  }

  private finish(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.unschedule(pending.timer);
    this.pending.delete(requestId);
  }

  private clearPending(): void {
    this.pending.forEach(({ timer }) => this.unschedule(timer));
    this.pending.clear();
  }
}
