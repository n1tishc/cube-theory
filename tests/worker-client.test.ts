import { describe, expect, it, vi } from 'vitest';
import type { SolverRequest, SolverResponse } from '../src/solvers/protocol';
import { SolverWorkerClient, type SolverClientEvent, type WorkerEventMap, type WorkerPort } from '../src/solvers/workerClient';

class FakeWorker implements WorkerPort {
  messages: SolverRequest[] = [];
  terminated = false;
  private messageListener: ((event: MessageEvent<SolverResponse>) => void) | null = null;
  private errorListener: ((event: ErrorEvent) => void) | null = null;
  private messageErrorListener: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage(message: SolverRequest): void { this.messages.push(message); }
  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (event: WorkerEventMap[K]) => void): void {
    if (type === 'message') this.messageListener = listener as (event: MessageEvent<SolverResponse>) => void;
    else if (type === 'error') this.errorListener = listener as (event: ErrorEvent) => void;
    else this.messageErrorListener = listener as (event: MessageEvent<unknown>) => void;
  }
  terminate(): void { this.terminated = true; }
  emit(message: SolverResponse): void { this.messageListener?.({ data: message } as MessageEvent<SolverResponse>); }
  emitError(message = 'worker exploded'): void { this.errorListener?.({ message } as ErrorEvent); }
  emitMessageError(): void { this.messageErrorListener?.({} as MessageEvent<unknown>); }
}

describe('solver worker lifecycle', () => {
  it('terminates cancellation immediately and ignores events from stale generations', () => {
    const workers: FakeWorker[] = [];
    const events: SolverClientEvent[] = [];
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, (event) => events.push(event));
    const requestId = client.initialize(3);
    const first = workers[0]!;
    client.cancel('size changed');
    expect(first.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    first.emit({ type: 'ready', requestId, size: 3, elapsedMs: 10 });
    expect(client.isReady(3)).toBe(false);
    expect(events.filter((event) => event.type === 'message')).toHaveLength(0);
  });

  it('invalidates readiness when a running generation is replaced', () => {
    const workers: FakeWorker[] = [];
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, () => {});
    const requestId = client.initialize(2);
    workers[0]!.emit({ type: 'ready', requestId, size: 2, elapsedMs: 1 });
    expect(client.isReady(2)).toBe(true);
    client.cancel('reset');
    expect(client.isReady(2)).toBe(false);
    expect(() => client.solve(2, new Uint8Array())).toThrow(/not initialized/);
  });

  it('tracks 4×4 reduction readiness independently', () => {
    const workers: FakeWorker[] = [];
    const client = new SolverWorkerClient(
      () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
      () => {},
    );
    const requestId = client.initialize(4);
    workers[0]!.emit({ type: 'ready', requestId, size: 4, elapsedMs: 1 });
    expect(client.isReady(4)).toBe(true);
    expect(() => client.solve(4, new Uint8Array(96), 1_500)).not.toThrow();
    expect(workers[0]!.messages.at(-1)).toMatchObject({ type: 'solve', size: 4, qaDelayMs: 1_500 });
    client.dispose();
  });

  it('fires a watchdog and recreates the worker', () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const events: SolverClientEvent[] = [];
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, (event) => events.push(event));
    client.initialize(3);
    vi.advanceTimersByTime(120_000);
    expect(events.some((event) => event.type === 'timeout')).toBe(true);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    client.dispose();
    vi.useRealTimers();
  });

  it('surfaces worker crashes, clears readiness, and recreates the worker', () => {
    const workers: FakeWorker[] = [];
    const events: SolverClientEvent[] = [];
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, (event) => events.push(event));
    const requestId = client.initialize(4);
    workers[0]!.emit({ type: 'ready', requestId, size: 4, elapsedMs: 1 });
    client.solve(4, new Uint8Array(96));
    workers[0]!.emitError('module load failed');

    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(client.isReady(4)).toBe(false);
    expect(events.at(-1)).toEqual({
      type: 'failed', generation: 1, operation: 'solve', message: 'module load failed',
    });
    client.dispose();
  });

  it('treats unreadable worker messages as recoverable failures', () => {
    const workers: FakeWorker[] = [];
    const events: SolverClientEvent[] = [];
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, (event) => events.push(event));
    client.initialize(3);
    workers[0]!.emitMessageError();

    expect(events.at(-1)).toMatchObject({ type: 'failed', operation: 'init' });
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it('throttles nonterminal progress to ten updates per second', () => {
    const workers: FakeWorker[] = [];
    const events: SolverClientEvent[] = [];
    let now = 0;
    const client = new SolverWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, (event) => events.push(event), () => now);
    const requestId = client.initialize(3);
    workers[0]!.emit({ type: 'progress', requestId, phase: 'coordinates', completed: 1, total: 10 });
    now = 50;
    workers[0]!.emit({ type: 'progress', requestId, phase: 'coordinates', completed: 2, total: 10 });
    now = 100;
    workers[0]!.emit({ type: 'progress', requestId, phase: 'coordinates', completed: 3, total: 10 });
    expect(events.filter((event) => event.type === 'message')).toHaveLength(2);
    client.dispose();
  });
});
