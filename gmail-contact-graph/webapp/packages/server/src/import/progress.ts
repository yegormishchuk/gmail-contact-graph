import type { ImportPhase } from '@gmail-graph/shared';

/**
 * Where each phase starts on the overall progress bar. The mails phase fills
 * the space up to `contacts` by bytes read; the others take a fixed position
 * since the parsers report no progress within them.
 */
const PHASE_START: Record<ImportPhase, number> = {
  mails: 0,
  contacts: 0.85,
  spam: 0.87,
  ai: 0.88,
  calendar: 0.97,
  finalizing: 0.99,
};

type ParserEvent =
  | { event: 'phase'; phase: string; enabled?: boolean; contacts?: number }
  | { event: 'progress'; phase: string; bytes: number; total_bytes: number; messages: number }
  | { event: 'done' };

/**
 * Turns the parsers' stderr into the phase, overall progress and detail shown
 * by the import screen.
 *
 * The parsers print one JSON object per line with PROGRESS_FORMAT=json. A
 * parser built before that prints only text; then the progress stays null
 * and the detail follows its `[progress] …` lines.
 */
export class ProgressTracker {
  private phase: ImportPhase = 'mails';
  private progress = 0;
  private detail = '';
  private sawJson = false;

  /**
   * Reads one stderr line. Returns true if it was progress output (a JSON
   * event or a text `[progress]` line), which does not belong in the log.
   */
  feed(line: string): boolean {
    const event = parseEvent(line);
    if (!event) {
      const legacy = line.match(/^\[progress\]\s*(.*)$/);
      if (!legacy) return false;
      if (!this.sawJson) this.detail = legacy[1];
      return true;
    }
    this.sawJson = true;

    if (event.event === 'phase' && isPhase(event.phase)) {
      this.setPhase(event.phase);
      if (event.phase === 'ai') {
        const n = (event.contacts ?? 0).toLocaleString('en-US');
        this.detail = event.enabled
          ? `Checking ${n} contacts with AI`
          : `AI filter off: ${n} contacts kept as unclear`;
      }
    } else if (event.event === 'progress' && event.phase === 'mails') {
      const fraction = event.total_bytes > 0 ? Math.min(event.bytes / event.total_bytes, 1) : 0;
      this.progress = fraction * PHASE_START.contacts;
      this.detail = `${event.messages.toLocaleString('en-US')} messages`;
    }
    return true;
  }

  setPhase(phase: ImportPhase): void {
    this.phase = phase;
    this.progress = PHASE_START[phase];
    this.detail = '';
  }

  snapshot(): { phase: ImportPhase; progress: number | null; detail: string } {
    return {
      phase: this.phase,
      progress: this.sawJson ? this.progress : null,
      detail: this.detail,
    };
  }
}

function parseEvent(line: string): ParserEvent | null {
  if (!line.startsWith('{')) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value.event === 'string' ? (value as ParserEvent) : null;
  } catch {
    return null;
  }
}

function isPhase(value: string): value is ImportPhase {
  return Object.prototype.hasOwnProperty.call(PHASE_START, value);
}
