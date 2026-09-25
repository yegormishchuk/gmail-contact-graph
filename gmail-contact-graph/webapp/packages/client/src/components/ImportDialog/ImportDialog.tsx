import React from 'react';
import { useAppContext } from '../../context/AppContext';
import { ImportProgress } from '../ImportProgress';
import { ImportScreen } from '../ImportScreen';

/** "Re-import" over the graph: the progress while an import runs, else the form. */
export function ImportDialog() {
  const { state, dispatch } = useAppContext();
  if (!state.importDialogOpen) return null;

  const status = state.importStatus;
  const close = () => dispatch({ type: 'CLOSE_IMPORT' });

  return (
    <div className="confirm-modal" onClick={close}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        {status?.state === 'importing' ? <ImportProgress status={status} /> : <ImportScreen inDialog />}
      </div>
    </div>
  );
}

export default ImportDialog;
