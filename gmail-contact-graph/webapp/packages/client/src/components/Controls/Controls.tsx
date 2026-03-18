import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';

export function Controls() {
  const { state, dispatch } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');

  const handleFilterChange = (filterType: 'moreReceived' | 'moreSent' | 'messageGroups' | 'organizations' | null) => {
    dispatch({ type: 'SET_FILTER_TYPE', payload: filterType });
  };

  const handleLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_FILTER_LIMIT', payload: parseInt(e.target.value, 10) });
  };

  const handleClearFilters = () => {
    dispatch({ type: 'SET_FILTER_TYPE', payload: null });
    setSearchQuery('');
    dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
  };

  const handleResetZoom = () => {
    // Call the resetZoom function exposed by Graph component
    (window as any).resetGraphZoom?.();
  };

  const maxContacts = state.rawData?.stats.totalContacts || 500;

  return (
    <div className="controls">
      <div className="controls-title">Filters</div>

      <div className="search-group">
        <input
          type="text"
          id="contact-search"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            dispatch({ type: 'SET_SEARCH_QUERY', payload: e.target.value });
          }}
          autoComplete="off"
        />
      </div>

      <div className="filter-group">
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="moreReceived"
            checked={state.filters.filterType === 'moreReceived'}
            onChange={() => handleFilterChange('moreReceived')}
          />
          <span className="filter-label received">More received</span>
        </label>
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="moreSent"
            checked={state.filters.filterType === 'moreSent'}
            onChange={() => handleFilterChange('moreSent')}
          />
          <span className="filter-label sent">More sent</span>
        </label>
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="messageGroups"
            checked={state.filters.filterType === 'messageGroups'}
            onChange={() => handleFilterChange('messageGroups')}
          />
          <span className="filter-label">Message Groups</span>
        </label>
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="organizations"
            checked={state.filters.filterType === 'organizations'}
            onChange={() => handleFilterChange('organizations')}
          />
          <span className="filter-label">Organizations</span>
        </label>
      </div>

      <button className="control-btn clear-btn" onClick={handleClearFilters}>
        Clear filters
      </button>

      <div className="slider-group">
        <div className="slider-label">
          <span>Contact limit:</span>
          <span className="slider-value">{state.filters.limit}</span>
        </div>
        <input
          type="range"
          id="contact-limit"
          min="10"
          max={maxContacts}
          value={state.filters.limit}
          step="10"
          onChange={handleLimitChange}
        />
      </div>

      <button className="control-btn" onClick={handleResetZoom}>
        Reset zoom
      </button>
    </div>
  );
}

export default Controls;
