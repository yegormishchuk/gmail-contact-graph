import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import type { GraphData, DomainGroups, MessageGroups, CalendarGraphData, EventGroups } from '@gmail-graph/shared';

const MIN_GROUP_SIZE = 3;
const DEFAULT_CONTACT_LIMIT = 50;

function countQualifyingGroups(
  filterType: 'messageGroups' | 'organizations' | 'eventGroups',
  rawData: GraphData | null,
  messageGroups: MessageGroups | null,
  domains: DomainGroups | null,
  calendarData: CalendarGraphData | null,
  eventGroups: EventGroups | null,
): number {
  if (filterType === 'eventGroups') {
    if (!calendarData || !eventGroups) return 0;
    const calEmails = new Set(
      calendarData.nodes.filter(n => !n.isCenter).map(n => n.email.toLowerCase())
    );
    return Object.values(eventGroups.groups).filter(emails =>
      emails.filter(e => calEmails.has(e.toLowerCase())).length >= MIN_GROUP_SIZE
    ).length;
  }
  if (!rawData) return 0;
  const nodeEmails = new Set(rawData.nodes.filter(n => !n.isCenter).map(n => n.email.toLowerCase()));
  if (filterType === 'messageGroups' && messageGroups) {
    return Object.values(messageGroups.groups).filter(emails =>
      emails.filter(e => nodeEmails.has(e.toLowerCase())).length >= MIN_GROUP_SIZE
    ).length;
  }
  if (filterType === 'organizations' && domains) {
    return Object.values(domains.domain_groups).filter(users =>
      users.filter(u => nodeEmails.has(u.email.toLowerCase())).length >= MIN_GROUP_SIZE
    ).length;
  }
  return 0;
}

export function Controls() {
  const { state, dispatch } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');
  const { messageGroups, domains, rawData, calendarData, eventGroups } = state;

  const isGroupFilter =
    state.filters.filterType === 'messageGroups' ||
    state.filters.filterType === 'organizations' ||
    state.filters.filterType === 'eventGroups';
  const isCalendarFilter = state.filters.filterType === 'calendar';
  const isOverallFilter = state.filters.filterType === 'overall';
  const calendarContacts = calendarData ? calendarData.nodes.filter(n => !n.isCenter).length : 0;
  // Overall mode caps at the Borda window (top 150 of each side) — no point
  // scrolling past 150 since beyond that contacts get 0 combined points.
  const OVERALL_MAX = 150;
  const maxContacts = isOverallFilter
    ? OVERALL_MAX
    : isCalendarFilter
      ? (calendarContacts || 500)
      : (rawData?.stats.totalContacts || 500);

  const qualifyingGroups = isGroupFilter
    ? countQualifyingGroups(
        state.filters.filterType as 'messageGroups' | 'organizations' | 'eventGroups',
        rawData, messageGroups, domains, calendarData, eventGroups,
      )
    : 0;

  const sliderMax = isGroupFilter ? Math.max(qualifyingGroups, 1) : maxContacts;
  const sliderMin = isGroupFilter ? 1 : 10;
  const sliderStep = isGroupFilter ? 1 : 10;
  // Clamp displayed value so the thumb stays in-range
  const sliderValue = Math.min(state.filters.limit, sliderMax);

  const handleFilterChange = (newType: 'overall' | 'gmail' | 'calendar' | 'messageGroups' | 'organizations' | 'eventGroups') => {
    dispatch({ type: 'SET_FILTER_TYPE', payload: newType });

    if (newType === 'messageGroups' || newType === 'organizations' || newType === 'eventGroups') {
      const count = countQualifyingGroups(newType, rawData, messageGroups, domains, calendarData, eventGroups);
      dispatch({ type: 'SET_FILTER_LIMIT', payload: Math.max(count, 1) });
    } else {
      // Restore a sensible contact limit when leaving group mode
      dispatch({ type: 'SET_FILTER_LIMIT', payload: DEFAULT_CONTACT_LIMIT });
    }
  };

  const handleLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_FILTER_LIMIT', payload: parseInt(e.target.value, 10) });
  };

  const handleClearFilters = () => {
    dispatch({ type: 'SET_FILTER_TYPE', payload: 'overall' });
    dispatch({ type: 'SET_FILTER_LIMIT', payload: DEFAULT_CONTACT_LIMIT });
    setSearchQuery('');
    dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
  };

  const handleResetZoom = () => {
    window.resetGraphZoom?.();
  };

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
            value="overall"
            checked={state.filters.filterType === 'overall'}
            onChange={() => handleFilterChange('overall')}
          />
          <span className="filter-label">Overall</span>
        </label>
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="gmail"
            checked={state.filters.filterType === 'gmail'}
            onChange={() => handleFilterChange('gmail')}
          />
          <span className="filter-label">Gmail</span>
        </label>
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="calendar"
            checked={state.filters.filterType === 'calendar'}
            onChange={() => handleFilterChange('calendar')}
          />
          <span className="filter-label">Calendar</span>
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
        <label className="filter-radio">
          <input
            type="radio"
            name="filter-type"
            value="eventGroups"
            checked={state.filters.filterType === 'eventGroups'}
            onChange={() => handleFilterChange('eventGroups')}
          />
          <span className="filter-label">Event Groups</span>
        </label>
      </div>

      <button className="control-btn clear-btn" onClick={handleClearFilters}>
        Clear filters
      </button>

      <div className="slider-group">
        <div className="slider-label">
          <span>{isGroupFilter ? 'Group limit:' : 'Contact limit:'}</span>
          <span className="slider-value">{sliderValue}</span>
        </div>
        <input
          type="range"
          id="contact-limit"
          min={sliderMin}
          max={sliderMax}
          value={sliderValue}
          step={sliderStep}
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
