// Utility functions
import { config } from './config.js';
import { filters } from './state.js';

// Filter data based on current filters
export function filterData(data) {
    let nodes = [data.nodes[0]]; // Always include center node

    // Filter contacts based on checkboxes
    let filteredContacts = data.nodes.slice(1).filter(node => {
        if (filters.showSenders && node.received > 0) return true;
        if (filters.showRecipients && node.sent > 0) return true;
        return false;
    });

    // Sort by composite score (descending) and limit
    filteredContacts.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
    filteredContacts = filteredContacts.slice(0, filters.limit);

    nodes = nodes.concat(filteredContacts);

    return {
        nodes: nodes.map(n => ({...n})),
        links: [], // No links in new design
        stats: {
            ...data.stats,
            displayedContacts: filteredContacts.length
        }
    };
}

// Calculate node radius based on composite ranking score
export function getNodeRadius(d, maxScore) {
    if (d.isCenter) return config.centerNodeRadius;
    const score = d.compositeScore || 0;
    const scale = d3.scaleSqrt()
        .domain([1, maxScore])
        .range([config.minNodeRadius, config.maxNodeRadius]);
    return scale(score || 1);
}

// Escape HTML for safe rendering
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
