import React, { useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ImportProgress } from '../ImportProgress';
import { ImportScreen } from '../ImportScreen';

/** "Re-import" over the graph: the progress while an import runs, else the form. */
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

  if (!open) return null;

  const status = state.importStatus;
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
        {status?.state === 'importing' ? <ImportProgress status={status} /> : <ImportScreen inDialog />}
      </div>
    </div>
  );
}

export default ImportDialog;
