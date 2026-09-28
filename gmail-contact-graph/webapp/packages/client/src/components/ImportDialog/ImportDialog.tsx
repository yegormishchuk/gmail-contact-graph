import React, { useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ImportScreen } from '../ImportScreen';

/** "Re-import" over the graph: the form (a running import shows on the overlay). */
export function ImportDialog() {
  const { state, dispatch } = useAppContext();
  const open = state.importDialogOpen;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'CLOSE_IMPORT' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  // A running import shows on the overlay (or the banner when hidden).
  if (!open || state.importStatus?.state === 'importing') return null;

  const close = () => dispatch({ type: 'CLOSE_IMPORT' });

  return (
    <div className="confirm-modal" onClick={close}>
      <div
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <ImportScreen inDialog />
      </div>
    </div>
  );
}

export default ImportDialog;
