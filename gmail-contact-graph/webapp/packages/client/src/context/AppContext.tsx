import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type {
  GraphData,
  GraphNode,
  DomainGroups,
  MessageGroups,
  ExcludedContact,
  CalendarGraphData,
  CalendarStats,
  EventGroups,
} from '@gmail-graph/shared';
import type { GroupHoverData } from '../utils/groupTypes';

// State
interface AppState {
  rawData: GraphData | null;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  excludedContacts: ExcludedContact[];
  calendarData: CalendarGraphData | null;
  calendarStats: CalendarStats | null;
  eventGroups: EventGroups | null;

  filters: {
    limit: number;
    filterType: 'overall' | 'gmail' | 'calendar' | 'messageGroups' | 'organizations' | 'eventGroups';
    searchQuery: string;
  };

  selectedNode: GraphNode | null;
  selectedNodePosition: { x: number; y: number } | null;
  /**
   * Id of the one group (see utils/selectedGroups) whose connections are shown
   * on their own; null means show every group the selected contact belongs to.
   */
  isolatedGroupId: string | null;
  selectedGroup: GroupHoverData | null;
  selectedGroupPosition: { x: number; y: number } | null;
  rankingTab: 'ranking' | 'filtered' | 'spam';
  panelVisible: boolean;
  activeTab: 'graph' | 'stats';

  loading: boolean;
  error: string | null;
}

export const initialState: AppState = {
  rawData: null,
  domains: null,
  messageGroups: null,
  excludedContacts: [],
  calendarData: null,
  calendarStats: null,
  eventGroups: null,
  filters: {
    limit: 50,
    filterType: 'overall',
    searchQuery: '',
  },
  selectedNode: null,
  selectedNodePosition: null,
  isolatedGroupId: null,
  selectedGroup: null,
  selectedGroupPosition: null,
  rankingTab: 'ranking',
  panelVisible: true,
  activeTab: 'graph',
  loading: true,
  error: null,
};

// Actions
type Action =
  | { type: 'SET_DATA'; payload: { graph: GraphData; domains: DomainGroups; groups: MessageGroups; excluded: ExcludedContact[] } }
  | { type: 'SET_CALENDAR_DATA'; payload: { graph: CalendarGraphData; stats: CalendarStats; eventGroups: EventGroups } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_FILTER_LIMIT'; payload: number }
  | { type: 'SET_FILTER_TYPE'; payload: 'overall' | 'gmail' | 'calendar' | 'messageGroups' | 'organizations' | 'eventGroups' }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'SELECT_NODE'; payload: GraphNode | null; position?: { x: number; y: number } | null }
  | { type: 'ISOLATE_GROUP'; payload: string }
  | { type: 'SELECT_GROUP'; payload: GroupHoverData | null; position?: { x: number; y: number } | null }
  | { type: 'SET_RANKING_TAB'; payload: 'ranking' | 'filtered' | 'spam' }
  | { type: 'TOGGLE_PANEL' }
  | { type: 'SET_TAB'; payload: 'graph' | 'stats' }
  | { type: 'REMOVE_CONTACT'; payload: string }
  | { type: 'RESTORE_CONTACT'; payload: ExcludedContact }
  | { type: 'MARK_CONTACT_CLEAR'; payload: string };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATA':
      return {
        ...state,
        rawData: action.payload.graph,
        domains: action.payload.domains,
        messageGroups: action.payload.groups,
        excludedContacts: action.payload.excluded,
        loading: false,
      };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'SET_FILTER_LIMIT':
      return { ...state, filters: { ...state.filters, limit: action.payload } };
    case 'SET_FILTER_TYPE':
      // The isolated group may not even exist in the mode we're switching to.
      return { ...state, isolatedGroupId: null, filters: { ...state.filters, filterType: action.payload } };
    case 'SET_SEARCH_QUERY':
      return { ...state, filters: { ...state.filters, searchQuery: action.payload } };
    case 'SELECT_NODE':
      // A new contact has its own groups, so any isolation starts over.
      return {
        ...state,
        selectedNode: action.payload,
        selectedNodePosition: action.position ?? null,
        isolatedGroupId: null,
      };
    case 'ISOLATE_GROUP':
      // Clicking the isolated group again restores every connection.
      return {
        ...state,
        isolatedGroupId: state.isolatedGroupId === action.payload ? null : action.payload,
      };
    case 'SELECT_GROUP':
      return { ...state, selectedGroup: action.payload, selectedGroupPosition: action.position ?? null };
    case 'SET_RANKING_TAB':
      return { ...state, rankingTab: action.payload };
    case 'TOGGLE_PANEL':
      return { ...state, panelVisible: !state.panelVisible };
    case 'SET_TAB':
      return { ...state, activeTab: action.payload };
    case 'REMOVE_CONTACT': {
      if (!state.rawData) return state;
      const email = action.payload;
      const removedNode = state.rawData.nodes.find(n => n.email === email);
      return {
        ...state,
        rawData: {
          ...state.rawData,
          nodes: state.rawData.nodes.filter(n => n.email !== email),
          links: state.rawData.links.filter(l => l.source !== email && l.target !== email),
          stats: {
            ...state.rawData.stats,
            totalContacts: state.rawData.stats.totalContacts - 1,
          },
        },
        excludedContacts: removedNode
          ? [{ name: removedNode.name, email: removedNode.email, received: removedNode.received, sent: removedNode.sent, total: removedNode.received + removedNode.sent }, ...state.excludedContacts]
          : state.excludedContacts,
        selectedNode: state.selectedNode?.email === email ? null : state.selectedNode,
        selectedNodePosition: state.selectedNode?.email === email ? null : state.selectedNodePosition,
        isolatedGroupId: state.selectedNode?.email === email ? null : state.isolatedGroupId,
      };
    }
    case 'RESTORE_CONTACT': {
      const contact = action.payload;
      return {
        ...state,
        excludedContacts: state.excludedContacts.filter(c => c.email !== contact.email),
      };
    }
    case 'SET_CALENDAR_DATA':
      return {
        ...state,
        calendarData: action.payload.graph,
        calendarStats: action.payload.stats,
        eventGroups: action.payload.eventGroups,
      };
    case 'MARK_CONTACT_CLEAR': {
      if (!state.rawData) return state;
      const email = action.payload;
      return {
        ...state,
        rawData: {
          ...state.rawData,
          nodes: state.rawData.nodes.map(n =>
            n.email === email ? { ...n, notClear: false } : n
          ),
        },
      };
    }
    default:
      return state;
  }
}

// Context
interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}
