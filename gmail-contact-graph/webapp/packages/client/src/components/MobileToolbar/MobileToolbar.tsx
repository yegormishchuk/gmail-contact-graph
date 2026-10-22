import React from 'react';
import { useAppContext, type MobilePanel } from '../../context/AppContext';

const PANELS: { id: MobilePanel; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'controls', label: 'Filters' },
  { id: 'legend', label: 'Legend' },
];

/** On a phone, the panels start hidden and these buttons open one at a time. */
export function MobileToolbar() {
  const { state, dispatch } = useAppContext();

  return (
    <div className="mobile-toolbar">
      {PANELS.map(({ id, label }) => {
        const open = state.mobilePanel === id;
        return (
          <button
            key={id}
            className={`header-tab ${open ? 'active' : ''}`}
            aria-pressed={open}
            onClick={() => dispatch({ type: 'SET_MOBILE_PANEL', payload: open ? null : id })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default MobileToolbar;
