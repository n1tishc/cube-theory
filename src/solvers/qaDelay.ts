const MAX_QA_SOLVE_DELAY_MS = 5_000;

export function normalizeQaSolveDelay(value: unknown, enabled: boolean): number {
  if (!enabled) return 0;
  const delay = Number(value);
  if (!Number.isFinite(delay) || delay <= 0) return 0;
  return Math.min(MAX_QA_SOLVE_DELAY_MS, Math.floor(delay));
}

export function parseQaSolveDelay(search: string, enabled: boolean): number {
  const raw = new URLSearchParams(search).get('qaSolveDelayMs');
  if (raw === null || raw.trim() === '') return 0;
  return normalizeQaSolveDelay(raw, enabled);
}
