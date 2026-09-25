// Importing a mailbox from the webapp: the server runs the parsers over a
// file from data/Email and swaps the result in when they succeed.

export type ImportPhase = 'mails' | 'contacts' | 'spam' | 'ai' | 'calendar' | 'finalizing';

export type ImportStatus =
  // No working database yet.
  | { state: 'empty' }
  | {
      state: 'ready';
      userEmail: string;
      /** When the current data was imported (ms), null for a CLI-built database. */
      importedAt: number | null;
      /** File name of the mbox the current data came from, if known. */
      source: string | null;
    }
  | {
      state: 'importing';
      phase: ImportPhase;
      /** Overall progress 0..1, or null when the parser reports none. */
      progress: number | null;
      detail: string;
      startedAt: number;
      /** Whether the previous data is still being served meanwhile. */
      hasData: boolean;
    }
  | {
      state: 'failed';
      error: string;
      /** Last lines the parser wrote to stderr. */
      log: string[];
      failedAt: number;
      hasData: boolean;
    };

export interface MboxFile {
  name: string;
  size: number;
  /** mtime, ms since epoch. */
  modified: number;
  /** The current data was imported from this file (same name, size and mtime). */
  current: boolean;
}

export interface ImportSources {
  /** Absolute path of the folder the mbox files are listed from. */
  mboxDir: string;
  calendarDir: string;
  /** Newest first. */
  mbox: MboxFile[];
  icsCount: number;
  parserAvailable: boolean;
  calendarParserAvailable: boolean;
  /** HF_API_KEY is set, so fill_db will run the AI filter. */
  aiEnabled: boolean;
  defaultEmail: string;
}

export interface StartImportRequest {
  /** A file name from ImportSources.mbox, not a path. */
  mbox: string;
  email: string;
  includeCalendar: boolean;
}
