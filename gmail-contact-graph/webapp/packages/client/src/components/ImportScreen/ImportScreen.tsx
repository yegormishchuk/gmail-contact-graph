import React, { useCallback, useEffect, useState } from 'react';
import type { ImportSources } from '@gmail-graph/shared';
import { api } from '../../api/client';
import { useAppContext } from '../../context/AppContext';
import { formatBytes, formatDate } from '../../utils/importFormat';

interface ImportScreenProps {
  /** Shown in a dialog over the graph (with a Close button) or as the whole page. */
  inDialog?: boolean;
}

/**
 * Picks an mbox from data/Email and starts an import. Also shows why the last
 * import failed, when it did.
 */
export function ImportScreen({ inDialog = false }: ImportScreenProps) {
  const { state, dispatch } = useAppContext();
  const [sources, setSources] = useState<ImportSources | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mbox, setMbox] = useState('');
  const [email, setEmail] = useState('');
  const [includeCalendar, setIncludeCalendar] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getImportSources();
      setSources(s);
      setLoadError(null);
      // Keep the user's choices across a refresh; fill in what is still empty.
      setMbox((prev) => (s.mbox.some((f) => f.name === prev) ? prev : s.mbox[0]?.name ?? ''));
      setEmail((prev) => prev || s.defaultEmail);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to list the files');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The calendar box starts ticked whenever there is a calendar to import.
  const calendarPossible = !!sources && sources.icsCount > 0 && sources.calendarParserAvailable;
  useEffect(() => {
    setIncludeCalendar(calendarPossible);
  }, [calendarPossible]);

  const failure = state.importStatus?.state === 'failed' ? state.importStatus : null;
  const emailValid = email.trim().includes('@');
  const canStart = !!sources?.parserAvailable && !!mbox && emailValid && !starting;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const status = await api.startImport({ mbox, email: email.trim(), includeCalendar });
      dispatch({ type: 'SET_IMPORT_STATUS', payload: status });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start the import');
      load();
    } finally {
      setStarting(false);
    }
  };

  return (
    <form className={`import-screen ${inDialog ? 'in-dialog' : ''}`} onSubmit={start}>
      <div className="import-title">{inDialog ? 'Import again' : 'Import your mailbox'}</div>

      {failure && failure.error !== 'cancelled' && (
        <div className="import-error">
          <div>The last import failed: {failure.error}</div>
          {failure.log.length > 0 && (
            <details>
              <summary>Parser output</summary>
              <pre>{failure.log.join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      {loadError && <div className="import-error">{loadError}</div>}
      {!sources && !loadError && <div className="import-hint">Looking for mailbox files…</div>}

      {sources && !sources.parserAvailable && (
        <div className="import-error">
          <div>The mailbox parser is not built. Build it, then refresh:</div>
          <pre>cd gmail-mbox-parser && make build-parser</pre>
        </div>
      )}

      {sources && (
        <>
          <div className="import-section">
            <div className="import-label">
              <span>Mailbox file</span>
              <button type="button" className="import-link" onClick={load}>Refresh list</button>
            </div>
            <div className="import-hint">
              Put a Gmail <code>.mbox</code> export (Google Takeout, unzipped) in <code>{sources.mboxDir}</code>
            </div>
            {sources.mbox.length === 0 ? (
              <div className="import-empty">No .mbox files there yet.</div>
            ) : (
              <div className="import-files" role="radiogroup">
                {sources.mbox.map((f) => (
                  <label key={f.name} className={`import-file ${mbox === f.name ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="mbox"
                      value={f.name}
                      checked={mbox === f.name}
                      onChange={() => setMbox(f.name)}
                    />
                    <span className="import-file-name" title={f.name}>{f.name}</span>
                    {f.current && <span className="import-file-current">current</span>}
                    <span className="import-file-meta">{formatBytes(f.size)} · {formatDate(f.modified)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="import-section">
            <span className="import-label">Your Gmail address</span>
            <input
              className="import-input"
              type="email"
              value={email}
              placeholder="you@gmail.com"
              onChange={(e) => setEmail(e.target.value)}
            />
            <span className="import-hint">The address this mailbox belongs to: it is the centre of the graph.</span>
          </label>

          <label className={`import-check ${calendarPossible ? '' : 'disabled'}`}>
            <input
              type="checkbox"
              checked={includeCalendar}
              disabled={!calendarPossible}
              onChange={(e) => setIncludeCalendar(e.target.checked)}
            />
            <span>
              Calendar ({sources.icsCount} .ics {sources.icsCount === 1 ? 'file' : 'files'} in <code>{sources.calendarDir}</code>)
              {sources.icsCount > 0 && !sources.calendarParserAvailable && ' — calendar parser not built'}
            </span>
          </label>

          <div className="import-hint">
            AI spam filter: {sources.aiEnabled ? 'on' : 'off (set HF_API_KEY in .env to enable it)'}
          </div>
        </>
      )}

      {startError && <div className="import-error">{startError}</div>}

      <div className="import-buttons">
        {inDialog && (
          <button type="button" className="import-btn secondary" onClick={() => dispatch({ type: 'CLOSE_IMPORT' })}>
            Close
          </button>
        )}
        <button type="submit" className="import-btn primary" disabled={!canStart}>
          {starting ? 'Starting…' : 'Import'}
        </button>
      </div>
    </form>
  );
}

export default ImportScreen;
