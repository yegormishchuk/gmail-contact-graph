import type { ImportPhase } from '@gmail-graph/shared';

const PHASE_LABELS: Record<ImportPhase, string> = {
  mails: 'Reading emails',
  contacts: 'Building contacts',
  spam: 'Filtering spam',
  ai: 'AI check',
  calendar: 'Reading calendar',
  finalizing: 'Finishing up',
};

export function phaseLabel(phase: ImportPhase): string {
  return PHASE_LABELS[phase];
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function progressPercent(progress: number | null): number | null {
  return progress === null ? null : Math.floor(progress * 100);
}
